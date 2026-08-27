/**
 * Shared runtime for diagnostic surfaces.
 *
 * Centralises the four things every full-screen test needs:
 *   1. Fullscreen entry/exit, with an honest fallback where it isn't available.
 *   2. A screen wake lock — the stuck-pixel fixer runs for an hour or more and
 *      the display must not sleep partway through.
 *   3. Keyboard control, so no function requires a pointer.
 *   4. Cursor auto-hide, because a mouse arrow sitting on a black field looks
 *      exactly like a stuck pixel.
 *
 * Deliberately framework-free and side-effect-free on import so it can be
 * pulled into any Astro `<script>` without shipping a runtime.
 */

/* ── Vendor-prefix and draft-API shims ──────────────────────────────────────
   Declared locally rather than relying on lib.dom, which lags on Wake Lock
   and never covered the WebKit fullscreen prefixes. */

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

type NavigatorWithWakeLock = Navigator & { wakeLock?: WakeLockLike };

type ElementWithWebkitFs = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type DocumentWithWebkitFs = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

/* ── Capability detection ───────────────────────────────────────────────── */

/**
 * True when the Fullscreen API can be used on an arbitrary element.
 *
 * iPhone Safari is the notable failure: it exposes fullscreen for `<video>`
 * only, so a colour fill can never truly cover the screen there. We detect it
 * and tell the user plainly instead of silently rendering a partial fill that
 * would hide defects behind the browser chrome.
 */
export function fullscreenSupported(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as ElementWithWebkitFs;
  return Boolean(el.requestFullscreen ?? el.webkitRequestFullscreen);
}

export function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  const doc = document as DocumentWithWebkitFs;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ── Wake lock ──────────────────────────────────────────────────────────── */

/**
 * Holds a screen wake lock, re-acquiring it when the tab returns to the
 * foreground — the browser silently drops the lock on backgrounding, which
 * would otherwise let the screen sleep mid-test.
 */
export class WakeLockHolder {
  #sentinel: WakeLockSentinelLike | null = null;
  #wanted = false;
  #onVisibility: () => void;

  constructor() {
    this.#onVisibility = () => {
      if (this.#wanted && document.visibilityState === "visible") {
        void this.#acquire();
      }
    };
  }

  get supported(): boolean {
    if (typeof navigator === "undefined") return false;
    return "wakeLock" in navigator;
  }

  /** Held state. False when unsupported or when the request was refused. */
  get active(): boolean {
    return this.#sentinel !== null && !this.#sentinel.released;
  }

  async request(): Promise<boolean> {
    this.#wanted = true;
    document.addEventListener("visibilitychange", this.#onVisibility);
    return this.#acquire();
  }

  async #acquire(): Promise<boolean> {
    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock) return false;
    if (this.active) return true;
    try {
      const sentinel = await nav.wakeLock.request("screen");
      this.#sentinel = sentinel;
      sentinel.addEventListener("release", () => {
        this.#sentinel = null;
      });
      return true;
    } catch {
      // Refused (often a power-saving mode). Not fatal — the test still works,
      // the screen may just dim. Callers surface this via `active`.
      return false;
    }
  }

  async release(): Promise<void> {
    this.#wanted = false;
    document.removeEventListener("visibilitychange", this.#onVisibility);
    const sentinel = this.#sentinel;
    this.#sentinel = null;
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release();
      } catch {
        /* already gone */
      }
    }
  }
}

/* ── Surface controller ─────────────────────────────────────────────────── */

export interface SurfaceHandlers {
  /** Right / Down / PageDown / K. */
  onNext?: () => void;
  /** Left / Up / PageUp / J. */
  onPrev?: () => void;
  /** Space or Enter — pause, resume, or advance depending on the test. */
  onToggle?: () => void;
  /** Escape, or fullscreen exited by any other means. */
  onExit?: () => void;
  /** H — show/hide the on-screen help overlay. */
  onHelp?: () => void;
}

export interface SurfaceOptions extends SurfaceHandlers {
  /** Idle delay before the cursor is hidden. Defaults to 2000ms. */
  hideCursorAfterMs?: number;
  /** Request a wake lock on enter. Defaults to true. */
  keepAwake?: boolean;
}

export interface SurfaceController {
  enter(): Promise<void>;
  exit(): Promise<void>;
  destroy(): void;
  readonly wakeLock: WakeLockHolder;
}

/**
 * Wires a full-screen diagnostic surface.
 *
 * `root` is the element that goes fullscreen. Keyboard listeners live on
 * `document` so they work regardless of what holds focus, and are removed on
 * `destroy()`.
 */
export function createSurface(
  root: HTMLElement,
  options: SurfaceOptions = {},
): SurfaceController {
  const { hideCursorAfterMs = 2000, keepAwake = true } = options;
  const wakeLock = new WakeLockHolder();

  let cursorTimer: number | undefined;
  let active = false;

  const showCursor = (): void => {
    root.dataset.cursor = "visible";
    if (cursorTimer !== undefined) window.clearTimeout(cursorTimer);
    if (!active) return;
    cursorTimer = window.setTimeout(() => {
      root.dataset.cursor = "hidden";
    }, hideCursorAfterMs);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!active) return;
    // Never swallow a browser or AT shortcut.
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
      case "PageDown":
      case "k":
      case "K":
        options.onNext?.();
        break;
      case "ArrowLeft":
      case "ArrowUp":
      case "PageUp":
      case "j":
      case "J":
        options.onPrev?.();
        break;
      case " ":
      case "Enter":
        // Let real controls handle their own activation.
        if (
          event.target instanceof HTMLElement &&
          event.target.closest("button, a, input, select, textarea")
        ) {
          return;
        }
        options.onToggle?.();
        break;
      case "h":
      case "H":
      case "?":
        options.onHelp?.();
        break;
      case "Escape":
        void exit();
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  /** Fullscreen can be left via Esc, F11 or the OS — keep our state in step. */
  const onFullscreenChange = (): void => {
    if (active && !isFullscreen()) void exit();
  };

  async function enter(): Promise<void> {
    active = true;
    root.dataset.surface = "active";

    if (fullscreenSupported() && !isFullscreen()) {
      const el = root as ElementWithWebkitFs;
      try {
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      } catch {
        // Refused (usually not a user gesture). The surface still fills the
        // viewport; the HUD surfaces the degraded state to the user.
        root.dataset.fullscreen = "unavailable";
      }
    } else if (!fullscreenSupported()) {
      root.dataset.fullscreen = "unsupported";
    }

    if (keepAwake) void wakeLock.request();

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    root.addEventListener("pointermove", showCursor);
    showCursor();
  }

  async function exit(): Promise<void> {
    if (!active) return;
    active = false;

    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    root.removeEventListener("pointermove", showCursor);
    if (cursorTimer !== undefined) window.clearTimeout(cursorTimer);

    delete root.dataset.surface;
    root.dataset.cursor = "visible";

    await wakeLock.release();

    if (isFullscreen()) {
      const doc = document as DocumentWithWebkitFs;
      try {
        await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
      } catch {
        /* already exited */
      }
    }

    options.onExit?.();
  }

  function destroy(): void {
    void exit();
  }

  return { enter, exit, destroy, wakeLock };
}

/* ── Frame timing ───────────────────────────────────────────────────────── */

export interface RefreshSample {
  /** Median frames per second across the sample. */
  readonly hz: number;
  /** Mean frame interval, ms. */
  readonly meanMs: number;
  /** Highest interval seen — a large value means dropped frames. */
  readonly worstMs: number;
  readonly frames: number;
}

/**
 * Samples frame intervals via requestAnimationFrame and reports the median.
 *
 * Median rather than mean because a single scheduling hiccup skews a mean
 * badly, and the first few frames after a rAF loop starts are unreliable —
 * those are discarded.
 */
export function sampleRefreshRate(
  durationMs: number,
  onProgress?: (elapsedMs: number) => void,
): Promise<RefreshSample> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last: number | null = null;
    let start: number | null = null;
    const WARMUP_FRAMES = 5;
    let seen = 0;

    const tick = (now: number): void => {
      start ??= now;
      if (last !== null) {
        seen += 1;
        if (seen > WARMUP_FRAMES) intervals.push(now - last);
      }
      last = now;

      const elapsed = now - start;
      onProgress?.(elapsed);

      if (elapsed < durationMs) {
        requestAnimationFrame(tick);
        return;
      }

      if (intervals.length === 0) {
        resolve({ hz: 0, meanMs: 0, worstMs: 0, frames: 0 });
        return;
      }

      const sorted = [...intervals].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0
          ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
          : (sorted[mid] ?? 0);
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;

      resolve({
        hz: median > 0 ? Math.round((1000 / median) * 10) / 10 : 0,
        meanMs: Math.round(mean * 100) / 100,
        worstMs: Math.round((sorted.at(-1) ?? 0) * 100) / 100,
        frames: intervals.length,
      });
    };

    requestAnimationFrame(tick);
  });
}
