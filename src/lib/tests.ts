/**
 * The test registry — single source of truth.
 *
 * Nav, homepage grid, related-test links and the sitemap all derive from this
 * array. Adding a test means adding one entry here; nothing else needs editing.
 */

export type TestCategory = "pixels" | "panel" | "motion" | "signal";

export interface TestDef {
  readonly slug: string;
  /** Route path. */
  readonly href: string;
  readonly name: string;
  /** One line, sentence case. Shown on cards and in nav. */
  readonly blurb: string;
  readonly category: TestCategory;
  /** Longer copy for the test page's own header. */
  readonly description: string;
  /**
   * True when the test needs a darkened room to read correctly. Surfaced as a
   * prerequisite so users don't record a false result at midday.
   */
  readonly needsDarkRoom?: boolean;
  /**
   * Set when a browser genuinely cannot measure the thing precisely. Rendered
   * verbatim on the page as a limitation notice — we state this rather than
   * implying an accuracy we don't have.
   */
  readonly limitation?: string;
}

export const CATEGORY_LABEL: Record<TestCategory, string> = {
  pixels: "Pixel faults",
  panel: "Panel quality",
  motion: "Motion & timing",
  signal: "Signal & output",
};

export const CATEGORY_ORDER: readonly TestCategory[] = [
  "pixels",
  "panel",
  "motion",
  "signal",
] as const;

export const TESTS: readonly TestDef[] = [
  // ── Pixel faults ────────────────────────────────────────────────────────
  {
    slug: "sequence",
    href: "/test/sequence",
    name: "Guided Pixel Test",
    blurb: "Step through 12 full-screen fills and log every fault you find.",
    category: "pixels",
    description:
      "Walks the full set of diagnostic fills in the order that makes faults easiest to see, and records where you tap so you finish with a map of every defect rather than a vague memory of one.",
  },
  {
    slug: "colors",
    href: "/test/white",
    name: "Single Colour Fills",
    blurb: "Jump straight to any one of 12 exact sRGB fills.",
    category: "pixels",
    description:
      "Each fill is a flat, uncompressed sRGB colour rendered by the browser itself. Arrow keys cycle between them without leaving full screen.",
  },
  {
    slug: "fixer",
    href: "/fixer",
    name: "Stuck Pixel Fixer",
    blurb: "Cycle colours over a stuck sub-pixel to try to free it.",
    category: "pixels",
    description:
      "Rapidly exercises a sub-pixel that has jammed in one state. This can sometimes free a stuck pixel; it will not revive a genuinely dead one, which receives no power at all.",
  },
  {
    slug: "inversion",
    href: "/test/inversion",
    name: "Pixel Inversion Test",
    blurb: "Alternating fine patterns that expose voltage-inversion artefacts.",
    category: "pixels",
    description:
      "Draws single-pixel checkerboards and line pairs. On a panel with an inversion fault these shimmer, flicker or show horizontal banding instead of sitting perfectly still.",
  },

  // ── Panel quality ───────────────────────────────────────────────────────
  {
    slug: "uniformity",
    href: "/test/uniformity",
    name: "Backlight Uniformity",
    blurb: "Flat grey fields that reveal mura, clouding and hot spots.",
    category: "panel",
    description:
      "A uniform grey field should look identical corner to corner. Patches, clouds or brighter zones indicate uneven backlight diffusion.",
    needsDarkRoom: true,
  },
  {
    slug: "backlight-bleed",
    href: "/test/backlight-bleed",
    name: "Backlight Bleed & IPS Glow",
    blurb: "Pure black at full screen to expose edge light leakage.",
    category: "panel",
    description:
      "Light escaping around the bezel shows as bright edges or corner flares on a black field. IPS glow differs from bleed in that it shifts as you move your head — the page explains how to tell them apart.",
    needsDarkRoom: true,
  },
  {
    slug: "banding",
    href: "/test/banding",
    name: "Gradient Banding Test",
    blurb: "Smooth ramps that expose posterisation and dithering.",
    category: "panel",
    description:
      "A true 8-bit-per-channel panel renders these ramps as a smooth sweep. Visible steps mean the panel or the signal chain is quantising the gradient.",
  },
  {
    slug: "contrast",
    href: "/test/contrast",
    name: "Contrast & Black Level",
    blurb: "Near-black and near-white steps to check for crushing or clipping.",
    category: "panel",
    description:
      "Counts how many of the darkest and lightest steps you can still distinguish, which tells you whether the panel or its settings are clipping shadow and highlight detail.",
  },
  {
    slug: "viewing-angle",
    href: "/test/viewing-angle",
    name: "Viewing Angle Test",
    blurb: "Reference patches for judging shift as you move off-axis.",
    category: "panel",
    description:
      "Identical patches placed across the panel. On a TN or heavily-curved display, colour and gamma drift noticeably between centre and edge even when viewed straight on.",
  },
  {
    slug: "sharpness",
    href: "/test/sharpness",
    name: "Sharpness & Text Clarity",
    blurb: "Fine grids and text ladders that expose scaling and oversharpening.",
    category: "panel",
    description:
      "Single-pixel grids should look crisp and even. Moiré, softness or ringing usually means the display is not running at its native resolution or has a sharpness filter applied.",
  },

  // ── Motion & timing ─────────────────────────────────────────────────────
  {
    slug: "refresh-rate",
    href: "/test/refresh-rate",
    name: "Refresh Rate Test",
    blurb: "Measure the refresh rate the browser is actually receiving.",
    category: "motion",
    description:
      "Samples frame timings and reports the sustained rate, so you can confirm a 144 Hz panel is not quietly running at 60 Hz because of a cable or driver default.",
  },
  {
    slug: "response-time",
    href: "/test/response-time",
    name: "Response Time & Ghosting",
    blurb: "Moving edges for judging smearing, ghosting and overshoot.",
    category: "motion",
    limitation:
      "A browser cannot measure true grey-to-grey response time. The panel's own processing happens after anything JavaScript can observe, so no page can report a trustworthy millisecond figure. This is a perceptual test: it shows you smearing and inverse ghosting so you can judge them by eye and compare overdrive settings.",
    description:
      "Drives high-contrast edges across the screen at controlled speeds. Trailing smear indicates slow pixel transitions; a bright leading or trailing halo indicates overdrive overshoot.",
  },

  // ── Signal & output ─────────────────────────────────────────────────────
  {
    slug: "resolution",
    href: "/test/resolution",
    name: "Resolution & Scaling",
    blurb: "Report real pixel dimensions, density and colour depth.",
    category: "signal",
    description:
      "Shows the resolution the browser sees, the device pixel ratio behind it and the reported colour depth — enough to tell whether you are running native or scaled.",
  },
] as const;

const BY_SLUG = new Map(TESTS.map((t) => [t.slug, t]));

export function getTest(slug: string): TestDef | undefined {
  return BY_SLUG.get(slug);
}

export function testsByCategory(category: TestCategory): readonly TestDef[] {
  return TESTS.filter((t) => t.category === category);
}

/** Grouped in display order, skipping any empty category. */
export function groupedTests(): ReadonlyArray<{
  category: TestCategory;
  label: string;
  tests: readonly TestDef[];
}> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABEL[category],
    tests: testsByCategory(category),
  })).filter((g) => g.tests.length > 0);
}
