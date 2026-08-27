/**
 * Defect tagging — the interaction layer over a colour fill.
 *
 * Shared by the single-colour pages and the guided sequence so the behaviour is
 * identical everywhere. Wires itself up by querying `data-*` hooks inside the
 * surface, so a page only has to render the right markup.
 *
 * ── On keyboard access ──────────────────────────────────────────────────────
 * Tapping a defect's exact position needs a pointer, and there is no honest way
 * around that. But position is only a convenience for the visual map: ISO
 * grading depends solely on the count and type of each fault. So the HUD also
 * offers "Log at centre", which records the same defect with an approximate
 * position. A keyboard-only user gets a correct grade and a rough map, and the
 * report says the positions are approximate rather than implying precision we
 * do not have.
 *
 * ── On which markers are shown ──────────────────────────────────────────────
 * Only defects tagged on the *current* fill are drawn. A dead pixel found on
 * white is invisible on black, so carrying its marker across would put a ring
 * around a pixel the user cannot verify.
 */

import {
  DEFECT_CODE,
  DEFECT_LABEL,
  addDefect,
  loadSession,
  removeDefect,
  type Defect,
  type DefectType,
  type Session,
} from "./defects";

export interface TaggerOptions {
  /** The fullscreen surface. All hooks are queried within it. */
  surface: HTMLElement;
  /** Slug of the fill currently painted. Read at tag time, not cached. */
  currentFill: () => string;
  /** Fired after any change to the log. */
  onChange?: (session: Session) => void;
}

export interface Tagger {
  readonly armed: boolean;
  readonly type: DefectType;
  setArmed(armed: boolean): void;
  setType(type: DefectType): void;
  /** Redraw markers — call after the fill changes. */
  render(): void;
  readonly session: Session;
  destroy(): void;
}

export function createTagger(options: TaggerOptions): Tagger {
  const { surface, currentFill, onChange } = options;

  const session = loadSession();
  let armed = false;
  let type: DefectType = "dead";

  const armToggle = surface.querySelector<HTMLElement>("[data-tag-arm]");
  const panel = surface.querySelector<HTMLElement>("[data-tag-panel]");
  const centreBtn = surface.querySelector<HTMLElement>("[data-tag-centre]");
  const status = surface.querySelector<HTMLElement>("[data-tag-status]");
  const countEls = surface.querySelectorAll<HTMLElement>("[data-tag-count]");
  const typeBtns = Array.from(
    surface.querySelectorAll<HTMLElement>("[data-defect-type]"),
  );

  // Markers get their own container so re-rendering them never disturbs the
  // fill layer or the HUD.
  const layer = document.createElement("div");
  layer.className = "dpt-marker-layer";
  layer.style.position = "absolute";
  layer.style.inset = "0";
  surface.appendChild(layer);

  function announce(message: string): void {
    if (status) status.textContent = message;
  }

  function syncCounts(): void {
    const total = String(session.defects.length);
    for (const el of countEls) el.textContent = total;
  }

  function syncType(): void {
    for (const btn of typeBtns) {
      btn.setAttribute(
        "aria-pressed",
        String(btn.dataset.defectType === type),
      );
    }
  }

  function syncArmed(): void {
    armToggle?.setAttribute("aria-pressed", String(armed));
    if (panel) panel.hidden = !armed;
    surface.dataset.tagging = armed ? "on" : "off";
  }

  function drawMarker(defect: Defect): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dpt-marker";
    btn.dataset.markerId = defect.id;
    btn.dataset.code = DEFECT_CODE[defect.type];
    btn.style.left = `${defect.x * 100}%`;
    btn.style.top = `${defect.y * 100}%`;
    btn.setAttribute(
      "aria-label",
      `Remove marker: ${DEFECT_LABEL[defect.type]}`,
    );
    layer.appendChild(btn);
  }

  function render(): void {
    layer.replaceChildren();
    const fill = currentFill();
    for (const defect of session.defects) {
      if (defect.fillSlug === fill) drawMarker(defect);
    }
    syncCounts();
  }

  function log(x: number, y: number, approximate: boolean): void {
    addDefect(session, { x, y, type, fillSlug: currentFill() });
    render();
    onChange?.(session);
    announce(
      `${DEFECT_LABEL[type]} logged${approximate ? " at screen centre" : ""}. ` +
        `${session.defects.length} total.`,
    );
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!armed) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    // A tap on our own chrome is not a defect report.
    if (target.closest(".dpt-hud, .dpt-marker")) return;

    const rect = surface.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    event.preventDefault();
    log(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
      false,
    );
  };

  const onLayerClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const marker = target.closest<HTMLElement>(".dpt-marker");
    const id = marker?.dataset.markerId;
    if (!id) return;
    event.stopPropagation();
    removeDefect(session, id);
    render();
    onChange?.(session);
    announce(`Marker removed. ${session.defects.length} total.`);
  };

  const onArmClick = (): void => setArmed(!armed);

  const onTypeClick = (event: Event): void => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const next = target.dataset.defectType as DefectType | undefined;
    if (next) setType(next);
  };

  const onCentreClick = (): void => {
    if (!armed) setArmed(true);
    log(0.5, 0.5, true);
  };

  function setArmed(next: boolean): void {
    armed = next;
    syncArmed();
    announce(
      armed
        ? "Marking on. Tap a defect, or use Log at centre."
        : "Marking off.",
    );
  }

  function setType(next: DefectType): void {
    type = next;
    syncType();
    announce(`Marking as: ${DEFECT_LABEL[next]}.`);
  }

  surface.addEventListener("pointerdown", onPointerDown);
  layer.addEventListener("click", onLayerClick);
  armToggle?.addEventListener("click", onArmClick);
  centreBtn?.addEventListener("click", onCentreClick);
  for (const btn of typeBtns) btn.addEventListener("click", onTypeClick);

  syncArmed();
  syncType();
  render();

  return {
    get armed() {
      return armed;
    },
    get type() {
      return type;
    },
    get session() {
      return session;
    },
    setArmed,
    setType,
    render,
    destroy(): void {
      surface.removeEventListener("pointerdown", onPointerDown);
      layer.removeEventListener("click", onLayerClick);
      armToggle?.removeEventListener("click", onArmClick);
      centreBtn?.removeEventListener("click", onCentreClick);
      for (const btn of typeBtns) btn.removeEventListener("click", onTypeClick);
      layer.remove();
    },
  };
}
