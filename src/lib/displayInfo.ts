/**
 * displayInfo — everything the browser will admit about the display, plus what
 * each figure does not mean.
 *
 * Every value here is a *report*, not a measurement. The OS tells the browser
 * the screen geometry, and the display's EDID told the OS. Scaling, a cable
 * capped below the panel's capability, or a monitor that misreports its own
 * EDID all sit upstream of anything JavaScript can see. So each row carries a
 * note saying what it can and cannot establish — that honesty is the whole
 * reason this page exists instead of a bare "your resolution is X" banner.
 *
 * Screen geometry comes from `readScreenInfo()` in ./defects rather than being
 * re-derived here, so the resolution page and the defect report can never
 * disagree about the same display.
 *
 * Notes are plain text with no markup. A pure reporting function should not
 * emit HTML, so the page owns the cross-links (the pointer to /test/banding for
 * real bit depth, for instance) and renders them alongside.
 */

import { readScreenInfo } from "./defects";

export interface DisplayReport {
  readonly rows: ReadonlyArray<{
    label: string;
    value: string;
    /** Shown under the value: what this number does and does not tell you. */
    note?: string;
  }>;
}

/** Trims float noise without pretending to precision we do not have. */
function trim(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function matches(query: string): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(query).matches;
}

/**
 * Widest gamut the browser claims, probed from the top down.
 *
 * `srgb` matching only means "at least sRGB", so the probes have to run
 * rec2020 → p3 → srgb and stop at the first hit.
 */
function widestGamut(): string {
  if (matches("(color-gamut: rec2020)")) return "Rec. 2020 or wider";
  if (matches("(color-gamut: p3)")) return "Display P3";
  if (matches("(color-gamut: srgb)")) return "sRGB";
  return "Narrower than sRGB, or not reported";
}

export function readDisplayReport(): DisplayReport {
  const info = readScreenInfo();
  const megapixels = (info.deviceWidth * info.deviceHeight) / 1_000_000;

  // Cast rather than optional-chaining a required lib.dom property: older
  // WebKit and some embedded browsers genuinely omit `screen.orientation`.
  const orientation = window.screen.orientation as ScreenOrientation | undefined;

  return {
    rows: [
      {
        label: "Browser viewport",
        value: `${window.innerWidth} × ${window.innerHeight} CSS px`,
        note: "The page area only. It is always smaller than the window, which is smaller than the screen — browser chrome, scrollbars and any open devtools all come out of this figure.",
      },
      {
        label: "Screen size (CSS px)",
        value: `${info.cssWidth} × ${info.cssHeight} CSS px`,
        note: "What the OS reports to the browser after any display scaling has been applied. This is not the panel's physical resolution: a 4K screen at 150% scaling reports 2560 × 1440 here.",
      },
      {
        label: "Device pixel ratio",
        value: trim(info.devicePixelRatio),
        note: "Combines OS display scaling and browser zoom into one number, so a value of 1.25 could be either. Set browser zoom back to 100% before you read it, or the rest of this table is measuring your zoom level.",
      },
      {
        label: "Physical pixels (derived)",
        value: `${info.deviceWidth} × ${info.deviceHeight} (${megapixels.toFixed(2)} MP)`,
        note: "Derived by multiplying the CSS screen size by the pixel ratio, not read from the hardware. It equals the panel's native resolution only when the OS is outputting native.",
      },
      {
        label: "Available screen area",
        value: `${window.screen.availWidth} × ${window.screen.availHeight} CSS px`,
        note: "Excludes space permanently claimed by OS furniture such as the Windows taskbar or the macOS menu bar and Dock.",
      },
      {
        label: "Colour depth",
        value: `${info.colorDepth}-bit`,
        note: "A weak signal. Browsers commonly report 24 or 30 regardless of the panel's true bit depth, and an 8-bit panel using dithering to fake 10-bit is indistinguishable here. Looking at a gradient for banding is the practical check.",
      },
      {
        label: "Orientation",
        value: orientation?.type ?? "not reported",
        note: "Reported by the Screen Orientation API. Desktop browsers usually say landscape-primary and never change it, even if you physically rotate the monitor.",
      },
      {
        label: "Reduced motion",
        value: matches("(prefers-reduced-motion: reduce)")
          ? "Requested"
          : "Not requested",
        note: "Your OS accessibility preference, passed through to the browser. Motion tests on this site honour it, which changes what they show you.",
      },
      {
        label: "Colour gamut",
        value: widestGamut(),
        note: "What the browser claims it can display, not verified panel coverage. Manufacturers routinely quote gamut figures that a display does not hit; confirming a real number needs a colorimeter, not a web page.",
      },
      {
        label: "Dynamic range",
        value: matches("(dynamic-range: high)")
          ? "High (HDR signalled)"
          : "Standard (SDR)",
        note: "HDR-capable signalling only. It says nothing about peak brightness, local dimming zones or whether HDR actually looks any good on this display.",
      },
    ],
  };
}
