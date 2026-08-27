/**
 * fieldRunner — drives a flat-field surface, optionally with an alignment grid.
 *
 * The uniformity, backlight-bleed and viewing-angle tests all work the same
 * way: paint one perfectly flat field across the whole panel, let the user
 * cycle to the next one without leaving full screen, and keep every scrap of
 * chrome out of the way while they judge it. This module is that behaviour,
 * written once so the three pages cannot drift apart.
 *
 * It differs from `fillRunner` in three ways, which is why it is separate
 * rather than another flag on that module:
 *
 *   1. No defect tagger. Non-uniformity is a region, not a pixel, so a marker
 *      ring pinned to a coordinate would be a lie about what was observed.
 *   2. No progress tracking. These tests are not part of the guided pixel run.
 *   3. An optional thirds grid, so a user can say "top-left cell" instead of
 *      "somewhere over on the left a bit" when they file a warranty claim.
 *
 * The field list arrives as an argument. There is no JSON config block to
 * parse, no shared registry to look up — the caller owns its own fields.
 *
 * COLOUR PURITY: the active colour is assigned straight onto the field layer's
 * `style.backgroundColor`. One hop from the value to the panel. It never goes
 * through a custom property, a class, or a Tailwind token, because every one of
 * those adds a place where the colour could be transformed without us noticing.
 */

import { createSurface, fullscreenSupported } from "./surface";

export interface FieldDef {
  readonly id: string;
  readonly name: string;
  /** Full 6-digit sRGB hex painted as the field. */
  readonly hex: string;
  /** Shown in the help panel: what a fault looks like on THIS field. */
  readonly reveals: string;
}

export interface FieldRunnerOptions {
  /** id of the TestSurface element. Defaults to "surface". */
  surfaceId?: string;
  fields: readonly FieldDef[];
  /** Adds a "Grid" toggle that flips data-grid="on|off" on the surface. */
  grid?: boolean;
  /** Fired after every field change, including the first paint on launch. */
  onChange?: (field: FieldDef, index: number) => void;
}

/**
 * Honest degraded-mode copy. Worth spelling out on these three tests in
 * particular: the fault being hunted lives at the edges of the panel, and
 * browser chrome covers exactly the edges.
 */
const NOTE_UNSUPPORTED =
  "This browser only offers full screen for video — iPhone Safari is the one most people hit — so the address bar and toolbar stay on screen and cover part of the panel. The fault this test looks for is at the edges, which is precisely what that chrome is sitting on, so an edge or corner fault can hide behind it. Use a desktop browser before you conclude the panel is clean.";

const NOTE_UNAVAILABLE =
  "Full screen was refused by the browser, so its own chrome is still covering part of the screen. Since this test is about the edges of the panel, treat anything near a covered edge as unchecked rather than clean.";

export function mountFieldRunner(opts: FieldRunnerOptions): void {
  const { surfaceId = "surface", fields, grid = false, onChange } = opts;

  const root = document.getElementById(surfaceId);
  const layerEl = root?.querySelector<HTMLElement>("[data-field-layer]");
  if (!root || !layerEl || fields.length === 0) return;

  // Rebound to explicitly-typed consts. Narrowing from the guard above does
  // not survive into anything declared later in this scope, so every helper
  // below reads these rather than the nullable originals.
  const surface: HTMLElement = root;
  const layer: HTMLElement = layerEl;

  const nameEl = surface.querySelector<HTMLElement>("[data-field-name]");
  const posEl = surface.querySelector<HTMLElement>("[data-field-position]");
  const revealsEl = surface.querySelector<HTMLElement>("[data-field-reveals]");
  const statusEl = surface.querySelector<HTMLElement>("[data-field-status]");
  const noteEl = surface.querySelector<HTMLElement>("[data-hud-note]");
  const helpBtn = surface.querySelector<HTMLElement>("[data-hud-help]");
  const helpPanel = surface.querySelector<HTMLElement>("[data-help-panel]");
  const gridBtn = surface.querySelector<HTMLElement>("[data-grid-toggle]");
  const prevBtn = surface.querySelector<HTMLElement>("[data-nav-prev]");
  const nextBtn = surface.querySelector<HTMLElement>("[data-nav-next]");
  const exitBtn = surface.querySelector<HTMLElement>("[data-surface-exit]");
  const launchers = document.querySelectorAll<HTMLElement>(
    "[data-surface-launch]",
  );

  let index = 0;
  let gridOn = false;
  let lastLauncher: HTMLElement | null = null;

  const announce = (message: string): void => {
    if (statusEl) statusEl.textContent = message;
  };

  const paint = (): void => {
    const field = fields[index];
    if (!field) return;

    // The one hop. Nothing between this value and the panel.
    layer.style.backgroundColor = field.hex;
    layer.dataset.fieldId = field.id;
    layer.setAttribute("aria-label", `Full screen ${field.name} field`);

    if (nameEl) nameEl.textContent = field.name;
    if (posEl) posEl.textContent = `${index + 1} / ${fields.length}`;
    if (revealsEl) revealsEl.textContent = field.reveals;

    announce(
      `${field.name} field, ${index + 1} of ${fields.length}. ${field.reveals}`,
    );

    onChange?.(field, index);
  };

  const step = (delta: number): void => {
    // Wraps. Judging uniformity means going back and forth between two greys
    // repeatedly, so a hard stop at either end would just be friction.
    index = (index + delta + fields.length) % fields.length;
    paint();
  };

  const toggleHelp = (force?: boolean): void => {
    if (!helpPanel) return;
    const open = force ?? Boolean(helpPanel.hidden);
    helpPanel.hidden = !open;
    helpBtn?.setAttribute("aria-pressed", String(open));
  };

  const setGrid = (on: boolean): void => {
    gridOn = on;
    surface.dataset.grid = on ? "on" : "off";
    gridBtn?.setAttribute("aria-pressed", String(on));
    announce(
      on
        ? "Thirds grid on. Note which cell the fault sits in."
        : "Thirds grid off.",
    );
  };

  const controller = createSurface(surface, {
    onNext: () => step(1),
    onPrev: () => step(-1),
    onHelp: () => toggleHelp(),
    onExit: () => {
      surface.hidden = true;
      toggleHelp(false);
      document.body.style.removeProperty("overflow");
      // Focus goes back to whatever opened the surface, so a keyboard user is
      // not dumped at the top of the document.
      (lastLauncher ?? launchers[0])?.focus();
    },
  });

  const launch = async (from: HTMLElement | null): Promise<void> => {
    lastLauncher = from;
    surface.hidden = false;
    // Stops the page behind the overlay scrolling under a touch drag.
    document.body.style.overflow = "hidden";

    // The grid is an alignment aid, not part of the test. It starts off on
    // every launch: hairlines drawn over the field are the last thing that
    // should be in the way while the user decides whether the field is even.
    if (grid) setGrid(false);

    paint();
    await controller.enter();

    if (noteEl) {
      if (!fullscreenSupported()) {
        noteEl.hidden = false;
        noteEl.textContent = NOTE_UNSUPPORTED;
      } else if (surface.dataset.fullscreen === "unavailable") {
        noteEl.hidden = false;
        noteEl.textContent = NOTE_UNAVAILABLE;
      } else {
        noteEl.hidden = true;
      }
    }

    // Move focus into the overlay rather than leaving it on the page beneath.
    (prevBtn ?? exitBtn)?.focus();
  };

  for (const el of launchers) {
    el.addEventListener("click", () => void launch(el));
  }

  prevBtn?.addEventListener("click", () => step(-1));
  nextBtn?.addEventListener("click", () => step(1));
  exitBtn?.addEventListener("click", () => void controller.exit());
  helpBtn?.addEventListener("click", () => toggleHelp());

  if (grid) {
    gridBtn?.addEventListener("click", () => setGrid(!gridOn));
    surface.dataset.grid = "off";
  }
}
