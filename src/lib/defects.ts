/**
 * Defect log — the data model behind the guided run and the report.
 *
 * Stored entirely in localStorage. Nothing is transmitted: there is no backend,
 * no analytics and no account, so a user's panel faults never leave the device.
 *
 * Coordinates are normalised 0..1 against the viewport rather than stored in
 * pixels, so a report survives a window resize or a move to another display.
 */

export type DefectType = "hot" | "dead" | "stuck" | "unsure";

export const DEFECT_LABEL: Record<DefectType, string> = {
  hot: "Hot pixel — always lit white",
  dead: "Dead pixel — always black",
  stuck: "Stuck sub-pixel — one channel jammed",
  unsure: "Not sure yet",
};

/** Maps to ISO fault types 1, 2 and 3. `unsure` is excluded from grading. */
export const DEFECT_ISO_TYPE: Record<DefectType, 1 | 2 | 3 | null> = {
  hot: 1,
  dead: 2,
  stuck: 3,
  unsure: null,
};

/** Single-character marker codes. Must stay legible at 9px on a black chip. */
export const DEFECT_CODE: Record<DefectType, string> = {
  hot: "H",
  dead: "D",
  stuck: "S",
  unsure: "?",
};

/** Short button labels for the HUD, where there is no room for the full text. */
export const DEFECT_SHORT: Record<DefectType, string> = {
  hot: "Hot",
  dead: "Dead",
  stuck: "Stuck",
  unsure: "Unsure",
};

export const DEFECT_TYPES: readonly DefectType[] = [
  "dead",
  "hot",
  "stuck",
  "unsure",
];

export interface Defect {
  readonly id: string;
  /** Normalised 0..1, origin top-left. */
  readonly x: number;
  readonly y: number;
  readonly type: DefectType;
  /** Slug of the fill the user was on when they logged it. */
  readonly fillSlug: string;
  readonly at: number;
}

export interface ScreenInfo {
  /** CSS pixels. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly devicePixelRatio: number;
  /** Physical device pixels, derived. */
  readonly deviceWidth: number;
  readonly deviceHeight: number;
  readonly colorDepth: number;
}

export interface Session {
  readonly version: 1;
  readonly id: string;
  readonly startedAt: number;
  updatedAt: number;
  screen: ScreenInfo;
  defects: Defect[];
  /** Fill slugs the user has marked as checked. */
  completedFills: string[];
}

const STORAGE_KEY = "dpt.session.v1";

function newId(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function readScreenInfo(): ScreenInfo {
  const dpr = window.devicePixelRatio || 1;
  const w = window.screen.width;
  const h = window.screen.height;
  return {
    cssWidth: w,
    cssHeight: h,
    devicePixelRatio: dpr,
    deviceWidth: Math.round(w * dpr),
    deviceHeight: Math.round(h * dpr),
    colorDepth: window.screen.colorDepth,
  };
}

export function createSession(): Session {
  const now = Date.now();
  return {
    version: 1,
    id: newId(),
    startedAt: now,
    updatedAt: now,
    screen: readScreenInfo(),
    defects: [],
    completedFills: [],
  };
}

/**
 * Loads the stored session, or starts a fresh one.
 *
 * Any parse failure or version mismatch yields a new session rather than
 * throwing — a corrupted log must never break the tool.
 */
export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSession();
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as Session).version === 1 &&
      Array.isArray((parsed as Session).defects)
    ) {
      return parsed as Session;
    }
  } catch {
    /* fall through */
  }
  return createSession();
}

export function saveSession(session: Session): void {
  session.updatedAt = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private-mode or quota failure. The in-memory session still works for
    // this visit; we just can't persist it.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

export function addDefect(
  session: Session,
  input: { x: number; y: number; type: DefectType; fillSlug: string },
): Defect {
  const defect: Defect = {
    id: newId(),
    x: clamp01(input.x),
    y: clamp01(input.y),
    type: input.type,
    fillSlug: input.fillSlug,
    at: Date.now(),
  };
  session.defects.push(defect);
  saveSession(session);
  return defect;
}

export function removeDefect(session: Session, id: string): void {
  const i = session.defects.findIndex((d) => d.id === id);
  if (i >= 0) {
    session.defects.splice(i, 1);
    saveSession(session);
  }
}

export function markFillComplete(session: Session, slug: string): void {
  if (!session.completedFills.includes(slug)) {
    session.completedFills.push(slug);
    saveSession(session);
  }
}

export function countByType(session: Session): Record<DefectType, number> {
  const counts: Record<DefectType, number> = {
    hot: 0,
    dead: 0,
    stuck: 0,
    unsure: 0,
  };
  for (const d of session.defects) counts[d.type] += 1;
  return counts;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}
