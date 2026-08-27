/**
 * fixerRunner — the stuck-pixel exerciser.
 *
 * ── Why this is a movable patch rather than a full-screen strobe ────────────
 * The usual implementation flashes the entire screen as fast as it can. That is
 * both less safe and less effective.
 *
 * Less safe: WCAG 2.3.1's general flash threshold applies to flashes covering
 * more than 25% of a 10-degree viewing field. A full-screen strobe is squarely
 * inside that, so it must be held to three flashes per second. A small patch is
 * below the threshold area, so it can cycle faster while presenting far less
 * total luminance change to the eye.
 *
 * Less effective: unsticking a sub-pixel means exercising its transistor
 * rapidly, and 3 Hz barely does that. Confining the flash to the area around
 * the fault buys the higher rate that actually has a chance of working.
 *
 * So: patch mode is the default and allows up to 10 Hz; full-screen mode is
 * available but hard-capped at 3 Hz. `prefers-reduced-motion` forces a slow
 * hold instead of a cycle, and nothing starts without an explicit press.
 *
 * ── On honesty ─────────────────────────────────────────────────────────────
 * This can sometimes free a STUCK sub-pixel. It cannot fix a DEAD pixel, which
 * receives no power at all. No page can promise a result here, and this one
 * does not.
 */

import { createSurface, prefersReducedMotion } from "./surface";

/** Cycled in this order: every channel gets driven on and off in turn. */
const CYCLE = ["#ff0000", "#00ff00", "#0000ff", "#ffffff", "#000000"] as const;

/** Hard ceiling for a full-screen flash — WCAG 2.3.1. */
const FULLSCREEN_MAX_HZ = 3;
/** Ceiling for the small patch, which is below the flash-area threshold. */
const PATCH_MAX_HZ = 10;
/** Reduced-motion variant: a slow hold, not a flash. */
const REDUCED_HZ = 0.25;

type Mode = "patch" | "fullscreen";

export function mountFixer(surfaceId = "surface"): void {
  const root = document.getElementById(surfaceId);
  const patchEl = root?.querySelector<HTMLElement>("[data-fixer-patch]");
  if (!root || !patchEl) return;

  // Rebound to explicitly-typed consts: the null-narrowing established above
  // does not survive into the hoisted function declarations further down.
  const surface: HTMLElement = root;
  const patch: HTMLElement = patchEl;

  const toggleBtn = surface.querySelector<HTMLElement>("[data-fixer-toggle]");
  const exitBtn = surface.querySelector<HTMLElement>("[data-surface-exit]");
  const elapsedEl = surface.querySelector<HTMLElement>("[data-fixer-elapsed]");
  const rateInput = surface.querySelector<HTMLInputElement>("[data-fixer-rate]");
  const rateOut = surface.querySelector<HTMLElement>("[data-fixer-rate-out]");
  const noteEl = surface.querySelector<HTMLElement>("[data-hud-note]");
  const statusEl = surface.querySelector<HTMLElement>("[data-fixer-status]");
  const modeBtns = Array.from(
    surface.querySelectorAll<HTMLElement>("[data-fixer-mode]"),
  );
  const sizeInput = surface.querySelector<HTMLInputElement>("[data-fixer-size]");
  const launchers = document.querySelectorAll<HTMLElement>(
    "[data-surface-launch]",
  );

  const reduced = prefersReducedMotion();

  let mode: Mode = "patch";
  let hz = reduced ? REDUCED_HZ : 6;
  let running = false;
  let cycleIndex = 0;
  let lastSwap = 0;
  let startedAt = 0;
  let accumulatedMs = 0;
  let rafId = 0;
  let lastLauncher: HTMLElement | null = null;

  const maxHz = (): number =>
    reduced ? REDUCED_HZ : mode === "fullscreen" ? FULLSCREEN_MAX_HZ : PATCH_MAX_HZ;

  function announce(message: string): void {
    if (statusEl) statusEl.textContent = message;
  }

  function formatElapsed(ms: number): string {
    const total = Math.floor(ms / 1000);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function syncRate(): void {
    const ceiling = maxHz();
    if (hz > ceiling) hz = ceiling;
    if (rateInput) {
      rateInput.max = String(ceiling);
      rateInput.value = String(hz);
      rateInput.disabled = reduced;
    }
    if (rateOut) {
      rateOut.textContent = reduced
        ? "held 4s per colour"
        : `${hz} per second`;
    }
    if (noteEl) {
      if (reduced) {
        noteEl.hidden = false;
        noteEl.textContent =
          "Reduced motion is on, so colours are held rather than flashed. This is gentler but much less likely to free a stuck pixel.";
      } else if (mode === "fullscreen") {
        noteEl.hidden = false;
        noteEl.textContent =
          "Full screen is capped at 3 changes per second, the WCAG 2.3.1 flash limit. The small patch can run faster because it covers far less of your field of view.";
      } else {
        noteEl.hidden = true;
      }
    }
  }

  function syncMode(): void {
    for (const btn of modeBtns) {
      btn.setAttribute(
        "aria-pressed",
        String(btn.dataset.fixerMode === mode),
      );
    }
    surface.dataset.fixerMode = mode;
    if (sizeInput) sizeInput.disabled = mode === "fullscreen";
    syncRate();
  }

  function syncToggle(): void {
    if (!toggleBtn) return;
    toggleBtn.textContent = running ? "Pause" : "Start";
    toggleBtn.setAttribute("aria-pressed", String(running));
  }

  function applySize(): void {
    if (!sizeInput) return;
    const px = Number(sizeInput.value);
    patch.style.setProperty("--patch-size", `${px}px`);
  }

  function frame(now: number): void {
    if (!running) return;
    const interval = 1000 / hz;
    if (now - lastSwap >= interval) {
      lastSwap = now;
      cycleIndex = (cycleIndex + 1) % CYCLE.length;
      patch.style.backgroundColor = CYCLE[cycleIndex] ?? "#000000";
    }
    if (elapsedEl) {
      elapsedEl.textContent = formatElapsed(
        accumulatedMs + (performance.now() - startedAt),
      );
    }
    rafId = requestAnimationFrame(frame);
  }

  function start(): void {
    if (running) return;
    running = true;
    startedAt = performance.now();
    lastSwap = 0;
    syncToggle();
    announce("Cycling started.");
    rafId = requestAnimationFrame(frame);
  }

  function pause(): void {
    if (!running) return;
    running = false;
    accumulatedMs += performance.now() - startedAt;
    cancelAnimationFrame(rafId);
    syncToggle();
    announce(`Paused at ${formatElapsed(accumulatedMs)}.`);
  }

  const controller = createSurface(surface, {
    // Space/Enter toggles, matching every other test on the site.
    onToggle: () => (running ? pause() : start()),
    onExit: () => {
      pause();
      surface.hidden = true;
      document.body.style.removeProperty("overflow");
      (lastLauncher ?? launchers[0])?.focus();
    },
    // Arrow keys are not bound here: there is nothing to step through, and
    // silently swallowing them would break scrolling expectations.
  });

  /* ── Dragging the patch onto the stuck pixel ─────────────────────────────
     Pointer Events with capture, so a fast drag that leaves the element does
     not drop the gesture. */
  let dragging = false;
  let grabX = 0;
  let grabY = 0;

  patch.addEventListener("pointerdown", (event: PointerEvent) => {
    if (mode !== "patch") return;
    dragging = true;
    const rect = patch.getBoundingClientRect();
    grabX = event.clientX - rect.left - rect.width / 2;
    grabY = event.clientY - rect.top - rect.height / 2;
    patch.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  patch.addEventListener("pointermove", (event: PointerEvent) => {
    if (!dragging) return;
    movePatch(event.clientX - grabX, event.clientY - grabY);
  });

  patch.addEventListener("pointerup", (event: PointerEvent) => {
    dragging = false;
    patch.releasePointerCapture(event.pointerId);
  });

  function movePatch(x: number, y: number): void {
    // `left`/`top` rather than a transform: a transform on the flashing element
    // can promote it to its own composited layer and resample its edges.
    patch.style.left = `${x}px`;
    patch.style.top = `${y}px`;
  }

  /* Keyboard positioning. Arrow keys are taken by the surface, so this uses
     WASD — announced in the HUD help text. */
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (surface.hidden || mode !== "patch") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const step = event.shiftKey ? 40 : 8;
    const rect = patch.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    switch (event.key.toLowerCase()) {
      case "w":
        movePatch(cx, cy - step);
        break;
      case "s":
        movePatch(cx, cy + step);
        break;
      case "a":
        movePatch(cx - step, cy);
        break;
      case "d":
        movePatch(cx + step, cy);
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  /* ── Wiring ─────────────────────────────────────────────────────────────── */

  toggleBtn?.addEventListener("click", () => (running ? pause() : start()));
  exitBtn?.addEventListener("click", () => void controller.exit());

  rateInput?.addEventListener("input", () => {
    hz = Math.min(Number(rateInput.value), maxHz());
    syncRate();
  });

  sizeInput?.addEventListener("input", applySize);

  for (const btn of modeBtns) {
    btn.addEventListener("click", () => {
      const next = btn.dataset.fixerMode;
      if (next !== "patch" && next !== "fullscreen") return;
      mode = next;
      syncMode();
      announce(
        mode === "patch"
          ? "Patch mode. Drag the square over the stuck pixel, or use W A S D."
          : "Full screen mode, capped at 3 changes per second.",
      );
    });
  }

  for (const el of launchers) {
    el.addEventListener("click", () => {
      lastLauncher = el;
      surface.hidden = false;
      document.body.style.overflow = "hidden";
      accumulatedMs = 0;
      if (elapsedEl) elapsedEl.textContent = "00:00";
      // Centre the patch on first open.
      movePatch(window.innerWidth / 2, window.innerHeight / 2);
      applySize();
      syncMode();
      syncToggle();
      void controller.enter();
      toggleBtn?.focus();
      // Deliberately NOT auto-started. Nothing flashes until pressed.
      announce("Ready. Press Start when you are ready for the colours to cycle.");
    });
  }

  syncMode();
  syncToggle();
}
