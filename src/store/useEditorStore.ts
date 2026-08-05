import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  ArrayOptions,
  ColumnSpec,
  WallSpec,
  DialogState,
  DocSnapshot,
  DrawingDoc,
  HiddenLineMode,
  Material,
  MaterialDraft,
  Piece,
  Warehouse,
} from '../types';
import { SEED_MATERIALS, createSeedMaterials, defaultDepth } from '../data/seedCatalog';
import { sanitizeMaterial } from '../lib/catalogFile';
import {
  clampZoom,
  computeEdgeSnap,
  contentBounds,
  MAX_ZOOM,
  MIN_ZOOM,
  normalizeRot,
  pieceBounds,
  snapValue,
  unionRect,
} from '../lib/geometry';
import { makeMaterialId, uid } from '../lib/ids';
import { DEFAULT_WAREHOUSE, normalizeStock, withStockIn } from '../lib/inventory';
import { planColumn } from '../lib/columnWizard';
import { planWall } from '../lib/wallWizard';
import { isConfigured } from '../lib/supabase';
import type { DataSnapshot } from '../lib/syncDiff';

export const STORAGE_KEY = 'du-formwork-v2';

/**
 * Where preferences go once the backend is in use.
 *
 * Deliberately a different key from `STORAGE_KEY`. With a server, company data
 * is no longer persisted locally, so writing preferences back to the old key
 * would overwrite the saved catalog and drawings with a file containing
 * nothing but zoom and toggle states — destroying the very data the migration
 * exists to import. Leaving that key untouched also keeps it as an on-disk
 * backup of everything from before the move.
 */
export const PREFS_KEY = 'du-formwork-prefs';

const HISTORY_LIMIT = 80;

/** Settings that belong to one person on one machine, not to the company. */
const PREF_KEYS = [
  'zoom',
  'panX',
  'panY',
  'snap',
  'snapStep',
  'edgeSnap',
  'showDims',
  'showNames',
  'forceLabels',
  'showOverlaps',
  'viewMode',
  'hiddenLines',
  'paletteOpen',
  'inspectorOpen',
] as const;

/**
 * One-off corrections to built-in sizes that were wrong in the v1 port.
 *
 * Applied only where the stored value still matches the wrong one, so a company
 * that has already entered its own size keeps it. Without this, a saved catalog
 * would carry the broken dimension forever — stored materials always win over
 * the seed, which is what makes user edits stick.
 *
 * Must stay ABOVE `create()`: rehydration runs while the store is being built,
 * so anything it reaches has to be initialised by then. A `const` declared
 * further down the file is still in its temporal dead zone at that moment, and
 * the ReferenceError is swallowed by the persist middleware — the saved drawing
 * is silently dropped and then overwritten with an empty one.
 */
const BUILTIN_SIZE_FIXES: Array<{ id: string; fromW: number; toW: number }> = [
  // A 15 cm outer-corner leg cannot both wrap a 9 cm panel and cover 15 cm of
  // concrete face. The mismatch left a hole beside every corner and made the
  // column wizard lay panels that did not reach the corner profile.
  { id: 'corner-outer-300', fromW: 15, toW: 24 },
];

/** Applies `BUILTIN_SIZE_FIXES` in place. Exported for testing. */
export function applySizeFixes(materials: Material[]): void {
  for (const fix of BUILTIN_SIZE_FIXES) {
    const m = materials.find((x) => x.id === fix.id);
    if (!m || !m.builtin || m.w !== fix.fromW) continue;
    m.w = fix.toW;
    m.depth = defaultDepth(m.category, m.w, m.h);
  }
}

export interface EditorState {
  // ── data ──
  materials: Material[];
  /** placed pieces of the active drawing (mirrored into `documents`) */
  pieces: Piece[];
  removedBuiltins: string[];
  documents: DrawingDoc[];
  activeDocId: string;
  warehouses: Warehouse[];
  /**
   * False until the server's data has been loaded. The sync engine watches
   * this: pushing before it is true would upload the seed catalog and the
   * empty starter drawing over whatever the company actually has.
   */
  dataLoaded: boolean;

  // ── history ──
  past: DocSnapshot[];
  future: DocSnapshot[];

  // ── view ──
  zoom: number;
  panX: number;
  panY: number;
  stageW: number;
  stageH: number;

  // ── editor settings ──
  snap: boolean;
  snapStep: number;
  /** snap dragged pieces to the edges of nearby pieces, not just the grid */
  edgeSnap: boolean;
  showDims: boolean;
  showNames: boolean;
  forceLabels: boolean;
  /** highlight pieces whose footprints intersect */
  showOverlaps: boolean;
  /** 2D plan editor, or the read-only 3D visualisation */
  viewMode: '2d' | '3d';
  /** what the 3D view does with edges that sit behind other pieces */
  hiddenLines: HiddenLineMode;
  /** side panels can be folded away to give the canvas room on small screens */
  paletteOpen: boolean;
  inspectorOpen: boolean;

  // ── transient UI ──
  selectedIds: string[];
  clipboard: Piece[];
  paletteQuery: string;
  dialog: DialogState;
  toast: string | null;
  storageError: string | null;
  /** world-space alignment lines shown during an edge-snapped drag */
  guideX: number | null;
  guideY: number | null;
  /** material being dragged in from the palette, for the drop preview */
  draggingMaterialId: string | null;

  // ── actions: data ──
  /** Replace all company data with what the server holds. */
  hydrateFromServer: (snapshot: DataSnapshot) => void;
  /** Mark the local-only path as ready, when there is no server to wait for. */
  markLoadedOffline: () => void;

  // ── actions: view ──
  setStageSize: (w: number, h: number) => void;
  setPan: (panX: number, panY: number) => void;
  zoomAt: (factor: number, screenX: number, screenY: number) => void;
  zoomBy: (factor: number) => void;
  fitToContent: () => void;
  resetView: () => void;

  // ── actions: selection ──
  select: (id: string | null) => void;
  toggleSelect: (id: string) => void;
  setSelection: (ids: string[]) => void;
  selectAll: () => void;

  // ── actions: pieces ──
  addPiece: (materialId: string, worldX: number, worldY: number) => void;
  setDraggingMaterial: (materialId: string | null) => void;
  beginDrag: () => void;
  moveSelectionBy: (dxCm: number, dyCm: number, baseline: Piece[]) => void;
  endDrag: () => void;
  nudgeSelection: (dxCm: number, dyCm: number) => void;
  rotateSelected: (step?: number) => void;
  setRotation: (deg: number) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  arraySelection: (options: ArrayOptions) => void;
  generateColumn: (spec: ColumnSpec) => { added: number; warnings: string[] };
  generateWall: (spec: WallSpec) => { added: number; warnings: string[] };
  /** Drop a saved assembly's pieces onto the surface, already positioned. */
  insertPieces: (pieces: Piece[]) => void;
  clearPieces: () => void;
  replaceLayout: (pieces: Piece[]) => void;

  // ── actions: history ──
  undo: () => void;
  redo: () => void;

  // ── actions: documents ──
  newDocument: (name?: string) => void;
  switchDocument: (id: string) => void;
  renameDocument: (id: string, name: string) => void;
  duplicateDocument: (id: string) => void;
  deleteDocument: (id: string) => void;
  setTitleBlock: (patch: Partial<Pick<DrawingDoc, 'projectName' | 'revision' | 'scale'>>) => void;

  // ── actions: warehouses ──
  addWarehouse: (name: string) => void;
  renameWarehouse: (id: string, name: string) => void;
  deleteWarehouse: (id: string) => void;

  // ── actions: settings ──
  setSnap: (on: boolean) => void;
  setSnapStep: (step: number) => void;
  setEdgeSnap: (on: boolean) => void;
  setShowDims: (on: boolean) => void;
  setShowNames: (on: boolean) => void;
  setForceLabels: (on: boolean) => void;
  setShowOverlaps: (on: boolean) => void;
  setViewMode: (mode: '2d' | '3d') => void;
  setHiddenLines: (mode: HiddenLineMode) => void;
  setPaletteOpen: (on: boolean) => void;
  setInspectorOpen: (on: boolean) => void;
  setPaletteQuery: (q: string) => void;

  // ── actions: catalog ──
  addMaterial: (draft: MaterialDraft) => Material;
  updateMaterial: (id: string, draft: MaterialDraft) => void;
  deleteMaterial: (id: string, cascade: boolean) => void;
  setStock: (id: string, warehouseId: string, quantity: number) => void;
  importMaterials: (drafts: MaterialDraft[]) => number;
  replaceCatalog: (materials: Material[], warehouses?: Warehouse[]) => number;
  resetCatalog: () => void;

  // ── actions: dialogs ──
  openDialog: (dialog: DialogState) => void;
  closeDialog: () => void;
  setToast: (message: string | null) => void;
}

const DEFAULT_VIEW = { zoom: 1, panX: 40, panY: 40 };

function newDoc(name: string, pieces: Piece[] = []): DrawingDoc {
  return {
    id: uid('doc'),
    name,
    updatedAt: Date.now(),
    pieces,
    projectName: '',
    revision: 'A',
    scale: 50,
  };
}

/** The slice of state that undo/redo restores. */
function snap(s: EditorState): DocSnapshot {
  return { materials: s.materials, pieces: s.pieces, removedBuiltins: s.removedBuiltins };
}

/**
 * localStorage can throw (quota, private browsing). Swallow the failure and
 * record it so the UI can warn instead of silently losing the user's work.
 */
let onStorageFailure: (message: string) => void = () => {};

const safeStorage = createJSONStorage(() => ({
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch (e) {
      const quota = e instanceof DOMException && e.name === 'QuotaExceededError';
      onStorageFailure(
        quota
          ? 'ავტოშენახვა ვერ მოხერხდა — ბრაუზერის მეხსიერება გადაივსო. გააკეთე ექსპორტი და წაშალე ძველი ნახაზები.'
          : 'ავტოშენახვა ვერ მოხერხდა. გააკეთე ექსპორტი, რომ სამუშაო არ დაიკარგოს.',
      );
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
}));

export const useEditorStore = create<EditorState>()(
  persist(
    (set, get) => {
      /** Mirror the working pieces back into the active document. */
      const syncDoc = (s: EditorState, patch: Partial<EditorState>): Partial<EditorState> => {
        if (!patch.pieces) return patch;
        const pieces = patch.pieces;
        return {
          ...patch,
          documents: s.documents.map((d) =>
            d.id === s.activeDocId ? { ...d, pieces, updatedAt: Date.now() } : d,
          ),
        };
      };

      /** Mutation without a history entry (used for live dragging). */
      const apply = (fn: (s: EditorState) => Partial<EditorState>) =>
        set((s) => syncDoc(s, fn(s)));

      /** Mutation that starts a new undo step. */
      const commit = (fn: (s: EditorState) => Partial<EditorState>) =>
        set((s) => ({
          ...syncDoc(s, fn(s)),
          past: [...s.past, snap(s)].slice(-HISTORY_LIMIT),
          future: [],
        }));

      const snapPoint = (s: EditorState, x: number, y: number) => ({
        x: snapValue(x, s.snapStep, s.snap),
        y: snapValue(y, s.snapStep, s.snap),
      });

      const firstDoc = newDoc('ნახაზი 1');

      return {
        materials: SEED_MATERIALS,
        pieces: [],
        removedBuiltins: [],
        documents: [firstDoc],
        activeDocId: firstDoc.id,
        warehouses: [{ ...DEFAULT_WAREHOUSE }],
        // With a server, nothing here is real until it has been loaded.
        dataLoaded: !isConfigured,

        past: [],
        future: [],

        ...DEFAULT_VIEW,
        stageW: 1000,
        stageH: 700,

        snap: true,
        snapStep: 5,
        edgeSnap: true,
        showDims: true,
        showNames: true,
        forceLabels: false,
        showOverlaps: true,
        viewMode: '2d',
        hiddenLines: 'hide',
        // Start folded on a phone-ish window so the canvas is usable at all.
        paletteOpen: typeof window === 'undefined' || window.innerWidth > 900,
        inspectorOpen: typeof window === 'undefined' || window.innerWidth > 1100,

        selectedIds: [],
        clipboard: [],
        paletteQuery: '',
        dialog: null,
        toast: null,
        storageError: null,
        guideX: null,
        guideY: null,
        draggingMaterialId: null,

        // ── data ──────────────────────────────────────────────────────────
        /**
         * Adopt the server's data wholesale.
         *
         * Gaps are filled rather than left empty so a brand-new project is
         * usable immediately: no warehouse means the default store, no catalog
         * means the built-in Du materials, no drawings means one blank sheet.
         * Whatever is filled in here is pushed up by the next sync, so the
         * server ends up holding it too.
         */
        hydrateFromServer: (snapshot) =>
          set((s) => {
            const materials = snapshot.materials.length
              ? snapshot.materials
              : createSeedMaterials();
            applySizeFixes(materials);

            const warehouses = snapshot.warehouses.length
              ? snapshot.warehouses
              : [{ ...DEFAULT_WAREHOUSE }];

            const documents = snapshot.documents.length
              ? snapshot.documents
              : [newDoc('ნახაზი 1')];

            // Stay on the same drawing across a reload where possible.
            const active =
              documents.find((d) => d.id === s.activeDocId) ?? documents[0];

            return {
              materials,
              warehouses,
              documents,
              activeDocId: active.id,
              pieces: active.pieces,
              removedBuiltins: [],
              dataLoaded: true,
              selectedIds: [],
              past: [],
              future: [],
            };
          }),

        markLoadedOffline: () => set({ dataLoaded: true }),

        // ── view ──────────────────────────────────────────────────────────
        setStageSize: (w, h) => set({ stageW: w, stageH: h }),
        setPan: (panX, panY) => set({ panX, panY }),

        /**
         * Zoom around a fixed screen point: keep the world point under the
         * cursor in place by re-deriving pan from `screen = world * zoom + pan`.
         */
        zoomAt: (factor, screenX, screenY) =>
          set((s) => {
            const zoom = clampZoom(s.zoom * factor);
            const wx = (screenX - s.panX) / s.zoom;
            const wy = (screenY - s.panY) / s.zoom;
            return { zoom, panX: screenX - wx * zoom, panY: screenY - wy * zoom };
          }),

        zoomBy: (factor) => {
          const { stageW, stageH, zoomAt } = get();
          zoomAt(factor, stageW / 2, stageH / 2);
        },

        fitToContent: () =>
          set((s) => {
            const byId = new Map(s.materials.map((m) => [m.id, m]));
            const b = contentBounds(s.pieces, byId);
            if (!b) return { ...DEFAULT_VIEW };
            const pad = 60;
            const zoom = Math.min(
              MAX_ZOOM,
              Math.max(
                MIN_ZOOM,
                Math.min((s.stageW - 2 * pad) / b.w, (s.stageH - 2 * pad) / b.h),
              ),
            );
            return {
              zoom,
              panX: pad - b.x * zoom + (s.stageW - 2 * pad - b.w * zoom) / 2,
              panY: pad - b.y * zoom + (s.stageH - 2 * pad - b.h * zoom) / 2,
            };
          }),

        resetView: () => set({ ...DEFAULT_VIEW }),

        // ── selection ─────────────────────────────────────────────────────
        select: (id) => set({ selectedIds: id ? [id] : [] }),
        toggleSelect: (id) =>
          set((s) => ({
            selectedIds: s.selectedIds.includes(id)
              ? s.selectedIds.filter((x) => x !== id)
              : [...s.selectedIds, id],
          })),
        setSelection: (ids) => set({ selectedIds: ids }),
        selectAll: () => set((s) => ({ selectedIds: s.pieces.map((p) => p.id) })),

        // ── pieces ────────────────────────────────────────────────────────
        /**
         * Places a piece at exactly the given world position. Snapping is the
         * caller's job (see `dropPosition` in StageCanvas) so that the drop
         * preview and the placed piece can never disagree.
         */
        addPiece: (materialId, worldX, worldY) =>
          commit((s) => {
            if (!s.materials.some((m) => m.id === materialId)) return {};
            const piece: Piece = { id: uid(), materialId, x: worldX, y: worldY, rot: 0 };
            return { pieces: [...s.pieces, piece], selectedIds: [piece.id] };
          }),

        setDraggingMaterial: (materialId) => set({ draggingMaterialId: materialId }),

        /** Opens an undo step before a drag; the drag itself does not commit. */
        beginDrag: () =>
          set((s) => ({
            past: [...s.past, snap(s)].slice(-HISTORY_LIMIT),
            future: [],
          })),

        /**
         * Live drag. `baseline` is the piece list as it was when the drag
         * started, so the delta always applies to the original positions and
         * repeated snapping cannot creep.
         */
        moveSelectionBy: (dxCm, dyCm, baseline) =>
          apply((s) => {
            const selected = new Set(s.selectedIds);
            const origin = new Map(baseline.map((p) => [p.id, p]));
            const byId = new Map(s.materials.map((m) => [m.id, m]));

            // 1. grid snap, applied to the drag delta so repeated snapping
            //    cannot creep away from the original positions
            const gridDx = snapValue(dxCm, s.snapStep, s.snap);
            const gridDy = snapValue(dyCm, s.snapStep, s.snap);

            // 2. edge snap: nudge the whole selection so its bounding box lines
            //    up with a nearby piece. Panel widths are not grid multiples,
            //    so this is what actually makes panels butt together.
            let extraDx = 0;
            let extraDy = 0;
            let guideX: number | null = null;
            let guideY: number | null = null;

            if (s.edgeSnap) {
              const movingRects = baseline
                .filter((p) => selected.has(p.id))
                .map((p) => {
                  const m = byId.get(p.materialId);
                  return m ? pieceBounds({ ...p, x: p.x + gridDx, y: p.y + gridDy }, m) : null;
                })
                .filter((r): r is NonNullable<typeof r> => r !== null);

              const movingBox = unionRect(movingRects);
              if (movingBox) {
                const targets = s.pieces
                  .filter((p) => !selected.has(p.id))
                  .map((p) => {
                    const m = byId.get(p.materialId);
                    return m ? pieceBounds(p, m) : null;
                  })
                  .filter((r): r is NonNullable<typeof r> => r !== null);

                // tolerance in cm, ~8 screen px so it feels the same at any zoom
                const snapResult = computeEdgeSnap(movingBox, targets, 8 / s.zoom);
                extraDx = snapResult.dx;
                extraDy = snapResult.dy;
                guideX = snapResult.guideX;
                guideY = snapResult.guideY;
              }
            }

            return {
              guideX,
              guideY,
              pieces: s.pieces.map((p) => {
                if (!selected.has(p.id)) return p;
                const base = origin.get(p.id) ?? p;
                return {
                  ...p,
                  x: base.x + gridDx + extraDx,
                  y: base.y + gridDy + extraDy,
                };
              }),
            };
          }),

        endDrag: () => set({ guideX: null, guideY: null }),

        nudgeSelection: (dxCm, dyCm) =>
          commit((s) => {
            const selected = new Set(s.selectedIds);
            if (!selected.size) return {};
            return {
              pieces: s.pieces.map((p) =>
                selected.has(p.id) ? { ...p, x: p.x + dxCm, y: p.y + dyCm } : p,
              ),
            };
          }),

        /** Turn the selection by `step` degrees (default a quarter turn). */
        rotateSelected: (step = 90) =>
          commit((s) => {
            const selected = new Set(s.selectedIds);
            if (!selected.size) return {};
            // Each piece turns about its own centre — what a drafter expects
            // when nudging several panels at once.
            return {
              pieces: s.pieces.map((p) =>
                selected.has(p.id) ? { ...p, rot: normalizeRot(p.rot + step) } : p,
              ),
            };
          }),

        /** Set an exact angle on the selection, e.g. from the rotation field. */
        setRotation: (deg) =>
          commit((s) => {
            const selected = new Set(s.selectedIds);
            if (!selected.size) return {};
            const rot = normalizeRot(deg);
            return {
              pieces: s.pieces.map((p) => (selected.has(p.id) ? { ...p, rot } : p)),
            };
          }),

        deleteSelected: () =>
          commit((s) => {
            const selected = new Set(s.selectedIds);
            if (!selected.size) return {};
            return { pieces: s.pieces.filter((p) => !selected.has(p.id)), selectedIds: [] };
          }),

        duplicateSelected: () =>
          commit((s) => {
            const selected = s.pieces.filter((p) => s.selectedIds.includes(p.id));
            if (!selected.length) return {};
            const offset = s.snap ? s.snapStep * 2 : 10;
            const copies = selected.map((p) => ({
              ...p,
              id: uid(),
              x: p.x + offset,
              y: p.y + offset,
            }));
            return {
              pieces: [...s.pieces, ...copies],
              selectedIds: copies.map((p) => p.id),
            };
          }),

        copySelection: () =>
          set((s) => ({
            clipboard: s.pieces.filter((p) => s.selectedIds.includes(p.id)),
          })),

        pasteClipboard: () =>
          commit((s) => {
            if (!s.clipboard.length) return {};
            const offset = s.snap ? s.snapStep * 2 : 10;
            const copies = s.clipboard.map((p) => ({
              ...p,
              id: uid(),
              x: p.x + offset,
              y: p.y + offset,
            }));
            return {
              pieces: [...s.pieces, ...copies],
              selectedIds: copies.map((p) => p.id),
              // paste again → keeps stepping away from the original
              clipboard: copies,
            };
          }),

        /** Repeat the selection N times along one axis at a fixed pitch. */
        arraySelection: ({ count, pitch, axis }) =>
          commit((s) => {
            const selected = s.pieces.filter((p) => s.selectedIds.includes(p.id));
            if (!selected.length || count < 1) return {};
            const copies: Piece[] = [];
            for (let i = 1; i <= count; i++) {
              for (const p of selected) {
                copies.push({
                  ...p,
                  id: uid(),
                  x: axis === 'x' ? p.x + pitch * i : p.x,
                  y: axis === 'y' ? p.y + pitch * i : p.y,
                });
              }
            }
            return {
              pieces: [...s.pieces, ...copies],
              selectedIds: copies.map((p) => p.id),
            };
          }),

        /** Build a whole column assembly from its cross-section and height. */
        generateColumn: (spec) => {
          const plan = planColumn(spec, get().materials);
          if (plan.pieces.length) {
            commit((s) => ({
              pieces: [...s.pieces, ...plan.pieces],
              selectedIds: plan.pieces.map((p) => p.id),
            }));
          }
          return { added: plan.pieces.length, warnings: plan.warnings };
        },

        generateWall: (spec) => {
          const plan = planWall(spec, get().materials);
          if (plan.pieces.length) {
            commit((s) => ({
              pieces: [...s.pieces, ...plan.pieces],
              selectedIds: plan.pieces.map((p) => p.id),
            }));
          }
          return { added: plan.pieces.length, warnings: plan.warnings };
        },

        insertPieces: (incoming) => {
          if (!incoming.length) return;
          commit((s) => ({
            pieces: [...s.pieces, ...incoming],
            selectedIds: incoming.map((p) => p.id),
          }));
        },

        clearPieces: () => commit(() => ({ pieces: [], selectedIds: [] })),
        replaceLayout: (pieces) => commit(() => ({ pieces, selectedIds: [] })),

        // ── history ───────────────────────────────────────────────────────
        undo: () =>
          set((s) => {
            const previous = s.past[s.past.length - 1];
            if (!previous) return {};
            return {
              ...previous,
              documents: s.documents.map((d) =>
                d.id === s.activeDocId ? { ...d, pieces: previous.pieces } : d,
              ),
              past: s.past.slice(0, -1),
              future: [snap(s), ...s.future].slice(0, HISTORY_LIMIT),
              selectedIds: [],
            };
          }),

        redo: () =>
          set((s) => {
            const next = s.future[0];
            if (!next) return {};
            return {
              ...next,
              documents: s.documents.map((d) =>
                d.id === s.activeDocId ? { ...d, pieces: next.pieces } : d,
              ),
              past: [...s.past, snap(s)].slice(-HISTORY_LIMIT),
              future: s.future.slice(1),
              selectedIds: [],
            };
          }),

        // ── documents ─────────────────────────────────────────────────────
        newDocument: (name) =>
          set((s) => {
            const doc = newDoc(name?.trim() || `ნახაზი ${s.documents.length + 1}`);
            return {
              documents: [...s.documents, doc],
              activeDocId: doc.id,
              pieces: [],
              selectedIds: [],
              past: [],
              future: [],
            };
          }),

        switchDocument: (id) =>
          set((s) => {
            const target = s.documents.find((d) => d.id === id);
            if (!target || id === s.activeDocId) return {};
            return {
              activeDocId: id,
              pieces: target.pieces,
              selectedIds: [],
              past: [],
              future: [],
            };
          }),

        renameDocument: (id, name) =>
          set((s) => ({
            documents: s.documents.map((d) =>
              d.id === id ? { ...d, name: name.trim() || d.name } : d,
            ),
          })),

        duplicateDocument: (id) =>
          set((s) => {
            const source = s.documents.find((d) => d.id === id);
            if (!source) return {};
            const copy = newDoc(
              `${source.name} (ასლი)`,
              source.pieces.map((p) => ({ ...p, id: uid() })),
            );
            return {
              documents: [...s.documents, copy],
              activeDocId: copy.id,
              pieces: copy.pieces,
              selectedIds: [],
              past: [],
              future: [],
            };
          }),

        deleteDocument: (id) =>
          set((s) => {
            if (s.documents.length <= 1) return {}; // always keep one drawing
            const remaining = s.documents.filter((d) => d.id !== id);
            if (remaining.length === s.documents.length) return {}; // unknown id
            const active =
              remaining.find((d) => d.id === s.activeDocId) ?? remaining[0];
            return {
              documents: remaining,
              activeDocId: active.id,
              pieces: active.pieces,
              selectedIds: [],
              past: [],
              future: [],
            };
          }),

        setTitleBlock: (patch) =>
          set((s) => ({
            documents: s.documents.map((d) =>
              d.id === s.activeDocId ? { ...d, ...patch } : d,
            ),
          })),

        // ── warehouses ────────────────────────────────────────────────────
        addWarehouse: (name) =>
          set((s) => {
            const trimmed = name.trim();
            if (!trimmed) return {};
            return { warehouses: [...s.warehouses, { id: uid('wh'), name: trimmed }] };
          }),

        renameWarehouse: (id, name) =>
          set((s) => ({
            warehouses: s.warehouses.map((w) =>
              w.id === id ? { ...w, name: name.trim() || w.name } : w,
            ),
          })),

        /**
         * Removing a store folds its quantities into the first remaining one,
         * so deleting a warehouse never silently destroys counted stock.
         */
        deleteWarehouse: (id) =>
          set((s) => {
            if (s.warehouses.length <= 1) return {};
            const remaining = s.warehouses.filter((w) => w.id !== id);
            if (remaining.length === s.warehouses.length) return {};
            const target = remaining[0].id;
            return {
              warehouses: remaining,
              materials: s.materials.map((m) => {
                const moved = m.stock[id] || 0;
                if (!moved) {
                  const { [id]: _drop, ...rest } = m.stock;
                  return { ...m, stock: rest };
                }
                const { [id]: _drop, ...rest } = m.stock;
                return { ...m, stock: { ...rest, [target]: (rest[target] || 0) + moved } };
              }),
            };
          }),

        // ── settings ──────────────────────────────────────────────────────
        setSnap: (on) => set({ snap: on }),
        setSnapStep: (step) => set({ snapStep: step }),
        setEdgeSnap: (on) => set({ edgeSnap: on }),
        setShowDims: (on) => set({ showDims: on }),
        setShowNames: (on) => set({ showNames: on }),
        setForceLabels: (on) => set({ forceLabels: on }),
        setShowOverlaps: (on) => set({ showOverlaps: on }),
        setViewMode: (mode) => set({ viewMode: mode }),
        setHiddenLines: (mode) => set({ hiddenLines: mode }),
        setPaletteOpen: (on) => set({ paletteOpen: on }),
        setInspectorOpen: (on) => set({ inspectorOpen: on }),
        setPaletteQuery: (q) => set({ paletteQuery: q }),

        // ── catalog ───────────────────────────────────────────────────────
        addMaterial: (draft) => {
          const taken = new Set(get().materials.map((m) => m.id));
          const material: Material = {
            ...draft,
            id: makeMaterialId(draft, taken),
            builtin: false,
            stock: normalizeStock(draft.stock),
          };
          commit((s) => ({ materials: [...s.materials, material] }));
          return material;
        },

        /** Editing a material updates every placed piece of that type live. */
        updateMaterial: (id, draft) =>
          commit((s) => ({
            materials: s.materials.map((m) =>
              m.id === id ? { ...m, ...draft, stock: normalizeStock(draft.stock) } : m,
            ),
          })),

        deleteMaterial: (id, cascade) =>
          commit((s) => {
            const target = s.materials.find((m) => m.id === id);
            if (!target) return {};
            const used = s.pieces.some((p) => p.materialId === id);
            if (used && !cascade) return {};
            return {
              materials: s.materials.filter((m) => m.id !== id),
              pieces: cascade ? s.pieces.filter((p) => p.materialId !== id) : s.pieces,
              removedBuiltins: target.builtin ? [...s.removedBuiltins, id] : s.removedBuiltins,
              selectedIds: [],
            };
          }),

        // Stock edits are frequent and low-risk; they do not create undo steps.
        setStock: (id, warehouseId, quantity) =>
          set((s) => ({
            materials: s.materials.map((m) =>
              m.id === id ? { ...m, stock: withStockIn(m.stock, warehouseId, quantity) } : m,
            ),
          })),

        importMaterials: (drafts) => {
          if (!drafts.length) return 0;
          const taken = new Set(get().materials.map((m) => m.id));
          const added: Material[] = drafts.map((draft) => {
            const id = makeMaterialId(draft, taken);
            taken.add(id);
            return { ...draft, id, builtin: false, stock: normalizeStock(draft.stock) };
          });
          commit((s) => ({ materials: [...s.materials, ...added] }));
          return added.length;
        },

        /** Swaps in a catalog from file; returns how many orphaned pieces were dropped. */
        replaceCatalog: (materials, warehouses) => {
          const ids = new Set(materials.map((m) => m.id));
          const before = get().pieces;
          const kept = before.filter((p) => ids.has(p.materialId));
          commit(() => ({
            materials,
            ...(warehouses?.length ? { warehouses } : {}),
            pieces: kept,
            removedBuiltins: [],
            selectedIds: [],
            dialog: null,
          }));
          return before.length - kept.length;
        },

        resetCatalog: () =>
          commit(() => ({
            materials: createSeedMaterials(),
            removedBuiltins: [],
            dialog: null,
          })),

        // ── dialogs ───────────────────────────────────────────────────────
        openDialog: (dialog) => set({ dialog }),
        closeDialog: () => set({ dialog: null }),
        setToast: (message) => set({ toast: message }),
      };
    },
    {
      // With a backend, only preferences are kept locally, and under their own
      // key — see PREFS_KEY for why sharing the old one would destroy data.
      name: isConfigured ? PREFS_KEY : STORAGE_KEY,
      version: 3,
      storage: safeStorage,
      // v2 stored a single top-level `pieces` array instead of named drawings.
      // `merge` normalises either shape, so migration just passes state through.
      migrate: (persisted) => persisted as Partial<EditorState>,
      /**
       * The persist middleware swallows anything `merge` throws: the store is
       * left on its empty defaults and the next autosave writes those over the
       * user's saved work. That is the worst possible failure mode and it is
       * completely silent, so it gets reported here instead — loudly, and
       * before the banner tells the user to export what is left.
       */
      onRehydrateStorage: () => (_state, error) => {
        if (!error) return;
        console.error('შენახული მონაცემების წაკითხვა ვერ მოხერხდა', error);
        onStorageFailure(
          'შენახული ნახაზი ვერ ჩაიტვირთა და შესაძლოა დაიკარგოს. გააკეთე ექსპორტი და გადატვირთე გვერდი.',
        );
      },
      /**
       * With a backend, company data belongs to the server and only the
       * per-device preferences are written locally. Without one, everything is
       * saved exactly as before so the offline path is unchanged.
       */
      partialize: (s) => {
        const prefs = Object.fromEntries(
          PREF_KEYS.map((key) => [key, s[key]]),
        ) as Partial<EditorState>;
        if (isConfigured) return prefs;
        return {
          ...prefs,
          materials: s.materials,
          removedBuiltins: s.removedBuiltins,
          documents: s.documents,
          activeDocId: s.activeDocId,
          warehouses: s.warehouses,
        };
      },
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<EditorState> & { pieces?: Piece[] };

        // Preferences only; the catalog and drawings arrive from the server.
        if (isConfigured) return { ...current, ...saved, dataLoaded: false };

        const { documents, activeDocId, pieces } = restoreDocuments(saved);
        const materials = mergeCatalog(saved.materials, saved.removedBuiltins);
        return {
          ...current,
          ...saved,
          materials,
          warehouses: restoreWarehouses(saved.warehouses, materials),
          documents,
          activeDocId,
          pieces,
          selectedIds: [],
          clipboard: [],
          past: [],
          future: [],
          dialog: null,
          toast: null,
          storageError: null,
          guideX: null,
          guideY: null,
          paletteQuery: '',
        };
      },
    },
  ),
);

// Route storage failures into the store so the header can show a warning.
onStorageFailure = (message) => {
  const { storageError } = useEditorStore.getState();
  if (storageError !== message) useEditorStore.setState({ storageError: message });
};

/**
 * Restores the drawing list. Handles state saved before named drawings existed,
 * where a single `pieces` array lived at the top level.
 */
export function restoreDocuments(saved: Partial<EditorState> & { pieces?: Piece[] }): {
  documents: DrawingDoc[];
  activeDocId: string;
  pieces: Piece[];
} {
  const stored = Array.isArray(saved.documents) ? saved.documents : [];
  const documents = stored
    .filter((d): d is DrawingDoc => !!d && typeof d.id === 'string')
    .map((d) => ({
      id: d.id,
      name: typeof d.name === 'string' && d.name ? d.name : 'ნახაზი',
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : Date.now(),
      pieces: Array.isArray(d.pieces) ? d.pieces : [],
      // title-block fields arrived after named drawings did
      projectName: typeof d.projectName === 'string' ? d.projectName : '',
      revision: typeof d.revision === 'string' && d.revision ? d.revision : 'A',
      // 0 means "auto scale"; anything invalid falls back to 1:50
      scale: typeof d.scale === 'number' && d.scale >= 0 ? d.scale : 50,
    }));

  if (!documents.length) {
    const doc = newDoc('ნახაზი 1', Array.isArray(saved.pieces) ? saved.pieces : []);
    return { documents: [doc], activeDocId: doc.id, pieces: doc.pieces };
  }

  const active = documents.find((d) => d.id === saved.activeDocId) ?? documents[0];
  return { documents, activeDocId: active.id, pieces: active.pieces };
}

/**
 * Restores the warehouse list, inventing entries for any store id that stock
 * still references — otherwise counted quantities would become unreachable.
 */
export function restoreWarehouses(stored: Warehouse[] | undefined, materials: Material[]): Warehouse[] {
  const warehouses: Warehouse[] = Array.isArray(stored)
    ? stored
        .filter((w): w is Warehouse => !!w && typeof w.id === 'string')
        .map((w) => ({ id: w.id, name: String(w.name ?? w.id) }))
    : [];

  const known = new Set(warehouses.map((w) => w.id));
  for (const m of materials) {
    for (const key of Object.keys(m.stock)) {
      if (!known.has(key)) {
        known.add(key);
        warehouses.push({
          id: key,
          name: key === DEFAULT_WAREHOUSE.id ? DEFAULT_WAREHOUSE.name : key,
        });
      }
    }
  }

  return warehouses.length ? warehouses : [{ ...DEFAULT_WAREHOUSE }];
}

/**
 * Rebuilds the catalog from localStorage:
 *  - repairs/validates every stored material,
 *  - keeps user edits to built-ins (names, sizes, colours, stock),
 *  - re-adds built-ins that a newer app version introduced,
 *  - respects built-ins the user deleted on purpose.
 */
export function mergeCatalog(
  stored: Material[] | undefined,
  removedBuiltins: string[] | undefined,
): Material[] {
  if (!Array.isArray(stored) || stored.length === 0) return createSeedMaterials();

  const taken = new Set<string>();
  const materials: Material[] = [];
  for (const raw of stored) {
    const m = sanitizeMaterial(raw, taken);
    if (!m) continue;
    taken.add(m.id);
    materials.push(m);
  }
  applySizeFixes(materials);

  const removed = new Set(removedBuiltins ?? []);
  for (const seed of createSeedMaterials()) {
    if (!taken.has(seed.id) && !removed.has(seed.id)) materials.push(seed);
  }

  return materials.length ? materials : createSeedMaterials();
}
