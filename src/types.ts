/** Material categories (fixed set, mirrors the CATS map of the v1 prototype). */
export type Category = 'panel' | 'waler' | 'corner' | 'post' | 'filler' | 'rod' | 'acc';

/** How a material is drawn on the surface and in the palette swatch. */
export type Shape = 'rect' | 'L' | 'line';

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
  /** unit price in the project currency (0 = not priced yet) */
  price: number;
  /** unit weight in kg (0 = unknown) — drives crane and truck loads */
  weight: number;
  /** supplier article / catalogue number */
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
  /** 0 | 90 | 180 | 270 */
  rot: number;
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
export interface DrawingDoc {
  id: string;
  name: string;
  /** epoch ms of the last edit */
  updatedAt: number;
  pieces: Piece[];
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
  removedBuiltins: string[];
}

/** Parameters of the array/repeat tool. */
export interface ArrayOptions {
  count: number;
  /** centre-to-centre spacing in cm */
  pitch: number;
  axis: 'x' | 'y';
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

/** Shape of an exported catalog file (materials + stock, no drawing). */
export interface CatalogFile {
  app: 'du-formwork';
  kind: 'catalog';
  version: number;
  exportedAt: string;
  materials: Material[];
  warehouses?: Warehouse[];
}

/** Shape of an exported layout file (placed pieces, no catalog). */
export interface LayoutFile {
  app: 'du-formwork';
  kind: 'layout';
  version: number;
  exportedAt: string;
  pieces: Piece[];
}

/** Modal currently open (kept out of persisted state). */
export type DialogState =
  | { kind: 'material'; materialId?: string }
  | { kind: 'sheet-import' }
  | { kind: 'array' }
  | { kind: 'column-wizard' }
  | { kind: 'warehouses' }
  | { kind: 'title-block' }
  | { kind: 'documents' }
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
