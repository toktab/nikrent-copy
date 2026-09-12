/** Material categories (fixed set, mirrors the CATS map of the v1 prototype). */
export type Category = 'panel' | 'waler' | 'corner' | 'post' | 'filler' | 'rod' | 'acc';

/** How a material is drawn on the surface and in the palette swatch. */
export type Shape = 'rect' | 'L' | 'line';

/**
 * What the 3D view does with edges that are behind other pieces:
 * drop them entirely, draw them dashed, or show everything (x-ray, handy for
 * checking ties buried inside a column).
 */
export type HiddenLineMode = 'hide' | 'dashed' | 'show';

/** The inspector's three working views. */
export type InspectorTab = 'details' | 'bom' | 'inventory';

/**
 * Stock is held per warehouse: `{ [warehouseId]: quantity }`. Companies that
 * only ever use one store see a single number in the UI and never meet the
 * concept. See `lib/inventory.ts` for the helpers.
 */
export type StockByWarehouse = Record<string, number>;

export interface Material {
  /** stable id (slug); built-ins keep a fixed id forever */
  id: string;
  /** Georgian display name, e.g. "პანელი 45*300" */
  name: string;
  category: Category;
  /**
   * Width in cm — the first dimension in a name like "პანელი 30*300".
   * This IS drawn: it is the length the piece occupies along a column face.
   */
  w: number;
  /**
   * Height in cm — the second dimension in "პანელი 30*300" (i.e. 300).
   * The drawing surface is a PLAN view, so this is vertical, points out of the
   * page, and is NOT drawn. It is what formwork area (w × h) is computed from.
   */
  h: number;
  /**
   * Plan thickness in cm — the piece's other on-screen dimension.
   * Du panels are always 9 cm thick; other categories use their own profile.
   */
  depth: number;
  shape: Shape;
  /** hex colour; defaults to the category colour */
  color: string;
  /** true for the original 41 Du materials, false for user-created ones */
  builtin: boolean;
  /** inventory: how many the company owns, per warehouse */
  stock: StockByWarehouse;
  /** unit weight in kg (0 = unknown) — drives crane and truck loads */
  weight: number;
  /** supplier's own designation for the part (აღნიშვნა) */
  article: string;
  supplier: string;
}

/** A placed instance on the drawing surface. */
export interface Piece {
  id: string;
  materialId: string;
  /** cm, top-left of the un-rotated box in world coordinates */
  x: number;
  y: number;
  /** rotation in degrees, any angle */
  rot: number;
  /**
   * Elevation of the piece's underside in cm, 0 = on the ground.
   *
   * The 2D surface is a plan view and ignores this entirely — two pieces at
   * different heights sit on top of each other in plan, which is correct. It
   * exists so stacked courses and waler rings are real, counted pieces rather
   * than a multiplier, and so the 3D view can show them at the right height.
   */
  z?: number;
}

/** Everything a material needs except its identity flags. */
export type MaterialDraft = Omit<Material, 'id' | 'builtin'>;

/** A physical store the company keeps formwork in. */
export interface Warehouse {
  id: string;
  name: string;
}

/**
 * A named drawing. The catalog and stock are company-wide and shared across
 * drawings; only the placed pieces belong to a document.
 */
/**
 * A drawn reference line: the wall layout, before any formwork exists.
 *
 * Right angles only, which is not a shortcut. Formwork is built square, the
 * catalog's corner profiles are 90°, and a junction at any other angle has no
 * component that closes it — so an angled sketch would be drawing something
 * the tool could never tell you how to build. Consecutive points therefore
 * always share an x or a y.
 *
 * Kept in plan world centimetres, like everything else on the surface. It is
 * reference geometry and never appears in the bill of materials: nobody
 * delivers a line.
 */
export interface SketchPath {
  id: string;
  /** orthogonal polyline, plan world cm */
  points: Array<{ x: number; y: number }>;
  /** the last point joins back to the first - a closed room outline */
  closed?: boolean;
  /**
   * Which face of the pour this line is, and therefore which way the formwork
   * stands off it.
   *
   * A wall is two lines. The outer one has the concrete on the inside of it and
   * the panels outside; the inner one - the void, the room, the lift shaft -
   * has the concrete outside it and the panels standing in the hole. The
   * geometry alone cannot tell the two apart: an L drawn for a wall's outer
   * face and an L drawn for its inner face are the same six numbers.
   *
   * So the pen asks, once, which kind of line is being drawn, and the answer
   * lives on the line for good. Absent means outer, which is what every line
   * drawn before this existed was taken to be.
   */
  perimeter?: 'outer' | 'inner';
}

/**
 * A measured line the user put on the drawing: "from here to there is this far".
 *
 * Free in direction, unlike a sketch leg - a check dimension is taken wherever
 * the question is, across a corner or on a diagonal. Annotation only: it never
 * reaches the bill of materials and the fill never builds against it. Plan
 * world centimetres, like everything else on the surface.
 */
export interface MeasureLine {
  id: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
}

export interface DrawingDoc {
  id: string;
  name: string;
  /** epoch ms of the last edit */
  updatedAt: number;
  pieces: Piece[];
  /** the layout the formwork is being set out to — see SketchPath */
  sketch: SketchPath[];
  /** measured check lines placed with the measure tool — see MeasureLine */
  measures: MeasureLine[];
  /** title-block fields for the printable drawing */
  projectName: string;
  revision: string;
  /** drawn-to scale denominator, e.g. 50 for 1:50 */
  scale: number;
}

/** Undo/redo unit: everything a user edit can change. */
export interface DocSnapshot {
  materials: Material[];
  pieces: Piece[];
  sketch: SketchPath[];
  measures: MeasureLine[];
  removedBuiltins: string[];
}

/** Parameters of the array/repeat tool. */
export interface ArrayOptions {
  count: number;
  /** centre-to-centre spacing in cm */
  pitch: number;
  /**
   * 'z' stacks the copies upward instead of across the plan — how a column is
   * built course by course without the wizard.
   */
  axis: 'x' | 'y' | 'z';
}

/** Input for the column formwork assembly generator. */
export interface ColumnSpec {
  /** column cross-section in cm */
  sectionX: number;
  sectionY: number;
  /** pour height in cm */
  height: number;
  /** vertical spacing between waler rings, cm */
  walerSpacing: number;
  /** where to drop the assembly, world cm */
  originX: number;
  originY: number;
  includeWalers: boolean;
  includeTies: boolean;
  includeCorners: boolean;
}

/**
 * Input for the straight-wall shortcut.
 *
 * Not a second way of building a wall — it draws a two-point run and fills it,
 * so the one generator does the work. What is left here is only what a straight
 * run needs that a drawn one already knows: how long it is, and where to put
 * it. No corner option, because a straight run has none.
 */
export interface WallRunSpec {
  /** wall run in cm */
  length: number;
  /** concrete thickness in cm, centred on the run */
  thickness: number;
  /** pour height in cm */
  height: number;
  /** where the run starts, world cm */
  originX: number;
  originY: number;
}

/** Shape of an exported catalog file (materials + stock, no drawing). */
export interface CatalogFile {
  app: 'du-formwork';
  kind: 'catalog';
  version: number;
  exportedAt: string;
  materials: Material[];
  warehouses?: Warehouse[];
}

/**
 * Shape of an exported drawing file.
 *
 * Version 3 carries the whole drawing, not just the panels: a file taken to
 * another computer has to open as the same drawing, and before it did the
 * setting-out lines, the title block and any material that machine's catalog
 * lacked were all quietly left behind. Materials travel as definitions only,
 * for the ones the pieces use - stock is company data and stays at home.
 */
export interface LayoutFile {
  app: 'du-formwork';
  kind: 'layout';
  version: number;
  exportedAt: string;
  name?: string;
  projectName?: string;
  revision?: string;
  scale?: number;
  pieces: Piece[];
  sketch?: SketchPath[];
  measures?: MeasureLine[];
  materials?: Material[];
}

/** Modal currently open (kept out of persisted state). */
export type DialogState =
  | { kind: 'material'; materialId?: string }
  | { kind: 'sheet-import' }
  | { kind: 'array' }
  | { kind: 'column-wizard' }
  | { kind: 'wall-wizard' }
  | { kind: 'sketch-fill'; pathIds: string[] }
  | { kind: 'templates' }
  | { kind: 'warehouses' }
  | { kind: 'title-block' }
  | { kind: 'documents' }
  | { kind: 'users' }
  | { kind: 'errors' }
  | { kind: 'password' }
  | { kind: 'display-settings' }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel: string;
      danger?: boolean;
      onConfirm: () => void;
    }
  | null;

/** Pan/zoom of the drawing surface. */
export interface ViewTransform {
  /** screen px per cm */
  zoom: number;
  panX: number;
  panY: number;
}
