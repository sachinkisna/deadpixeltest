/**
 * motionRunner — moving objects for judging smearing and overdrive overshoot.
 *
 * ── This module reports no numbers, and that is deliberate ───────────────────
 * A browser cannot measure grey-to-grey response time. The transition happens
 * inside the panel, after the frame has left the GPU, downstream of everything
 * JavaScript can observe. Measuring it properly needs a photodiode and an
 * oscilloscope aimed at the screen. So there is no millisecond figure anywhere in
 * this file: printing one would be fabricating it.
 *
 * What the eye *can* do is compare. Drive a hard edge across the panel at a known
 * speed, step the monitor's overdrive setting through its OSD, and watch the trail
 * behind the object. That comparison is genuinely actionable, and it is the entire
 * purpose of this test.
 *
 * ── Why px/s ────────────────────────────────────────────────────────────────
 * Perceived blur depends on angular velocity across the retina, which depends on
 * physical pixel pitch and viewing distance. The browser knows neither. Pixels per
 * second is the one unit we can state truthfully, so it is the unit shown.
 */

import { createSurface, fullscreenSupported, prefersReducedMotion } from "./surface";

type Pattern = "ufo" | "edge" | "inverse" | "text";

const DEFAULT_PATTERN: Pattern = "ufo";

const MIN_SPEED = 200;
const MAX_SPEED = 3000;
const DEFAULT_SPEED = 960;
/** Reduced motion: still useful, far gentler. */
const REDUCED_SPEED = 320;

/** Shown in the help panel — what to look for in the pattern on screen. */
const GUIDANCE: Record<Pattern, string> = {
  ufo: "Three bars, same speed, three different grey pairs. Grey-to-grey is exactly this: the time a cell takes to go from one grey to another. Compare the trails. Slow panels smear worst on the dark lane, because dark-to-light transitions are the slowest.",
  edge: "One hard white edge on black. The cleanest way to see trailing smear: watch the black immediately behind the white block. A soft grey wash there is slow pixel transition, and nothing else looks like it.",
  inverse: "A dark object on light grey. Overdrive overshoot shows up here as a bright halo on the trailing edge — the drive circuit pushed the cell past its target and it has to fall back. This is the artefact people mistake for a dirty screen or a failing panel.",
  text: "Scrolling text, which is what actually matters in daily use. If you can read this comfortably at speed, the panel is fine for work. If the letters fill in and turn to mush, that is the smear you saw in the abstract patterns doing real damage.",
};

const isPattern = (value: string | undefined): value is Pattern =>
  value === "ufo" || value === "edge" || value === "inverse" || value === "text";

interface MovingObject {
  readonly el: HTMLElement;
  readonly width: number;
}

export function mountMotionRunner(surfaceId = "surface"): void {
  const root = document.getElementById(surfaceId);
  if (!root) return;

  // Rebound to an explicitly-typed const so the narrowing survives into the
  // closures below.
  const surface: HTMLElement = root;

  const objectEls = Array.from(
    surface.querySelectorAll<HTMLElement>("[data-motion-object]"),
  );
  const patternBtns = Array.from(
    surface.querySelectorAll<HTMLElement>("[data-motion-pattern]"),
  );
  const toggleBtn = surface.querySelector<HTMLElement>("[data-motion-toggle]");
  const speedInput = surface.querySelector<HTMLInputElement>(
    "[data-motion-speed]",
  );
  const speedOut = surface.querySelector<HTMLElement>("[data-motion-speed-out]");
  const revealsEl = surface.querySelector<HTMLElement>("[data-motion-reveals]");
  const noteEl = surface.querySelector<HTMLElement>("[data-hud-note]");
  const helpBtn = surface.querySelector<HTMLElement>("[data-hud-help]");
  const helpPanel = surface.querySelector<HTMLElement>("[data-help-panel]");
  const exitBtn = surface.querySelector<HTMLElement>("[data-surface-exit]");
  const statusEl = surface.querySelector<HTMLElement>("[data-motion-status]");
  const launchers = document.querySelectorAll<HTMLElement>(
    "[data-surface-launch]",
  );

  const reduced = prefersReducedMotion();

  let pattern: Pattern = DEFAULT_PATTERN;
  let speed = reduced ? REDUCED_SPEED : DEFAULT_SPEED;
  let running = false;
  let rafId = 0;
  let lastNow: number | null = null;
  let x = 0;
  let travel = 1;
  let active: MovingObject[] = [];
  let lastLauncher: HTMLElement | null = null;

  const announce = (message: string): void => {
    if (statusEl) statusEl.textContent = message;
  };

  /**
   * Caches the active objects and their widths.
   *
   * Widths are read once per pattern change and once per resize, never per
   * frame: an offsetWidth read inside the loop would force a layout every frame
   * and cause exactly the stutter this test is meant to expose.
   */
  const remeasure = (): void => {
    active = objectEls
      .filter((el) => el.dataset.motionFor === pattern)
      .map((el) => ({ el, width: el.offsetWidth }));
    const widest = active.reduce((max, item) => Math.max(max, item.width), 0);
    travel = window.innerWidth + widest;
    if (x > travel) x = 0;
    paint();
  };

  /** All active objects share one position, so they stay exactly in step. */
  const paint = (): void => {
    for (const item of active) {
      // `translate` rather than `left`: writing a layout property every frame
      // would reflow the page and drop frames of its own, which on a motion test
      // would be indistinguishable from a panel fault.
      item.el.style.translate = `${x - item.width}px 0`;
    }
  };

  /* ── The loop ─────────────────────────────────────────────────────────────
     requestAnimationFrame, not a CSS animation, and the distinction matters
     here more than anywhere else on the site. A CSS transform animation can be
     promoted to the compositor and run off the main thread, which means it would
     keep gliding smoothly even while the page was dropping frames. The user
     would then be judging the compositor's interpolation rather than the frames
     their panel is actually being sent. Driving it from JavaScript guarantees one
     screen update per real frame. */
  const frame = (now: number): void => {
    if (!running) return;
    const dt = lastNow === null ? 0 : (now - lastNow) / 1000;
    lastNow = now;

    x += speed * dt;
    if (x > travel) x -= travel;
    paint();

    rafId = requestAnimationFrame(frame);
  };

  const syncToggle = (): void => {
    if (!toggleBtn) return;
    toggleBtn.textContent = running ? "Pause" : "Start";
    toggleBtn.setAttribute("aria-pressed", String(running));
  };

  const start = (): void => {
    if (running) return;
    running = true;
    lastNow = null;
    syncToggle();
    announce("Motion started.");
    rafId = requestAnimationFrame(frame);
  };

  const pause = (): void => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    syncToggle();
    announce("Motion paused. The objects are frozen where they were.");
  };

  const syncSpeed = (): void => {
    if (speedInput) speedInput.value = String(speed);
    if (speedOut) speedOut.textContent = `${speed} px/s`;
  };

  const syncPattern = (): void => {
    for (const btn of patternBtns) {
      btn.setAttribute(
        "aria-pressed",
        String(btn.dataset.motionPattern === pattern),
      );
    }
    surface.dataset.motionPattern = pattern;
    if (revealsEl) revealsEl.textContent = GUIDANCE[pattern];
    // After the dataset flip the newly-shown layer is laid out, so widths read
    // correctly here.
    remeasure();
  };

  const toggleHelp = (force?: boolean): void => {
    if (!helpPanel) return;
    const open = force ?? Boolean(helpPanel.hidden);
    helpPanel.hidden = !open;
    helpBtn?.setAttribute("aria-pressed", String(open));
  };

  /* ── Surface wiring ─────────────────────────────────────────────────────── */

  const PATTERN_ORDER: readonly Pattern[] = ["ufo", "edge", "inverse", "text"];

  const cyclePattern = (delta: number): void => {
    const at = PATTERN_ORDER.indexOf(pattern);
    const next =
      PATTERN_ORDER[(at + delta + PATTERN_ORDER.length) % PATTERN_ORDER.length];
    if (!next) return;
    pattern = next;
    syncPattern();
    announce(GUIDANCE[pattern]);
  };

  const controller = createSurface(surface, {
    onToggle: () => (running ? pause() : start()),
    onHelp: () => toggleHelp(),
    onExit: () => {
      pause();
      toggleHelp(false);
      surface.hidden = true;
      document.body.style.removeProperty("overflow");
      (lastLauncher ?? launchers[0])?.focus();
    },
    // Arrow keys cycle the pattern: on a moving test that is the one thing worth
    // stepping through, and it keeps the comparison workflow keyboard-only.
    onNext: () => cyclePattern(1),
    onPrev: () => cyclePattern(-1),
  });

  const launch = async (from: HTMLElement | null): Promise<void> => {
    lastLauncher = from;
    surface.hidden = false;
    document.body.style.overflow = "hidden";

    x = 0;
    syncSpeed();
    syncPattern();
    syncToggle();

    await controller.enter();

    if (noteEl) {
      if (reduced) {
        noteEl.hidden = false;
        noteEl.textContent =
          "Reduced motion is on. Nothing will move until you press Start, and the speed is set low. There is no meaningful reduced-motion version of a moving-object test — the movement is the test — so you may prefer to skip this one.";
      } else if (!fullscreenSupported()) {
        noteEl.hidden = false;
        noteEl.textContent =
          "This browser only allows full screen for video, so the browser bars stay visible. The moving objects still work, you just have less width to watch them cross.";
      } else if (surface.dataset.fullscreen === "unavailable") {
        noteEl.hidden = false;
        noteEl.textContent =
          "Full screen was refused by the browser. The test still works across the page area.";
      } else {
        noteEl.hidden = true;
      }
    }

    toggleBtn?.focus();

    if (reduced) {
      // Never start moving without an explicit press.
      announce(
        "Ready. Press Start when you want the objects to move. Nothing is moving yet.",
      );
    } else {
      start();
    }
  };

  for (const el of launchers) {
    el.addEventListener("click", () => void launch(el));
  }

  toggleBtn?.addEventListener("click", () => (running ? pause() : start()));
  helpBtn?.addEventListener("click", () => toggleHelp());
  exitBtn?.addEventListener("click", () => void controller.exit());

  speedInput?.addEventListener("input", () => {
    const next = Number(speedInput.value);
    if (!Number.isFinite(next)) return;
    speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, next));
    syncSpeed();
  });

  for (const btn of patternBtns) {
    btn.addEventListener("click", () => {
      const next = btn.dataset.motionPattern;
      if (!isPattern(next)) return;
      pattern = next;
      syncPattern();
      announce(GUIDANCE[pattern]);
    });
  }

  window.addEventListener("resize", remeasure);

  syncSpeed();
  syncPattern();
  syncToggle();
}
