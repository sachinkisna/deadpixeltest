/**
 * report — turns a stored session into a gradeable result.
 *
 * This is the payoff for the whole guided run: the competitor's tools end at
 * "here is a red screen, good luck", and a user who finds a fault is left with
 * nothing to take to a retailer. This module produces an actual grade, an
 * actual count by fault type, and a plain-text summary that can be pasted into
 * a support ticket.
 *
 * Two accuracy rules are load-bearing here, both inherited from `iso.ts`:
 *
 *   1. Grading uses PHYSICAL DEVICE PIXELS. The per-million basis means a 4K
 *      panel read as its 1920x1080 CSS size at dpr 2 would be graded roughly
 *      four times too harshly, which could talk someone out of a valid claim.
 *   2. Clusters are reported as POSSIBLE and never fail a class. Tap
 *      coordinates carry finger-scale error; ISO's cluster rule is a 5x5 pixel
 *      block. The two are orders of magnitude apart.
 */

import {
  countByType,
  DEFECT_ISO_TYPE,
  DEFECT_LABEL,
  DEFECT_SHORT,
  loadSession,
  type Defect,
  type DefectType,
  type Session,
} from "./defects";
import {
  CLASS_LIMITS,
  evaluate,
  FAULT_CLASSES,
  megapixelsFrom,
  possibleClusters,
  TYPICAL_CONSUMER_CLASS,
  type Evaluation,
  type FaultClass,
} from "./iso";
import { getFill } from "./palette";

/** Human names for the three ISO fault types, in the standard's own terms. */
export const ISO_TYPE_NAME: Record<1 | 2 | 3, string> = {
  1: "Type 1 — permanently lit (bright)",
  2: "Type 2 — permanently dark (dead)",
  3: "Type 3 — stuck sub-pixel",
};

export interface ClassRow {
  readonly faultClass: FaultClass;
  readonly passes: boolean;
  /**
   * Absolute fault allowance on THIS panel, derived from the per-million limit.
   * Floored, because the standard's test is `found / megapixels > limit`, so a
   * fractional allowance is not usable.
   */
  readonly allowed: { type1: number; type2: number; type3: number };
  readonly exceeded: readonly string[];
}

export interface ReportModel {
  readonly session: Session;
  readonly counts: Record<DefectType, number>;
  /** Total including `unsure`. */
  readonly total: number;
  /** Faults that carry an ISO type, i.e. everything except `unsure`. */
  readonly graded: number;
  readonly evaluation: Evaluation;
  readonly rows: readonly ClassRow[];
  /** Groups of defect indices (1-based, for display) sitting close together. */
  readonly clusters: ReadonlyArray<readonly number[]>;
  readonly typicalClass: FaultClass;
  readonly hasDefects: boolean;
  readonly viewedFills: number;
}

export function buildReport(session: Session = loadSession()): ReportModel {
  const counts = countByType(session);

  const isoCounts = {
    type1: counts.hot,
    type2: counts.dead,
    type3: counts.stuck,
  };

  // Physical pixels, not CSS pixels. See the module note.
  const megapixels = megapixelsFrom(
    session.screen.deviceWidth,
    session.screen.deviceHeight,
  );

  const evaluation = evaluate(isoCounts, megapixels);
  const mp = evaluation.megapixels;

  const rows = FAULT_CLASSES.map<ClassRow>((faultClass) => {
    const limits = CLASS_LIMITS[faultClass];
    const verdict = evaluation.verdicts.find((v) => v.faultClass === faultClass);
    return {
      faultClass,
      passes: verdict?.passes ?? false,
      allowed: {
        type1: Math.floor(limits.type1 * mp),
        type2: Math.floor(limits.type2 * mp),
        type3: Math.floor(limits.type3 * mp),
      },
      exceeded: (verdict?.exceeded ?? []).map(
        (e) => `${ISO_TYPE_NAME[e.type]}: ${e.found} found`,
      ),
    };
  });

  // Map cluster ids back to the 1-based positions the user sees in the list.
  const indexById = new Map(session.defects.map((d, i) => [d.id, i + 1]));
  const clusters = possibleClusters(session.defects).map((group) =>
    group
      .map((id) => indexById.get(id))
      .filter((n): n is number => n !== undefined)
      .sort((a, b) => a - b),
  );

  const graded = counts.hot + counts.dead + counts.stuck;

  return {
    session,
    counts,
    total: session.defects.length,
    graded,
    evaluation,
    rows,
    clusters,
    typicalClass: TYPICAL_CONSUMER_CLASS,
    hasDefects: session.defects.length > 0,
    viewedFills: session.completedFills.length,
  };
}

/** Where a defect sits, in the words a support agent will understand. */
export function describePosition(defect: Defect): string {
  const col = defect.x < 0.33 ? "left" : defect.x > 0.67 ? "right" : "centre";
  const row = defect.y < 0.33 ? "top" : defect.y > 0.67 ? "bottom" : "middle";
  if (col === "centre" && row === "middle") return "centre";
  if (col === "centre") return `${row} centre`;
  if (row === "middle") return `${col} middle`;
  return `${row} ${col}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * A plain-text summary, for pasting into a support ticket or an email.
 *
 * Deliberately text and not a PDF: text survives copy-paste into any ticketing
 * form, and a warranty conversation happens in prose. It states its own
 * approximations inline rather than in a footnote a reader will skip.
 */
export function reportAsText(model: ReportModel): string {
  const { session, counts, evaluation } = model;
  const s = session.screen;
  const lines: string[] = [];

  lines.push("SCREEN FAULT REPORT");
  lines.push("Produced with deadpixeltest.space — a browser-based screen test.");
  lines.push(`Date: ${new Date(session.updatedAt).toISOString().slice(0, 10)}`);
  lines.push("");

  lines.push("DISPLAY");
  lines.push(`  Reported size: ${s.cssWidth} x ${s.cssHeight} CSS pixels`);
  lines.push(`  Device pixel ratio: ${s.devicePixelRatio}`);
  lines.push(
    `  Derived physical pixels: ${s.deviceWidth} x ${s.deviceHeight} (${evaluation.megapixels.toFixed(2)} MP)`,
  );
  lines.push(`  Reported colour depth: ${s.colorDepth}-bit`);
  lines.push("");

  lines.push("FAULTS FOUND");
  lines.push(`  Type 1, permanently lit (bright):  ${counts.hot}`);
  lines.push(`  Type 2, permanently dark (dead):   ${counts.dead}`);
  lines.push(`  Type 3, stuck sub-pixel:           ${counts.stuck}`);
  if (counts.unsure > 0) {
    lines.push(
      `  Unclassified (excluded from grading): ${counts.unsure}`,
    );
  }
  lines.push("");

  if (model.total > 0) {
    lines.push("FAULT LIST");
    session.defects.forEach((d, i) => {
      const fill = getFill(d.fillSlug);
      lines.push(
        `  ${i + 1}. ${DEFECT_SHORT[d.type]} — ${describePosition(d)} (approx. ${pct(d.x)} across, ${pct(d.y)} down)` +
          (fill ? `, found on the ${fill.name} fill` : ""),
      );
    });
    lines.push("");
  }

  lines.push("ISO FAULT CLASS");
  lines.push(
    "  Classes per ISO 13406-2 (withdrawn 2001 edition), carried over into",
  );
  lines.push("  ISO 9241-302/303/305/307:2008. Limits are per million pixels.");
  for (const row of model.rows) {
    lines.push(
      `  Class ${row.faultClass}: ${row.passes ? "PASS" : "FAIL"}  ` +
        `(allows ${row.allowed.type1} type 1, ${row.allowed.type2} type 2, ` +
        `${row.allowed.type3} type 3 on a ${evaluation.megapixels.toFixed(2)} MP panel)`,
    );
  }
  lines.push(
    evaluation.bestClass
      ? `  Strictest class satisfied: Class ${evaluation.bestClass}`
      : "  This panel does not satisfy Class IV, the most permissive class.",
  );
  lines.push("");

  if (model.clusters.length > 0) {
    lines.push("POSSIBLE CLUSTERS");
    lines.push(
      "  These faults were logged close together. ISO defines a cluster within a",
    );
    lines.push(
      "  5x5 pixel block; the positions here are tap-accurate at best, so this is",
    );
    lines.push("  a prompt to look again closely, not a cluster determination.");
    for (const group of model.clusters) {
      lines.push(`  Faults ${group.join(", ")}`);
    }
    lines.push("");
  }

  lines.push("LIMITS OF THIS REPORT");
  lines.push(
    "  · Fault positions are recorded by tapping and are approximate. Faults",
  );
  lines.push(
    "    logged with the keyboard are recorded at the screen centre by design.",
  );
  lines.push(
    "  · The physical pixel count is derived from the browser's reported size",
  );
  lines.push(
    "    and pixel ratio. It matches the panel only when the operating system is",
  );
  lines.push("    outputting at native resolution.");
  lines.push(
    "  · The ISO classes are guidelines, not mandates. Manufacturers interpret",
  );
  lines.push(
    "    them inconsistently. This report is evidence for a claim, not a",
  );
  lines.push("    guarantee of one — the seller's own policy governs.");
  lines.push(
    "  · Fault types were identified by eye, by the person running the test.",
  );

  return lines.join("\n");
}

export { DEFECT_ISO_TYPE, DEFECT_LABEL, DEFECT_SHORT };
