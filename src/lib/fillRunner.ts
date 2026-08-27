/**
 * fillRunner — drives a FillSurface.
 *
 * Reads the fill list out of the page's `<script type="application/json">`
 * config block, then wires the launch button, the fill cycling, the HUD toggles
 * and the defect tagger together. One module serves every colour-fill page so
 * the behaviour cannot drift between them.
 */

import { createSurface, fullscreenSupported } from "./surface";
import { createTagger } from "./tagger";
import { markFillComplete } from "./defects";
import type { Fill } from "./palette";

interface FillConfig {
  fills: Fill[];
  startIndex: number;
}

export interface FillRunnerOptions {
  /** id of the TestSurface element. */
  surfaceId?: string;
  /**
   * Marks each fill as checked as the user passes it, feeding the progress
   * readout on the report. Only true for the guided sequence — landing on
   * `/test/red` directly is not the same as having examined it.
   */
  trackProgress?: boolean;
  /** Fired when the fill changes, with the new index. */
  onAdvance?: (index: number, fill: Fill) => void;
}

export function mountFillRunner(options: FillRunnerOptions = {}): void {
  const { surfaceId = "surface", trackProgress = false, onAdvance } = options;

  const surface = document.getElementById(surfaceId);
  const configEl = document.querySelector<HTMLScriptElement>(
    "[data-fill-config]",
  );
  if (!surface || !configEl?.textContent) return;

  let config: FillConfig;
  try {
    config = JSON.parse(configEl.textContent) as FillConfig;
  } catch {
    return;
  }

  const fills = config.fills;
  if (fills.length === 0) return;

  let index = Math.min(Math.max(config.startIndex, 0), fills.length - 1);

  const layer = surface.querySelector<HTMLElement>("[data-fill-layer]");
  const nameEl = surface.querySelector<HTMLElement>("[data-fill-name]");
  const posEl = surface.querySelector<HTMLElement>("[data-fill-position]");
  const revealsEl = surface.querySelector<HTMLElement>("[data-fill-reveals]");
  const noteEl = surface.querySelector<HTMLElement>("[data-hud-note]");
  const helpBtn = surface.querySelector<HTMLElement>("[data-hud-help]");
  const helpPanel = surface.querySelector<HTMLElement>("[data-help-panel]");
  const prevBtn = surface.querySelector<HTMLElement>("[data-nav-prev]");
  const nextBtn = surface.querySelector<HTMLElement>("[data-nav-next]");
  const exitBtn = surface.querySelector<HTMLElement>("[data-surface-exit]");
  const launchers = document.querySelectorAll<HTMLElement>(
    "[data-surface-launch]",
  );

  const currentFill = (): string => fills[index]?.slug ?? "";

  const tagger = createTagger({ surface, currentFill });

  function paint(): void {
    const fill = fills[index];
    if (!fill || !layer) return;

    // Set the colour directly on the element. No class lookup, no custom
    // property indirection — one hop from the palette to the panel.
    layer.style.backgroundColor = fill.hex;
    layer.dataset.fillSlug = fill.slug;
    layer.setAttribute("aria-label", `Full screen ${fill.name} fill`);

    if (nameEl) nameEl.textContent = fill.name;
    if (posEl) posEl.textContent = `${index + 1} / ${fills.length}`;
    if (revealsEl) revealsEl.textContent = fill.reveals;

    // Markers are per-fill, so they have to be redrawn on every change.
    tagger.render();

    if (trackProgress) markFillComplete(tagger.session, fill.slug);
    onAdvance?.(index, fill);
  }

  function step(delta: number): void {
    // Wraps rather than clamping: cycling past the last fill back to the first
    // is what people expect from a carousel of twelve screens.
    index = (index + delta + fills.length) % fills.length;
    paint();
  }

  function toggleHelp(force?: boolean): void {
    if (!helpPanel) return;
    const open = force ?? Boolean(helpPanel.hidden);
    helpPanel.hidden = !open;
    helpBtn?.setAttribute("aria-pressed", String(open));
  }

  let lastLauncher: HTMLElement | null = null;

  const controller = createSurface(surface, {
    onNext: () => step(1),
    onPrev: () => step(-1),
    onHelp: () => toggleHelp(),
    onExit: () => {
      surface.hidden = true;
      tagger.setArmed(false);
      toggleHelp(false);
      document.body.style.removeProperty("overflow");
      // Return focus to whatever opened the surface, or the first launcher.
      (lastLauncher ?? launchers[0])?.focus();
    },
  });

  // Arrow function rather than `async function`: a hoisted function declaration
  // loses the `surface` null-narrowing established by the guard above.
  const launch = async (from: HTMLElement | null): Promise<void> => {
    lastLauncher = from;
    surface.hidden = false;
    // Stops the page behind the overlay from scrolling under a touch drag.
    document.body.style.overflow = "hidden";

    paint();
    await controller.enter();

    if (!fullscreenSupported() && noteEl) {
      noteEl.hidden = false;
      noteEl.textContent =
        "This browser only allows full screen for video, so the browser bars stay visible. Defects hidden behind them will not show — rotate to landscape and scroll the bars away, or use a desktop browser.";
    } else if (surface.dataset.fullscreen === "unavailable" && noteEl) {
      noteEl.hidden = false;
      noteEl.textContent =
        "Full screen was refused by the browser. The fill covers the page but not the browser chrome.";
    }

    // Move focus into the overlay so keyboard users are not left behind on the
    // page underneath.
    exitBtn?.focus();
  };

  for (const el of launchers) {
    el.addEventListener("click", () => void launch(el));
  }

  prevBtn?.addEventListener("click", () => step(-1));
  nextBtn?.addEventListener("click", () => step(1));
  exitBtn?.addEventListener("click", () => void controller.exit());
  helpBtn?.addEventListener("click", () => toggleHelp());
}
