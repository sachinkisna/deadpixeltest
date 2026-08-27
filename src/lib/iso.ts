/**
 * ISO pixel fault class evaluation.
 *
 * SOURCE — the class table below is transcribed from the ISO 13406-2 pixel
 * fault class definition:
 *   https://en.wikipedia.org/wiki/ISO_13406-2
 * Verified 2026-08-27.
 *
 * Standards lineage, stated accurately because it matters for warranty
 * arguments: the 2001 edition of ISO 13406-2 has been WITHDRAWN and superseded
 * by ISO 9241-302, -303, -305 and -307:2008. The fault-class scheme carried
 * over, and the 13406-2 class numbering is still what manufacturers quote in
 * practice, so both names appear in the UI.
 *
 * Two limits on what this module can honestly claim:
 *
 *   1. The classes are guidelines, not mandates. Manufacturers interpret them
 *      inconsistently and some ignore them entirely, so a computed class is
 *      evidence for a claim — never a guarantee of one.
 *   2. Cluster detection here is APPROXIMATE. ISO defines a cluster within a
 *      5x5 pixel block; we only have tap coordinates, which carry finger- or
 *      cursor-scale error far larger than five pixels. Clusters are therefore
 *      reported as "possible" and never used to fail a class outright.
 */

export type FaultClass = "I" | "II" | "III" | "IV";

export const FAULT_CLASSES: readonly FaultClass[] = [
  "I",
  "II",
  "III",
  "IV",
] as const;

interface ClassLimits {
  /** Type 1 — hot pixel, permanently lit white. */
  readonly type1: number;
  /** Type 2 — dead pixel, permanently black. */
  readonly type2: number;
  /** Type 3 — stuck sub-pixel, one or more channels jammed on or off. */
  readonly type3: number;
  /** Clusters containing more than one type 1 or type 2 fault. */
  readonly clusterFull: number;
  /** Clusters of type 3 faults. */
  readonly clusterSub: number;
}

/** Maximum permitted faults per MILLION pixels. */
export const CLASS_LIMITS: Readonly<Record<FaultClass, ClassLimits>> = {
  I: { type1: 0, type2: 0, type3: 0, clusterFull: 0, clusterSub: 0 },
  II: { type1: 2, type2: 2, type3: 5, clusterFull: 0, clusterSub: 2 },
  III: { type1: 5, type2: 15, type3: 50, clusterFull: 0, clusterSub: 5 },
  IV: { type1: 50, type2: 150, type3: 500, clusterFull: 5, clusterSub: 50 },
};

/**
 * The class most consumer panels are sold against, per the standard's own
 * commentary. Used only to contextualise a result, never as a promise about a
 * specific product.
 */
export const TYPICAL_CONSUMER_CLASS: FaultClass = "II";

export interface FaultCounts {
  readonly type1: number;
  readonly type2: number;
  readonly type3: number;
}

export interface ClassVerdict {
  readonly faultClass: FaultClass;
  readonly passes: boolean;
  /** Which fault types exceeded their allowance. */
  readonly exceeded: ReadonlyArray<{
    type: 1 | 2 | 3;
    found: number;
    allowed: number;
  }>;
}

export interface Evaluation {
  readonly megapixels: number;
  readonly counts: FaultCounts;
  /** Counts scaled to the per-million basis the standard uses. */
  readonly perMillion: FaultCounts;
  readonly verdicts: readonly ClassVerdict[];
  /** Strictest class the panel satisfies, or null if it fails even Class IV. */
  readonly bestClass: FaultClass | null;
}

/**
 * Grades a panel against every fault class.
 *
 * `megapixels` must be computed from PHYSICAL device pixels, not CSS pixels —
 * a 4K panel reported at 1920x1080 CSS with dpr 2 has 8.3 MP, and using the CSS
 * figure would roughly quadruple the per-million rate and wrongly fail panels.
 */
export function evaluate(
  counts: FaultCounts,
  megapixels: number,
): Evaluation {
  // Guard against a zero/unknown panel size producing Infinity.
  const mp = megapixels > 0 ? megapixels : 1;

  const perMillion: FaultCounts = {
    type1: counts.type1 / mp,
    type2: counts.type2 / mp,
    type3: counts.type3 / mp,
  };

  const verdicts = FAULT_CLASSES.map<ClassVerdict>((faultClass) => {
    const limits = CLASS_LIMITS[faultClass];
    const exceeded: Array<{ type: 1 | 2 | 3; found: number; allowed: number }> =
      [];

    if (perMillion.type1 > limits.type1) {
      exceeded.push({ type: 1, found: counts.type1, allowed: limits.type1 });
    }
    if (perMillion.type2 > limits.type2) {
      exceeded.push({ type: 2, found: counts.type2, allowed: limits.type2 });
    }
    if (perMillion.type3 > limits.type3) {
      exceeded.push({ type: 3, found: counts.type3, allowed: limits.type3 });
    }

    return { faultClass, passes: exceeded.length === 0, exceeded };
  });

  const best = verdicts.find((v) => v.passes)?.faultClass ?? null;

  return {
    megapixels: mp,
    counts,
    perMillion,
    verdicts,
    bestClass: best,
  };
}

export function megapixelsFrom(
  deviceWidth: number,
  deviceHeight: number,
): number {
  return (deviceWidth * deviceHeight) / 1_000_000;
}

/**
 * Flags defects sitting suspiciously close together.
 *
 * Returns groups of two or more defects within `thresholdFraction` of the
 * viewport's smaller edge. This is a HINT for the user to look again closely,
 * not an ISO cluster determination — see the module note.
 */
export function possibleClusters(
  defects: ReadonlyArray<{ id: string; x: number; y: number }>,
  thresholdFraction = 0.02,
): ReadonlyArray<readonly string[]> {
  const groups: string[][] = [];
  const assigned = new Set<string>();

  for (const a of defects) {
    if (assigned.has(a.id)) continue;
    const group = [a.id];
    for (const b of defects) {
      if (b.id === a.id || assigned.has(b.id)) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (Math.hypot(dx, dy) <= thresholdFraction) {
        group.push(b.id);
        assigned.add(b.id);
      }
    }
    if (group.length > 1) {
      assigned.add(a.id);
      groups.push(group);
    }
  }

  return groups;
}
