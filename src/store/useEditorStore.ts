import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  ArrayOptions,
  ColumnSpec,
  WallRunSpec,
  DialogState,
  DocSnapshot,
  DrawingDoc,
  HiddenLineMode,
  InspectorTab,
  Material,
  MaterialDraft,
  Piece,
  SketchPath,
  Warehouse,
} from '../types';
import { SEED_MATERIALS, createSeedMaterials, defaultDepth } from '../data/seedCatalog';
import { sanitizeMaterial } from '../lib/catalogFile';
import {
  clampZoom,
  computeEdgeSnap,
  MAX_ZOOM,
  MIN_ZOOM,
  normalizeRot,
  snapValue,
  unionRect,
} from '../lib/geometry';
import { makeMaterialId, uid } from '../lib/ids';
import { DEFAULT_WAREHOUSE, normalizeStock, withStockIn } from '../lib/inventory';
import { planColumn } from '../lib/columnWizard';
import {
  insertVertex,
  moveSegment,
  moveVertex,
  segments,
  removeVertex,
  setLegAngle,
  setLegLength as setLegLengthOn,
  sketchSnapTargets,
  translatePath,
  type Point,
  type SegmentHit,
} from '../lib/sketch';
import {
  legDir,
  planSketchFill,
  planSketchFillAll,
  type SketchFillSpec,
} from '../lib/sketchFill';
import { faceBands } from '../lib/gap';
import {
  isElevation,
  projectPiece,
  projectedContentBounds,
  unprojectDelta,
  type ViewAxis,
} from '../lib/projection';
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

/**
 * How far the pointer has to travel before it counts as having gone somewhere.
 *
 * The same figure the stage uses to tell a click from a drag, and it means the
 * same thing here — see `penAddPoint`.
 */
const DRAG_THRESHOLD_PX = 3;

/**
 * How close an edge has to come before the drag latches onto it, in screen px.
 *
 * Generous on purpose. This is the only thing that puts a piece exactly against
 * another one, and being a few pixels out is not a decision anybody made — it
 * is a hand on a mouse. Too wide and a piece refuses to sit near a neighbour
 * without touching it; twelve pixels leaves plenty of room to mean it.
 */
const EDGE_SNAP_PX = 12;

/** Settings that belong to one person on one machine, not to the company. */
const PREF_KEYS = [
  'zoom',
  'panX',
  'panY',
  'snap',
  'snapStep',
  'orthoLock',
  'edgeSnap',
  'showDims',
  'showNames',
  'forceLabels',
  'showOverlaps',
  'showGaps',
  'showSketch',
  'viewMode',
  'surfaceView',
  'hiddenLines',
  'paletteOpen',
  'inspectorOpen',
  'inspectorTab',
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
  /** the drawn layout the formwork is being set out to (also mirrored) */
  sketch: SketchPath[];
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
  /**
   * Hold the pen to right angles.
   *
   * On by default, because formwork is built square and a layout that is not
   * describes something the catalog cannot close. Off for the wall that does
   * not obey — a splayed bay, a site boundary — which the tool should be able
   * to draw even though it cannot fill it.
   */
  orthoLock: boolean;
  showDims: boolean;
  showNames: boolean;
  forceLabels: boolean;
  /** highlight pieces whose footprints intersect */
  showOverlaps: boolean;
  /** 2D plan editor, or the read-only 3D visualisation */
  viewMode: '2d' | '3d';
  /** Which orthographic view the 2D surface is showing. */
  surfaceView: ViewAxis;
  /** what the 3D view does with edges that sit behind other pieces */
  hiddenLines: HiddenLineMode;
  /** side panels can be folded away to give the canvas room on small screens */
  paletteOpen: boolean;
  inspectorOpen: boolean;
  /** which inspector tab is showing — in the store so the shortage bar can
      open the drawing's bill of materials on the row that is short */
  inspectorTab: InspectorTab;
  /** mark every open gap, not only the one beside the selection */
  showGaps: boolean;
  /**
   * Show the drawn layout.
   *
   * Off hides it completely: not drawn, not snapped to, not clickable. A line
   * you cannot see must not grab the pointer or pull a panel towards itself —
   * that is a layout haunting the drawing rather than guiding it.
   */
  showSketch: boolean;

  // ── transient UI ──
  selectedIds: string[];
  /** selected reference lines — kept apart from `selectedIds`, which is pieces */
  selectedSketchIds: string[];
  /**
   * The one part of a run being worked on: a leg, or a junction.
   *
   * Separate from `selectedSketchIds`, which is whole runs. Both are real
   * selections and they answer different questions — "which walls am I moving"
   * against "which wall am I dimensioning" — so collapsing them into one would
   * mean picking a leg could not also mean picking up the run it belongs to.
   */
  selectedSketchPart: { pathId: string; kind: 'leg' | 'vertex'; index: number } | null;
  /**
   * What a press on the surface does. The pen draws the layout; select does
   * everything else. Deliberately not persisted: reopening the app in a mode
   * that swallows clicks would be baffling.
   */
  tool: 'select' | 'pen';
  /** vertices of the path being drawn, before it is committed */
  penPoints: Array<{ x: number; y: number }>;
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
  addPiece: (materialId: string, worldX: number, worldY: number, worldZ?: number) => void;
  setDraggingMaterial: (materialId: string | null) => void;
  beginDrag: () => void;
  /**
   * Live drag on the 2D surface, in surface centimetres. Which world axes
   * those are is `surfaceView`'s business, not the caller's.
   */
  /**
   * Move the selection, whatever is in it.
   *
   * Pieces and drawn runs travel on ONE delta, computed once and applied to
   * both. Moving them separately — even by the same drag — is how they drift
   * apart: the pieces snap to a neighbour's edge and the layout rounds to the
   * grid, and the wall ends up a centimetre off the line it was set out to.
   */
  moveSelectionBy: (
    duCm: number,
    dvCm: number,
    baseline: Piece[],
    sketchBaseline?: SketchPath[],
    /**
     * Put the piece exactly where the pointer is, snapping to nothing.
     *
     * The way out of a snap that is being helpful at the wrong moment. Making
     * an edge win its axis is right nearly always and wrong when the whole job
     * is to sit one centimetre off one — turning a 4 cm leftover the catalog
     * cannot close into a 5 cm one it can.
     */
    freehand?: boolean,
  ) => void;
  /** Arrow-key nudge, also in surface centimetres. */
  nudgeSelection: (duCm: number, dvCm: number) => void;
  /** Live drag from the 3D view, which can also move a piece up and down. */
  moveSelectionSpatially: (
    dxCm: number,
    dyCm: number,
    dzCm: number,
    baseline: Piece[],
  ) => void;
  endDrag: () => void;
  /** Put the selection at an exact elevation, from the inspector field. */
  setElevation: (zCm: number) => void;
  /**
   * Put the one selected piece at an exact spot.
   *
   * Rotation and elevation could both be typed and position could not, which
   * left the most ordinary precise instruction there is — "a centimetre that
   * way, so the leftover beside it becomes a size the catalog stocks" — with no
   * way to say it. Dragging cannot: a snap that is right nearly always is
   * wrong exactly when the point is to sit just off something.
   */
  setPosition: (x: number, y: number) => void;
  /** Raise or lower the selection, from a keyboard nudge. */
  nudgeElevation: (dzCm: number) => void;
  rotateSelected: (step?: number) => void;
  setRotation: (deg: number) => void;
  deleteSelected: () => void;
  duplicateSelected: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  arraySelection: (options: ArrayOptions) => void;
  generateColumn: (spec: ColumnSpec) => { added: number; warnings: string[] };
  /**
   * A straight wall, drawn and filled in one step.
   *
   * The line goes onto the layout as well as the panels, so a wall typed in as
   * a length still leaves the setting-out behind it — and it is built by the
   * same generator as everything else, rather than by a second one that would
   * quietly disagree with it.
   */
  generateWallRun: (spec: WallRunSpec) => { added: number; warnings: string[] };
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
  setOrthoLock: (on: boolean) => void;
  setShowDims: (on: boolean) => void;
  setShowNames: (on: boolean) => void;
  setForceLabels: (on: boolean) => void;
  setShowOverlaps: (on: boolean) => void;
  setShowGaps: (on: boolean) => void;
  setShowSketch: (on: boolean) => void;
  setViewMode: (mode: '2d' | '3d') => void;
  /** Switch the surface between plan, front and side, reframing as it goes. */
  setSurfaceView: (view: ViewAxis) => void;
  setHiddenLines: (mode: HiddenLineMode) => void;
  setPaletteOpen: (on: boolean) => void;
  setInspectorOpen: (on: boolean) => void;
  setInspectorTab: (tab: InspectorTab) => void;
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

  // ── actions: the drawn layout ──
  setTool: (tool: 'select' | 'pen') => void;
  /** Add a vertex to the path in progress, already snapped by the caller. */
  penAddPoint: (x: number, y: number) => void;
  /** Drop the last vertex — the pen's own undo, mid-path. */
  penUndoPoint: () => void;
  /** Commit the path in progress. `closed` joins the last point to the first. */
  penFinish: (closed?: boolean) => void;
  /** Abandon the path in progress, keeping the tool active. */
  penCancel: () => void;
  selectSketch: (id: string | null, additive?: boolean) => void;
  /**
   * Live drag of one leg, or of one end of an open run.
   *
   * Takes the path as it was when the drag started rather than an incremental
   * delta, so a drag that wanders and comes back lands exactly where it began
   * instead of accumulating rounding — the same reason piece dragging works
   * from a baseline.
   */
  dragSketch: (
    hit: SegmentHit,
    dx: number,
    dy: number,
    baseline: SketchPath,
    /** slide the whole run instead of the one part that was grabbed */
    whole?: boolean,
  ) => void;
  /** Slide every selected run at once, from the shapes they had when the drag began. */
  dragSketchAll: (dx: number, dy: number, baselines: SketchPath[]) => void;
  /** Replace the sketch selection outright — used by the rubber band. */
  selectSketchMany: (ids: string[], additive?: boolean) => void;
  /** Pick out one leg or one junction of a run. */
  selectSketchPart: (part: EditorState['selectedSketchPart']) => void;
  /** Put a new junction on an existing leg, at a point already on it. */
  insertSketchVertex: (pathId: string, index: number, at: Point) => void;
  /** Swing one leg of an open run to an exact bearing, in degrees. */
  setLegAngle: (pathId: string, index: number, deg: number) => void;
  /** Take out the selected junction, joining the two legs it divided. */
  removeSketchVertex: (pathId: string, index: number) => void;
  /** Join a run's last point back to its first, making it a closed outline. */
  closeSketchPath: (pathId: string, closed: boolean) => void;
  /**
   * Set one leg to an exact length, in cm.
   *
   * A wall is specified as 4.27 m, not as a number of grid squares, and no
   * amount of careful dragging gets you there. The rest of the run travels with
   * the leg so the corners it already has survive; a closed room has no free
   * end for the slack to go to, so it is left alone.
   */
  setLegLength: (pathId: string, index: number, cm: number) => void;
  /**
   * Build the formwork for one drawn run, or for every run selected.
   *
   * Takes a list because a layout is rarely one unbroken line — a building is a
   * few runs that happen to meet — and filling them one at a time meant
   * retyping the same thickness and height for each, then adding the summaries
   * up by hand to know what to order.
   */
  fillSketch: (pathIds: string[], spec: SketchFillSpec) => { added: number; warnings: string[] };
}

const DEFAULT_VIEW = { zoom: 1, panX: 40, panY: 40 };

function newDoc(name: string, pieces: Piece[] = []): DrawingDoc {
  return {
    id: uid('doc'),
    name,
    updatedAt: Date.now(),
    pieces,
    sketch: [],
    projectName: '',
    revision: 'A',
    scale: 50,
  };
}

/** The slice of state that undo/redo restores. */
function snap(s: EditorState): DocSnapshot {
  return {
    materials: s.materials,
    pieces: s.pieces,
    sketch: s.sketch,
    removedBuiltins: s.removedBuiltins,
  };
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
          ? 'ავტოშენახვა ვერ მოხერხდა - ბრაუზერის მეხსიერება გადაივსო. გააკეთე ექსპორტი და წაშალე ძველი ნახაზები.'
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
      /** Mirror the working pieces and sketch back into the active document. */
      const syncDoc = (s: EditorState, patch: Partial<EditorState>): Partial<EditorState> => {
        if (!patch.pieces && !patch.sketch) return patch;
        const pieces = patch.pieces ?? s.pieces;
        const sketch = patch.sketch ?? s.sketch;
        return {
          ...patch,
          documents: s.documents.map((d) =>
            d.id === s.activeDocId ? { ...d, pieces, sketch, updatedAt: Date.now() } : d,
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
        sketch: [],
        selectedSketchIds: [],
        selectedSketchPart: null,
        tool: 'select',
        penPoints: [],
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
        orthoLock: true,
        showDims: true,
        showNames: true,
        forceLabels: false,
        showOverlaps: true,
        viewMode: '2d',
        surfaceView: 'plan',
        hiddenLines: 'hide',
        // Start folded on a phone-ish window so the canvas is usable at all.
        paletteOpen: typeof window === 'undefined' || window.innerWidth > 900,
        inspectorOpen: typeof window === 'undefined' || window.innerWidth > 1100,
        inspectorTab: 'bom',
        showGaps: false,
        showSketch: true,

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
              sketch: active.sketch,
              removedBuiltins: [],
              dataLoaded: true,
              selectedIds: [],
              selectedSketchIds: [],
              selectedSketchPart: null,
              penPoints: [],
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
            // In an elevation the model sits above the ground line, at negative
            // surface y — the plan's bounds would frame empty floor.
            const b = projectedContentBounds(s.pieces, byId, s.surfaceView);
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
        // Everything means everything: the layout is part of the drawing, and
        // "select all, move it over" is the commonest reason to want either.
        selectAll: () =>
          set((s) => ({
            selectedIds: s.pieces.map((p) => p.id),
            selectedSketchIds: s.sketch.map((k) => k.id),
            selectedSketchPart: null,
          })),

        // ── pieces ────────────────────────────────────────────────────────
        /**
         * Places a piece at exactly the given world position. Snapping is the
         * caller's job (see `dropPosition` in StageCanvas) so that the drop
         * preview and the placed piece can never disagree.
         */
        addPiece: (materialId, worldX, worldY, worldZ = 0) =>
          commit((s) => {
            if (!s.materials.some((m) => m.id === materialId)) return {};
            const piece: Piece = {
              id: uid(),
              materialId,
              x: worldX,
              y: worldY,
              rot: 0,
              z: Math.max(0, worldZ),
            };
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
         * Live drag on the surface, whichever view it is showing.
         *
         * `baseline` is the piece list as it was when the drag started, so the
         * delta always applies to the original positions and repeated snapping
         * cannot creep.
         *
         * The snapping runs entirely in surface coordinates and only becomes
         * world movement at the very end. That is what lets one path serve all
         * three views — and it means edge snapping, which is what actually
         * makes panels butt together, works in an elevation too: courses land
         * on each other instead of near each other.
         */
        moveSelectionBy: (duCm, dvCm, baseline, sketchBaseline, freehand) =>
          apply((s) => {
            const selected = new Set(s.selectedIds);
            const origin = new Map(baseline.map((p) => [p.id, p]));
            const byId = new Map(s.materials.map((m) => [m.id, m]));
            const view = s.surfaceView;

            // 1. grid snap, applied to the drag delta so repeated snapping
            //    cannot creep away from the original positions. Only used where
            //    nothing better is in reach — see below.
            const gridDu = snapValue(duCm, s.snapStep, s.snap && !freehand);
            const gridDv = snapValue(dvCm, s.snapStep, s.snap && !freehand);

            /**
             * 2. edge snap: line the selection up with a piece already placed.
             *
             * Measured from where the pointer actually is, not from where the
             * grid has just put it, and it WINS the axis it catches on.
             *
             * It used to be a nudge applied on top of grid snapping, and that
             * worked by luck: panels are 30 to 90 in fifteens, so the grid left
             * them within a few millimetres of flush and the nudge finished the
             * job. Nothing else in the system is on the grid. A corner profile
             * has a 24 cm leg standing off a 9 cm panel, and the faces it has to
             * meet sit 10 and 19 either side of a centreline — so the grid drags
             * it up to half a step away from where it belongs and the nudge
             * cannot reach back. Corners could be aligned only by eye, one pixel
             * at a time, which is what a snap is supposed to spare you.
             *
             * Object beats grid is what every drawing tool does, and it is the
             * right way round: the grid is a convenience, another piece's edge
             * is the answer.
             */
            let guideX: number | null = null;
            let guideY: number | null = null;
            let snapDu: number | null = null;
            let snapDv: number | null = null;

            if (s.edgeSnap && !freehand) {
              const shift = unprojectDelta(duCm, dvCm, view);
              /**
               * The faces a piece presents, as lines to align on.
               *
               * A corner profile's legs are inside its bounding box, and they
               * are what has to finish up flush — with a panel, or with the leg
               * of the corner across from it. Aligning by the box alone works
               * from two sides of an L and is impossible from the other two.
               */
              const snapLines = (rect: ReturnType<typeof projectPiece>, m: Material, rot: number) => {
                const bands = faceBands(rect, m, rot, isElevation(view));
                if (!bands?.length) return {};
                const xLines: number[] = [];
                const yLines: number[] = [];
                for (const b of bands) {
                  if (b.axis === 'v') xLines.push(b.from, b.to);
                  else yLines.push(b.from, b.to);
                }
                return { xLines, yLines };
              };

              const movingRects = baseline
                .filter((p) => selected.has(p.id))
                .map((p) => {
                  const m = byId.get(p.materialId);
                  if (!m) return null;
                  const moved: Piece = {
                    ...p,
                    x: p.x + shift.dx,
                    y: p.y + shift.dy,
                    z: (p.z ?? 0) + shift.dz,
                  };
                  const rect = projectPiece(moved, m, view);
                  return { ...rect, ...snapLines(rect, m, p.rot) };
                })
                .filter((r): r is NonNullable<typeof r> => r !== null);

              const movingBox = unionRect(movingRects);
              if (movingBox) {
                const targets = s.pieces
                  .filter((p) => !selected.has(p.id))
                  .map((p) => {
                    const m = byId.get(p.materialId);
                    if (!m) return null;
                    const rect = projectPiece(p, m, view);
                    return { ...rect, ...snapLines(rect, m, p.rot) };
                  })
                  .filter((r): r is NonNullable<typeof r> => r !== null);

                // The drawn layout snaps too. This is the whole point of
                // keeping the sketch: a panel butts to the line the wall was
                // set out on, so the formwork lands on the layout rather than
                // near it. Plan only — the lines are a plan, and in an
                // elevation their coordinates mean something else entirely.
                if (view === 'plan' && s.showSketch) {
                  targets.push(...sketchSnapTargets(s.sketch));
                }

                // In cm, but held at a constant number of screen pixels so the
                // pull feels the same however far in you are zoomed.
                const snapResult = computeEdgeSnap(movingBox, targets, EDGE_SNAP_PX / s.zoom);
                // An axis that caught takes the raw drag plus its correction,
                // landing exactly on the edge it found. An axis that caught
                // nothing falls back to the grid.
                if (snapResult.guideX !== null) snapDu = duCm + snapResult.dx;
                if (snapResult.guideY !== null) snapDv = dvCm + snapResult.dy;
                guideX = snapResult.guideX;
                guideY = snapResult.guideY;
              }
            }

            const move = unprojectDelta(snapDu ?? gridDu, snapDv ?? gridDv, view);

            /**
             * The drawn layout comes along, on the same delta the pieces got.
             *
             * Plan only: in an elevation the lines are not what is on screen,
             * and a delta that means "sideways and up" there would move them
             * somewhere that has nothing to do with the drag.
             */
            const carried =
              sketchBaseline?.length && !isElevation(view)
                ? (() => {
                    const was = new Map(sketchBaseline.map((k) => [k.id, k]));
                    return {
                      sketch: s.sketch.map((k) => {
                        const base = was.get(k.id);
                        return base ? translatePath(base, move.dx, move.dy) : k;
                      }),
                    };
                  })()
                : null;

            return {
              ...carried,
              guideX,
              guideY,
              pieces: s.pieces.map((p) => {
                if (!selected.has(p.id)) return p;
                const base = origin.get(p.id) ?? p;
                return {
                  ...p,
                  x: base.x + move.dx,
                  y: base.y + move.dy,
                  // Nothing sits below the slab it is poured on.
                  z: Math.max(0, (base.z ?? 0) + move.dz),
                };
              }),
            };
          }),

        /**
         * Live drag from the 3D view.
         *
         * Deliberately simpler than `moveSelectionBy`: no edge snapping. That
         * aid works off a tolerance in 2D screen pixels and lines up bounding
         * boxes in plan, neither of which means anything while orbiting in 3D.
         * The grid still applies, per axis, against the drag baseline so
         * repeated snapping cannot creep.
         *
         * Elevation is clamped at the ground — formwork does not hang in a pit,
         * and a piece dragged below zero would vanish under the grid.
         */
        moveSelectionSpatially: (dxCm, dyCm, dzCm, baseline) =>
          apply((s) => {
            const selected = new Set(s.selectedIds);
            if (!selected.size) return {};
            const origin = new Map(baseline.map((p) => [p.id, p]));
            const gridDx = snapValue(dxCm, s.snapStep, s.snap);
            const gridDy = snapValue(dyCm, s.snapStep, s.snap);
            const gridDz = snapValue(dzCm, s.snapStep, s.snap);

            return {
              pieces: s.pieces.map((p) => {
                if (!selected.has(p.id)) return p;
                const base = origin.get(p.id) ?? p;
                return {
                  ...p,
                  x: base.x + gridDx,
                  y: base.y + gridDy,
                  z: Math.max(0, (base.z ?? 0) + gridDz),
                };
              }),
            };
          }),

        endDrag: () => set({ guideX: null, guideY: null }),

        setPosition: (x, y) =>
          commit((s) => {
            if (s.selectedIds.length !== 1) return {};
            const id = s.selectedIds[0];
            return { pieces: s.pieces.map((p) => (p.id === id ? { ...p, x, y } : p)) };
          }),

        setElevation: (zCm) =>
          commit((s) => {
            const selected = new Set(s.selectedIds);
            if (!selected.size) return {};
            const z = Math.max(0, zCm);
            return {
              pieces: s.pieces.map((p) => (selected.has(p.id) ? { ...p, z } : p)),
            };
          }),

        /**
         * Relative, so a selection spanning several courses keeps its spacing
         * instead of collapsing onto one level.
         */
        nudgeElevation: (dzCm) =>
          commit((s) => {
            const selected = new Set(s.selectedIds);
            if (!selected.size) return {};
            return {
              pieces: s.pieces.map((p) =>
                selected.has(p.id) ? { ...p, z: Math.max(0, (p.z ?? 0) + dzCm) } : p,
              ),
            };
          }),

        /** Arrow keys, in surface centimetres — so they follow the view too. */
        nudgeSelection: (duCm, dvCm) =>
          commit((s) => {
            const selected = new Set(s.selectedIds);
            if (!selected.size) return {};
            const move = unprojectDelta(duCm, dvCm, s.surfaceView);
            return {
              pieces: s.pieces.map((p) =>
                selected.has(p.id)
                  ? {
                      ...p,
                      x: p.x + move.dx,
                      y: p.y + move.dy,
                      z: Math.max(0, (p.z ?? 0) + move.dz),
                    }
                  : p,
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
            // Delete means "remove what is selected", and a reference line is
            // a thing that can be selected. Two lists rather than one, because
            // everything else about a piece — the bill, the gap check, the
            // inspector — would be wrong if a line could get into `selectedIds`.
            const pieceIds = new Set(s.selectedIds);
            const sketchIds = new Set(s.selectedSketchIds);
            if (!pieceIds.size && !sketchIds.size) return {};
            return {
              pieces: pieceIds.size ? s.pieces.filter((p) => !pieceIds.has(p.id)) : s.pieces,
              sketch: sketchIds.size ? s.sketch.filter((k) => !sketchIds.has(k.id)) : s.sketch,
              selectedIds: [],
              selectedSketchIds: [],
            };
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
                  // Stacking upward keeps the plan position, so the copies sit
                  // exactly above the original — the point of a course.
                  z: axis === 'z' ? Math.max(0, (p.z ?? 0) + pitch * i) : p.z,
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

        generateWallRun: (spec) => {
          const state = get();
          /**
           * A wall is two faces, so it is two lines.
           *
           * The typed thickness is spent here and nowhere else: it sets how far
           * apart the two lines go. Each is then filled by the same generator a
           * hand-drawn line is, standing its panels on the side facing away
           * from the pour - the near face's outward is the left of travel, the
           * far face's is the right.
           */
          const half = spec.thickness / 2;
          const mid = spec.originY + half;
          const faces: Array<{ path: SketchPath; flip: boolean }> = [
            {
              path: {
                id: uid('sk'),
                points: [
                  { x: spec.originX, y: mid - half },
                  { x: spec.originX + spec.length, y: mid - half },
                ],
              },
              flip: false,
            },
            {
              path: {
                id: uid('sk'),
                points: [
                  { x: spec.originX, y: mid + half },
                  { x: spec.originX + spec.length, y: mid + half },
                ],
              },
              flip: true,
            },
          ];

          const pieces: Piece[] = [];
          const warnings: string[] = [];
          for (const face of faces) {
            const plan = planSketchFill(
              face.path,
              { height: spec.height, flip: face.flip, includeCorners: true },
              state.materials,
            );
            pieces.push(...plan.pieces);
            warnings.push(...plan.warnings);
          }
          if (!pieces.length) return { added: 0, warnings: [...new Set(warnings)] };

          commit((s) => ({
            sketch: [...s.sketch, ...faces.map((f) => f.path)],
            pieces: [...s.pieces, ...pieces],
            selectedIds: pieces.map((p) => p.id),
            selectedSketchIds: [],
          }));
          return { added: pieces.length, warnings: [...new Set(warnings)] };
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
                d.id === s.activeDocId
                  ? { ...d, pieces: previous.pieces, sketch: previous.sketch }
                  : d,
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
                d.id === s.activeDocId
                  ? { ...d, pieces: next.pieces, sketch: next.sketch }
                  : d,
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
              sketch: target.sketch,
              selectedIds: [],
              selectedSketchIds: [],
              selectedSketchPart: null,
              penPoints: [],
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
            copy.sketch = source.sketch.map((k) => ({ ...k, id: uid('sk') }));
            return {
              documents: [...s.documents, copy],
              activeDocId: copy.id,
              pieces: copy.pieces,
              sketch: copy.sketch,
              selectedIds: [],
              selectedSketchIds: [],
              selectedSketchPart: null,
              penPoints: [],
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
              sketch: active.sketch,
              selectedIds: [],
              selectedSketchIds: [],
              selectedSketchPart: null,
              penPoints: [],
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
        setOrthoLock: (on) => set({ orthoLock: on }),
        setShowDims: (on) => set({ showDims: on }),
        setShowNames: (on) => set({ showNames: on }),
        setForceLabels: (on) => set({ forceLabels: on }),
        setShowOverlaps: (on) => set({ showOverlaps: on }),
        setShowGaps: (on) => set({ showGaps: on }),
        setShowSketch: (on) =>
          set((s) => ({
            showSketch: on,
            // Hiding the layout while the pen is out would leave clicks
            // vanishing into a layer nobody can see.
            tool: on ? s.tool : 'select',
            penPoints: on ? s.penPoints : [],
            selectedSketchIds: on ? s.selectedSketchIds : [],
          })),
        setViewMode: (mode) => set({ viewMode: mode }),

        /**
         * Switch which orthographic view the surface shows, then reframe.
         *
         * The reframe is not a convenience. A plan sits around the origin
         * while an elevation sits entirely above the ground line, at negative
         * surface y, so keeping the pan would leave the model off-screen and
         * the surface looking empty.
         */
        setSurfaceView: (view) => {
          if (get().surfaceView === view) return;
          set({ surfaceView: view, guideX: null, guideY: null });
          get().fitToContent();
        },

        setHiddenLines: (mode) => set({ hiddenLines: mode }),
        setPaletteOpen: (on) => set({ paletteOpen: on }),
        setInspectorOpen: (on) => set({ inspectorOpen: on }),
        setInspectorTab: (tab) => set({ inspectorTab: tab }),
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

        // ── the drawn layout ────────────────────────────────────────────────
        setTool: (tool) =>
          set((s) => ({
            tool,
            // You cannot draw into a layer you cannot see.
            showSketch: tool === 'pen' ? true : s.showSketch,
            // Leaving the pen abandons whatever it was halfway through, rather
            // than keeping a dangling path that reappears next time.
            penPoints: tool === 'pen' ? s.penPoints : [],
          })),

        penAddPoint: (x, y) =>
          set((s) => {
            const last = s.penPoints[s.penPoints.length - 1];
            /**
             * A vertex the pointer never really moved to.
             *
             * Judged in screen pixels rather than centimetres, because that is
             * where the intent is: a hand that has not moved has not asked for
             * a leg, however many centimetres a pixel happens to be worth at
             * this zoom. Double-clicking to finish a run is the case that made
             * it necessary — the second click of the pair lands a pixel from
             * the first and used to plant a 2 cm stub before the run ended.
             */
            if (last && Math.hypot(x - last.x, y - last.y) * s.zoom < DRAG_THRESHOLD_PX) {
              return {};
            }
            return { penPoints: [...s.penPoints, { x, y }] };
          }),

        penUndoPoint: () => set((s) => ({ penPoints: s.penPoints.slice(0, -1) })),

        penCancel: () => set({ penPoints: [] }),

        penFinish: (closed = false) =>
          commit((s) => {
            // One point is a dot, not a line. Two coincident points likewise.
            if (s.penPoints.length < 2) return { penPoints: [] };
            const path: SketchPath = {
              id: uid('sk'),
              points: s.penPoints,
              ...(closed ? { closed: true } : {}),
            };
            return { sketch: [...s.sketch, path], penPoints: [] };
          }),

        dragSketch: (hit, dx, dy, baseline, whole = false) =>
          apply((s) => {
            const moved = whole
              ? translatePath(baseline, dx, dy)
              : hit.vertex !== undefined
                ? moveVertex(baseline, hit.vertex, dx, dy)
                : moveSegment(baseline, hit.index, dx, dy);
            // Snapped after the move, not before: the move is constrained to
            // one axis, so snapping the raw pointer delta would put the leg on
            // the grid in a direction it is not allowed to travel in.
            //
            // Whole centimetres even with the grid off, for the same reason the
            // pen rounds: dragging a wall to 180.2 is not a dimension anybody
            // asked for, and it is the neighbouring legs that inherit it.
            const step = s.snap ? Math.max(s.snapStep, 1) : 1;
            const snapped = {
              ...moved,
              points: moved.points.map((p, i) =>
                baseline.points[i] && p.x === baseline.points[i].x && p.y === baseline.points[i].y
                  ? p
                  : { x: snapValue(p.x, step, true), y: snapValue(p.y, step, true) },
              ),
            };
            return { sketch: s.sketch.map((k) => (k.id === baseline.id ? snapped : k)) };
          }),

        setLegLength: (pathId, index, cm) =>
          commit((s) => ({
            sketch: s.sketch.map((k) => (k.id === pathId ? setLegLengthOn(k, index, cm) : k)),
          })),

        fillSketch: (pathIds, spec) => {
          const state = get();
          const paths = state.sketch.filter((k) => pathIds.includes(k.id));
          if (!paths.length) return { added: 0, warnings: ['ნახაზი ვერ მოიძებნა.'] };
          const plan = planSketchFillAll(paths, spec, state.materials);
          if (plan.pieces.length) {
            commit((s) => ({
              pieces: [...s.pieces, ...plan.pieces],
              selectedIds: plan.pieces.map((p) => p.id),
              // The formwork is what you are working on now, not the line it
              // was set out to.
              selectedSketchIds: [],
            }));
          }
          return { added: plan.pieces.length, warnings: plan.warnings };
        },

        dragSketchAll: (dx, dy, baselines) =>
          apply((s) => {
            const step = s.snap ? Math.max(s.snapStep, 1) : 1;
            const sdx = snapValue(dx, step, true);
            const sdy = snapValue(dy, step, true);
            if (!sdx && !sdy) return {};
            const byId = new Map(baselines.map((b) => [b.id, b]));
            return {
              sketch: s.sketch.map((k) => {
                const base = byId.get(k.id);
                return base ? translatePath(base, sdx, sdy) : k;
              }),
            };
          }),

        selectSketchMany: (ids, additive = false) =>
          set((s) => ({
            selectedSketchIds: additive
              ? [...new Set([...s.selectedSketchIds, ...ids])]
              : ids,
            selectedSketchPart: null,
          })),

        selectSketchPart: (part) =>
          set((s) => ({
            selectedSketchPart: part,
            // Picking a part picks the run it belongs to as well, so the
            // inspector has something to show and the run can be moved whole
            // without letting go of the leg first.
            selectedSketchIds: part
              ? s.selectedSketchIds.includes(part.pathId)
                ? s.selectedSketchIds
                : [part.pathId]
              : s.selectedSketchIds,
            selectedIds: part ? [] : s.selectedIds,
          })),

        insertSketchVertex: (pathId, index, at) =>
          commit((s) => {
            const path = s.sketch.find((k) => k.id === pathId);
            if (!path) return {};
            const step = s.snap ? Math.max(s.snapStep, 1) : 1;
            const on = { x: snapValue(at.x, step, true), y: snapValue(at.y, step, true) };
            return {
              sketch: s.sketch.map((k) => (k.id === pathId ? insertVertex(k, index, on) : k)),
              // The new junction is what you just made, so it is what is selected.
              selectedSketchPart: { pathId, kind: 'vertex' as const, index: index + 1 },
              // ...and the pen carries on from it. Putting a junction somewhere
              // is almost always the first half of "and a wall goes off here";
              // making that a second, separate gesture would be ceremony.
              penPoints: [on],
            };
          }),

        removeSketchVertex: (pathId, index) =>
          commit((s) => {
            const path = s.sketch.find((k) => k.id === pathId);
            if (!path) return {};
            const next = removeVertex(path, index);
            return {
              // Nothing left worth keeping means the run goes with the junction.
              sketch: next
                ? s.sketch.map((k) => (k.id === pathId ? next : k))
                : s.sketch.filter((k) => k.id !== pathId),
              selectedSketchPart: null,
              selectedSketchIds: next ? s.selectedSketchIds : [],
            };
          }),

        closeSketchPath: (pathId, closed) =>
          commit((s) => ({
            sketch: s.sketch.map((k) =>
              // Two points enclose nothing, so there is no loop to make of them.
              k.id === pathId && k.points.length > 2 ? { ...k, closed } : k,
            ),
          })),

        setLegAngle: (pathId, index, deg) =>
          commit((s) => ({
            sketch: s.sketch.map((k) => (k.id === pathId ? setLegAngle(k, index, deg) : k)),
          })),

        selectSketch: (id, additive = false) =>
          set((s) => {
            if (!id) return { selectedSketchIds: [] };
            if (!additive) return { selectedSketchIds: [id], selectedIds: [] };
            return {
              selectedSketchIds: s.selectedSketchIds.includes(id)
                ? s.selectedSketchIds.filter((x) => x !== id)
                : [...s.selectedSketchIds, id],
            };
          }),
      };
    },
    {
      // With a backend, only preferences are kept locally, and under their own
      // key — see PREFS_KEY for why sharing the old one would destroy data.
      name: isConfigured ? PREFS_KEY : STORAGE_KEY,
      version: 4,
      storage: safeStorage,
      // v2 stored a single top-level `pieces` array instead of named drawings.
      // `merge` normalises either shape, so migration mostly passes through.
      migrate: (persisted) => {
        const state = persisted as Partial<EditorState> | undefined;
        if (!state) return {};
        // v3 offered 10 cm and 25 cm grid steps. The panels are 30/45/60/75/90,
        // whose common module is 15: a 25 cm grid lands one of those five on a
        // grid line and 10 lands three, so both spent most of their time
        // pulling panels off the joints they were meant to butt against. Anyone
        // still on one moves to the nearest step that the catalog divides into.
        const remap: Record<number, number> = { 10: 15, 25: 30 };
        const step = state.snapStep;
        if (typeof step === 'number' && remap[step]) {
          return { ...state, snapStep: remap[step] };
        }
        return state;
      },
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

        // `sketch` has to come from the restored active drawing for the same
        // reason `pieces` does: the top-level copy is a mirror, and a reload
        // that trusts the mirror over the document shows the lines of whichever
        // drawing happened to be open when the tab was last written.
        const { documents, activeDocId, pieces, sketch } = restoreDocuments(saved);
        const materials = mergeCatalog(saved.materials, saved.removedBuiltins);
        return {
          ...current,
          ...saved,
          materials,
          warehouses: restoreWarehouses(saved.warehouses, materials),
          documents,
          activeDocId,
          pieces,
          sketch,
          selectedIds: [],
          selectedSketchIds: [],
          // Reopening in a mode that swallows clicks would be baffling.
          tool: 'select',
          penPoints: [],
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
  sketch: SketchPath[];
} {
  const stored = Array.isArray(saved.documents) ? saved.documents : [];
  const documents = stored
    .filter((d): d is DrawingDoc => !!d && typeof d.id === 'string')
    .map((d) => ({
      id: d.id,
      name: typeof d.name === 'string' && d.name ? d.name : 'ნახაზი',
      updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : Date.now(),
      pieces: Array.isArray(d.pieces) ? d.pieces : [],
      // and the sketch after those — a drawing made before the pen has none
      sketch: Array.isArray(d.sketch) ? d.sketch : [],
      // title-block fields arrived after named drawings did
      projectName: typeof d.projectName === 'string' ? d.projectName : '',
      revision: typeof d.revision === 'string' && d.revision ? d.revision : 'A',
      // 0 means "auto scale"; anything invalid falls back to 1:50
      scale: typeof d.scale === 'number' && d.scale >= 0 ? d.scale : 50,
    }));

  if (!documents.length) {
    const doc = newDoc('ნახაზი 1', Array.isArray(saved.pieces) ? saved.pieces : []);
    return { documents: [doc], activeDocId: doc.id, pieces: doc.pieces, sketch: doc.sketch };
  }

  const active = documents.find((d) => d.id === saved.activeDocId) ?? documents[0];
  return {
    documents,
    activeDocId: active.id,
    pieces: active.pieces,
    sketch: active.sketch,
  };
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
