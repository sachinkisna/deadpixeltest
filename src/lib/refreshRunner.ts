/**
 * refreshRunner — measures the refresh rate the browser is actually presented.
 *
 * ── What this can and cannot establish ──────────────────────────────────────
 * Unlike the response-time page, this measurement is genuinely trustworthy for
 * the thing it claims: requestAnimationFrame fires once per presented frame, so
 * the interval between callbacks *is* the rate the compositor is handing us.
 *
 * The honest caveat is not accuracy, it is scope. We observe the presented rate,
 * which is the rate at the end of the chain. A variable-refresh display, a
 * throttled background tab, or a compositor capped at 60 will all read low on a
 * fast panel. So a low reading is a reason to investigate, never proof of a slow
 * panel — and the verdict text says exactly that rather than implying a fault.
 *
 * Sampling itself lives in `sampleRefreshRate` (lib/surface.ts): median-based,
 * five warm-up frames discarded. This module only drives it and interprets it.
 */

import {
  createSurface,
  fullscreenSupported,
  prefersReducedMotion,
  sampleRefreshRate,
} from "./surface";

/** Rates a display might legitimately be running at. */
const COMMON_RATES = [
  60, 75, 90, 100, 120, 144, 165, 175, 180, 200, 240, 280, 360, 480, 500, 540,
] as const;

/** Snap only inside this band. Wider, and 100 Hz would swallow 96 Hz. */
const SNAP_TOLERANCE = 0.02;

const SAMPLE_MS = 5000;

/** Frames in the rolling window behind the live readout. */
const LIVE_WINDOW = 40;
/** Below this, the rolling median is too noisy to show. */
const LIVE_MINIMUM = 8;

/** One full traverse per second, so the sweep doubles as a crude stopwatch. */
const SWEEP_PERIOD_MS = 1000;

/** Nearest standard rate within tolerance, or null if it matches nothing. */
function snapToCommon(hz: number): number | null {
  let best: number | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const rate of COMMON_RATES) {
    const diff = Math.abs(hz - rate);
    if (diff <= rate * SNAP_TOLERANCE && diff < bestDiff) {
      best = rate;
      bestDiff = diff;
    }
  }
  return best;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

export function mountRefreshRunner(surfaceId = "surface"): void {
  const root = document.getElementById(surfaceId);
  if (!root) return;

  // Rebound to an explicitly-typed const: the null-narrowing above does not
  // reach into the closures below.
  const surface: HTMLElement = root;

  const bar = surface.querySelector<HTMLElement>("[data-refresh-bar]");
  const liveEl = surface.querySelector<HTMLElement>("[data-refresh-live]");
  const hzEl = surface.querySelector<HTMLElement>("[data-refresh-hz]");
  const meanEl = surface.querySelector<HTMLElement>("[data-refresh-mean]");
  const worstEl = surface.querySelector<HTMLElement>("[data-refresh-worst]");
  const framesEl = surface.querySelector<HTMLElement>("[data-refresh-frames]");
  const verdictEl = surface.querySelector<HTMLElement>("[data-refresh-verdict]");
  const progressEl = surface.querySelector<HTMLElement>(
    "[data-refresh-progress]",
  );
  const measureBtn = surface.querySelector<HTMLButtonElement>(
    "[data-refresh-measure]",
  );
  const noteEl = surface.querySelector<HTMLElement>("[data-hud-note]");
  const helpBtn = surface.querySelector<HTMLElement>("[data-hud-help]");
  const helpPanel = surface.querySelector<HTMLElement>("[data-help-panel]");
  const exitBtn = surface.querySelector<HTMLElement>("[data-surface-exit]");
  const statusEl = surface.querySelector<HTMLElement>("[data-refresh-status]");
  const launchers = document.querySelectorAll<HTMLElement>(
    "[data-surface-launch]",
  );

  const reduced = prefersReducedMotion();

  let looping = false;
  let measuring = false;
  let rafId = 0;
  let lastFrame: number | null = null;
  let sweepStart = 0;
  let barWidth = 0;
  let intervals: number[] = [];
  let lastLauncher: HTMLElement | null = null;

  const announce = (message: string): void => {
    if (statusEl) statusEl.textContent = message;
  };

  /* ── The live loop ────────────────────────────────────────────────────────
     Driven by requestAnimationFrame rather than a CSS animation, and that is
     the point rather than an implementation detail. A CSS animation can be
     promoted to the compositor and run off the main thread: it would keep
     gliding smoothly even while the main thread was dropping frames, so the bar
     would contradict the number beside it. Moving it from JS guarantees the
     visual and the readout come from the same clock.

     `translate` rather than `left`: writing a layout property every frame forces
     a reflow that would itself cost frames and corrupt the reading. No colour is
     under measurement on this page, so the compositing concern that rules out
     transforms elsewhere on the site does not apply. */
  const frame = (now: number): void => {
    if (!looping) return;

    if (lastFrame !== null) {
      intervals.push(now - lastFrame);
      if (intervals.length > LIVE_WINDOW) intervals.shift();
    }
    lastFrame = now;

    if (liveEl && intervals.length >= LIVE_MINIMUM) {
      const mid = median(intervals);
      liveEl.textContent = mid > 0 ? `${(1000 / mid).toFixed(1)} Hz` : "—";
    }

    if (bar && !reduced) {
      const phase = ((now - sweepStart) % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS;
      const travel = window.innerWidth + barWidth;
      bar.style.translate = `${phase * travel - barWidth}px 0`;
    }

    rafId = requestAnimationFrame(frame);
  };

  const startLoop = (): void => {
    if (looping) return;
    looping = true;
    lastFrame = null;
    intervals = [];
    sweepStart = performance.now();
    rafId = requestAnimationFrame(frame);
  };

  const stopLoop = (): void => {
    looping = false;
    cancelAnimationFrame(rafId);
  };

  /* ── Interpretation ─────────────────────────────────────────────────────── */

  const writeVerdict = (lines: readonly string[]): void => {
    if (!verdictEl) return;
    verdictEl.replaceChildren(
      ...lines.map((text) => {
        const p = document.createElement("p");
        p.textContent = text;
        return p;
      }),
    );
    verdictEl.hidden = false;
  };

  const interpret = (hz: number, meanMs: number, worstMs: number, frames: number): void => {
    if (frames === 0 || hz === 0) {
      writeVerdict([
        "No usable frames were sampled. The tab was probably backgrounded during the measurement. Bring this window to the front and measure again.",
      ]);
      announce("Measurement failed: no frames sampled.");
      return;
    }

    const lines: string[] = [];
    const snapped = snapToCommon(hz);

    if (snapped !== null) {
      lines.push(
        `Your browser is being presented frames at about ${snapped} Hz. The raw median was ${hz} Hz, which is within 2% of the standard ${snapped} Hz rate.`,
      );
    } else {
      lines.push(
        `Measured ${hz} Hz, which does not match any standard refresh rate. That usually means the sample was disturbed rather than that your display runs at an exotic rate — close other tabs and measure again before drawing a conclusion.`,
      );
    }

    // A single long frame drags the mean up; a worst case twice the mean means
    // the sample contains real stalls, so the median is not representative.
    if (worstMs > meanMs * 2) {
      lines.push(
        `Frames were dropped during the sample: the worst interval was ${worstMs} ms against a mean of ${meanMs} ms. This figure is unreliable. Close other tabs and applications, leave this window focused, and measure again.`,
      );
    }

    lines.push(
      "What this figure is: the rate at which the browser is presented frames. That is the end of the chain, so it is the number that matters for how motion actually feels — but it is not a direct reading of the panel.",
    );
    lines.push(
      "A variable-refresh display (FreeSync or G-Sync), a browser throttling a background tab, or a compositor capped at 60 will all read low on a fast panel. A low reading is a reason to investigate your display settings, cable and driver — not proof of a slow monitor.",
    );

    writeVerdict(lines);
    announce(
      snapped !== null
        ? `Measured ${hz} hertz, matching a standard ${snapped} hertz rate.`
        : `Measured ${hz} hertz, matching no standard rate.`,
    );
  };

  const measure = async (): Promise<void> => {
    if (measuring) return;
    measuring = true;
    if (measureBtn) measureBtn.disabled = true;
    if (verdictEl) verdictEl.hidden = true;
    announce("Measuring for five seconds. Keep this window in the foreground.");

    const result = await sampleRefreshRate(SAMPLE_MS, (elapsedMs) => {
      if (progressEl) {
        progressEl.textContent = `${(elapsedMs / 1000).toFixed(1)}s / ${(SAMPLE_MS / 1000).toFixed(1)}s`;
      }
    });

    if (hzEl) hzEl.textContent = result.hz > 0 ? `${result.hz} Hz` : "—";
    if (meanEl) meanEl.textContent = `${result.meanMs} ms`;
    if (worstEl) worstEl.textContent = `${result.worstMs} ms`;
    if (framesEl) framesEl.textContent = String(result.frames);
    if (progressEl) progressEl.textContent = "done";

    interpret(result.hz, result.meanMs, result.worstMs, result.frames);

    measuring = false;
    if (measureBtn) measureBtn.disabled = false;
  };

  const toggleHelp = (force?: boolean): void => {
    if (!helpPanel) return;
    const open = force ?? Boolean(helpPanel.hidden);
    helpPanel.hidden = !open;
    helpBtn?.setAttribute("aria-pressed", String(open));
  };

  /* ── Surface wiring ─────────────────────────────────────────────────────── */

  const controller = createSurface(surface, {
    onToggle: () => void measure(),
    onHelp: () => toggleHelp(),
    onExit: () => {
      stopLoop();
      toggleHelp(false);
      surface.hidden = true;
      document.body.style.removeProperty("overflow");
      (lastLauncher ?? launchers[0])?.focus();
    },
    // No arrow bindings: there is nothing to step through, and swallowing the
    // arrow keys would break scroll expectations for no gain.
  });

  const launch = async (from: HTMLElement | null): Promise<void> => {
    lastLauncher = from;
    surface.hidden = false;
    document.body.style.overflow = "hidden";

    if (bar) {
      // Reduced motion: no sweeping bar at all, numbers only.
      bar.hidden = reduced;
      barWidth = reduced ? 0 : bar.offsetWidth;
    }

    if (progressEl) progressEl.textContent = "ready";
    startLoop();
    await controller.enter();

    if (noteEl) {
      if (reduced) {
        noteEl.hidden = false;
        noteEl.textContent =
          "Reduced motion is on, so the sweeping reference bar is switched off. The numbers below are measured exactly the same way and are unaffected.";
      } else if (!fullscreenSupported()) {
        noteEl.hidden = false;
        noteEl.textContent =
          "This browser only allows full screen for video, so the browser bars stay visible. The measurement still works — refresh rate does not depend on how much of the screen is covered.";
      } else if (surface.dataset.fullscreen === "unavailable") {
        noteEl.hidden = false;
        noteEl.textContent =
          "Full screen was refused by the browser. The measurement is unaffected.";
      } else {
        noteEl.hidden = true;
      }
    }

    measureBtn?.focus();
    announce(
      "Ready. The live figure updates continuously. Press Measure for a five second sample.",
    );
  };

  for (const el of launchers) {
    el.addEventListener("click", () => void launch(el));
  }

  measureBtn?.addEventListener("click", () => void measure());
  helpBtn?.addEventListener("click", () => toggleHelp());
  exitBtn?.addEventListener("click", () => void controller.exit());

  window.addEventListener("resize", () => {
    if (bar && !reduced) barWidth = bar.offsetWidth;
  });
}
