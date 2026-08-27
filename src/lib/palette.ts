/**
 * Exact sRGB fill values for the diagnostic surfaces.
 *
 * These are NOT design tokens and must never be routed through the design
 * system, a filter, or a compositing layer — a fill has to reach the panel
 * bit-exact or the test is worthless. Hex is written in full 6-digit form so
 * no minifier can shorten it into a different colour space assumption.
 *
 * Why each fill exists, physically:
 *   · A DEAD pixel is permanently unlit, so it reads as a black dot and is
 *     only visible against WHITE or a light fill.
 *   · A STUCK (hot) pixel has one or more sub-pixels jammed on, so it reads as
 *     a coloured dot and is only visible against BLACK.
 *   · Pure R / G / B isolate WHICH sub-pixel is at fault.
 *   · Secondaries (C / M / Y) each omit one channel, so a sub-pixel that is
 *     dead in the omitted channel stays hidden while the other two expose it —
 *     this is the pair of tests most single-colour tools miss.
 *   · Greys reveal mura, clouding and backlight non-uniformity, which pure
 *     black hides on many IPS panels.
 */

export interface Fill {
  /** URL slug — also the sequence key. */
  readonly slug: string;
  readonly name: string;
  /** Full 6-digit sRGB hex. */
  readonly hex: string;
  /** Whether UI drawn on this fill needs light or dark ink for contrast. */
  readonly ink: "light" | "dark";
  /** What a user is looking for on this specific fill. */
  readonly reveals: string;
}

export const FILLS: readonly Fill[] = [
  {
    slug: "white",
    name: "White",
    hex: "#ffffff",
    ink: "dark",
    reveals:
      "Dead pixels — a pixel that receives no power stays black and is easiest to spot here. Also shows dust, smudges and permanent stains.",
  },
  {
    slug: "black",
    name: "Black",
    hex: "#000000",
    ink: "light",
    reveals:
      "Stuck and hot pixels — any sub-pixel jammed on appears as a bright coloured dot. Also the fill for backlight bleed and IPS glow.",
  },
  {
    slug: "red",
    name: "Red",
    hex: "#ff0000",
    ink: "light",
    reveals:
      "Faults in the red sub-pixel. A dot that stays dark here but lights up on green or blue has a dead red sub-pixel.",
  },
  {
    slug: "green",
    name: "Green",
    hex: "#00ff00",
    ink: "dark",
    reveals:
      "Faults in the green sub-pixel. Green carries most perceived luminance, so defects are unusually visible on this fill.",
  },
  {
    slug: "blue",
    name: "Blue",
    hex: "#0000ff",
    ink: "light",
    reveals:
      "Faults in the blue sub-pixel. Blue is the dimmest channel, so a dead blue sub-pixel is the easiest to overlook elsewhere.",
  },
  {
    slug: "cyan",
    name: "Cyan",
    hex: "#00ffff",
    ink: "dark",
    reveals:
      "Green + blue with red switched off. A stuck red sub-pixel shows here as a pale or white dot against the cyan.",
  },
  {
    slug: "magenta",
    name: "Magenta",
    hex: "#ff00ff",
    ink: "light",
    reveals:
      "Red + blue with green switched off. A stuck green sub-pixel is unmistakable against magenta.",
  },
  {
    slug: "yellow",
    name: "Yellow",
    hex: "#ffff00",
    ink: "dark",
    reveals:
      "Red + green with blue switched off. A stuck blue sub-pixel shows as a cool or white dot against the yellow.",
  },
  {
    slug: "grey-75",
    name: "Light grey",
    hex: "#bfbfbf",
    ink: "dark",
    reveals:
      "Partially-lit and weak pixels that disappear against full white. Also exposes light clouding.",
  },
  {
    slug: "grey-50",
    name: "Mid grey",
    hex: "#808080",
    ink: "dark",
    reveals:
      "Mura and backlight non-uniformity. A 50% field is the standard surface for judging evenness across a panel.",
  },
  {
    slug: "grey-25",
    name: "Dark grey",
    hex: "#404040",
    ink: "light",
    reveals:
      "Black-crush and low-end clouding. Many IPS panels hide uniformity faults on pure black but reveal them here.",
  },
  {
    slug: "grey-12",
    name: "Near black",
    hex: "#1f1f1f",
    ink: "light",
    reveals:
      "Shadow-detail separation and the faintest stuck sub-pixels, which can be lost in the glare of a pure-black field.",
  },
] as const;

/** Order the guided run walks through. Light-then-dark minimises eye strain. */
export const SEQUENCE_ORDER: readonly string[] = [
  "white",
  "grey-75",
  "grey-50",
  "grey-25",
  "black",
  "grey-12",
  "red",
  "green",
  "blue",
  "cyan",
  "magenta",
  "yellow",
] as const;

const BY_SLUG = new Map(FILLS.map((f) => [f.slug, f]));

export function getFill(slug: string): Fill | undefined {
  return BY_SLUG.get(slug);
}

/** The guided sequence, resolved. Skips any slug missing from FILLS. */
export function sequenceFills(): readonly Fill[] {
  return SEQUENCE_ORDER.map((s) => BY_SLUG.get(s)).filter(
    (f): f is Fill => f !== undefined,
  );
}
