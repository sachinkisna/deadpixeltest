/**
 * patternRunner — drives a surface that steps through CSS-drawn patterns.
 *
 * Where `fillRunner.ts` cycles a flat colour, these tests cycle a *structure*:
 * single-pixel checkerboards, gradient ramps, near-black step wedges, text
 * ladders. All four are the same interaction — a list, prev/next, a help panel
 * naming what a fault looks like on the current pattern — so they share one
 * module and cannot drift apart.
 *
 * The runner never touches pattern appearance. It sets one attribute,
 * `data-pattern="<id>"`, on the surface, and each page selects its own layers
 * with CSS on `[data-pattern="…"]`. That keeps every gradient authored in the
 * page's scoped `<style>`, where it can be reviewed against the pixel grid it
 * is meant to produce, and keeps this file free of per-test knowledge.
 */

import { createSurface, fullscreenSupported } from "./surface";

export interface PatternDef {
  readonly id: string;
  readonly name: string;
  /** Shown in the help panel: what a fault looks like on THIS pattern. */
  readonly reveals: string;
}

export interface PatternRunnerOptions {
  /** id of the TestSurface element. */
  surfaceId?: string;
  patterns: readonly PatternDef[];
  /** Called after the active pattern changes, for per-page extras. */
  onChange?: (pattern: PatternDef, index: number) => void;
}

export function mountPatternRunner(opts: PatternRunnerOptions): void {
  const { surfaceId = "surface", patterns, onChange } = opts;

  const root = document.getElementById(surfaceId);
  if (!root || patterns.length === 0) return;

  // Rebound to an explicitly-typed const: the null-narrowing established by the
  // guard above does not survive into the hoisted function declarations below,
  // so without this every `surface.` access reports ts(18047).
  const surface: HTMLElement = root;

  const nameEl = surface.querySelector<HTMLElement>("[data-pattern-name]");
  const posEl = surface.querySelector<HTMLElement>("[data-pattern-position]");
  const revealsEl = surface.querySelector<HTMLElement>("[data-pattern-reveals]");
  const statusEl = surface.querySelector<HTMLElement>("[data-pattern-status]");
  const noteEl = surface.querySelector<HTMLElement>("[data-hud-note]");
  const helpBtn = surface.querySelector<HTMLElement>("[data-hud-help]");
  const helpPanel = surface.querySelector<HTMLElement>("[data-help-panel]");
  const prevBtn = surface.querySelector<HTMLElement>("[data-nav-prev]");
  const nextBtn = surface.querySelector<HTMLElement>("[data-nav-next]");
  const exitBtn = surface.querySelector<HTMLElement>("[data-surface-exit]");
  const launchers = document.querySelectorAll<HTMLElement>(
    "[data-surface-launch]",
  );

  let index = 0;
  let lastLauncher: HTMLElement | null = null;

  const paint = (announce: boolean): void => {
    const pattern = patterns[index];
    if (!pattern) return;

    // The one and only hook the pages style against.
    surface.dataset.pattern = pattern.id;

    const position = `${index + 1} / ${patterns.length}`;
    if (nameEl) nameEl.textContent = pattern.name;
    if (posEl) posEl.textContent = position;
    if (revealsEl) revealsEl.textContent = pattern.reveals;

    // Announced only on a change, not on open: on open the surface itself is
    // the announcement, and doubling it up is noise.
    if (announce && statusEl) {
      statusEl.textContent = `${pattern.name}, ${position}. ${pattern.reveals}`;
    }

    onChange?.(pattern, index);
  };

  const step = (delta: number): void => {
    // Wraps rather than clamping — five patterns is a carousel, and a user
    // comparing pattern 5 against pattern 1 should not have to walk back.
    index = (index + delta + patterns.length) % patterns.length;
    paint(true);
  };

  const toggleHelp = (force?: boolean): void => {
    if (!helpPanel) return;
    const open = force ?? Boolean(helpPanel.hidden);
    helpPanel.hidden = !open;
    helpBtn?.setAttribute("aria-pressed", String(open));
  };

  const controller = createSurface(surface, {
    onNext: () => step(1),
    onPrev: () => step(-1),
    onHelp: () => toggleHelp(),
    onExit: () => {
      surface.hidden = true;
      toggleHelp(false);
      document.body.style.removeProperty("overflow");
      // Return focus to whatever opened the surface, or the first launcher.
      (lastLauncher ?? launchers[0])?.focus();
    },
  });

  /**
   * Degraded-mode disclosure.
   *
   * These patterns are judged at the edges of the screen as much as the centre
   * — an inversion band or a scaling moiré often shows first near a corner. If
   * browser chrome is covering part of the panel, the user must be told, not
   * left to conclude the panel is clean.
   */
  const surfaceDegradedNote = (): void => {
    if (!noteEl) return;
    if (!fullscreenSupported()) {
      noteEl.hidden = false;
      noteEl.textContent =
        "This browser only allows full screen for video — iPhone Safari is the usual case. The browser bars stay on screen and will cover part of the panel, so a fault near an edge can be hidden entirely. Rotate to landscape and scroll the bars away, or repeat this test in a desktop browser.";
      return;
    }
    if (surface.dataset.fullscreen === "unavailable") {
      noteEl.hidden = false;
      noteEl.textContent =
        "Full screen was refused by the browser. The pattern covers the page but not the browser chrome, so a fault near an edge may be hidden.";
      return;
    }
    noteEl.hidden = true;
  };

  const launch = async (from: HTMLElement | null): Promise<void> => {
    lastLauncher = from;
    surface.hidden = false;
    // Stops the page behind the overlay from scrolling under a touch drag.
    document.body.style.overflow = "hidden";

    paint(false);
    await controller.enter();
    surfaceDegradedNote();

    // Move focus into the overlay so keyboard users are not stranded on the
    // page underneath. The first HUD button is prev where nav exists.
    const firstBtn = surface.querySelector<HTMLElement>(".dpt-hud-btn");
    (firstBtn ?? exitBtn)?.focus();
  };

  for (const el of launchers) {
    el.addEventListener("click", () => void launch(el));
  }

  prevBtn?.addEventListener("click", () => step(-1));
  nextBtn?.addEventListener("click", () => step(1));
  exitBtn?.addEventListener("click", () => void controller.exit());
  helpBtn?.addEventListener("click", () => toggleHelp());

  // Paint once at mount so the surface is coherent before it is ever revealed.
  paint(false);
}
