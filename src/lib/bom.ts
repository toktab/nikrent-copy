import type { Category, DrawingDoc, Material, Piece } from '../types';
import { CATEGORIES, CATEGORY_ORDER } from '../data/categories';
import { isLinear, lengthCm } from './geometry';
import { commitmentsByMaterial, emptyCommitment, totalStock, type Commitment } from './inventory';

export interface BomRow {
  material: Material;
  /** how many of this material are placed on the current drawing */
  used: number;
  /** owned across every warehouse */
  stock: number;
  /** stock − used on this drawing (negative means shortage) */
  remaining: number;
  /** placed across every drawing in the project */
  committed: number;
  /** stock − committed everywhere (negative means over-committed) */
  available: number;
  shortage: boolean;
  /** total length in metres (linear materials only) */
  lengthM: number;
  /** total area in m² (non-linear materials only) */
  areaM2: number;
  /** used × unit weight, kg */
  weightKg: number;
  weightMissing: boolean;
}

export interface BomGroup {
  category: Category;
  label: string;
  color: string;
  rows: BomRow[];
  pieces: number;
  lengthM: number;
  areaM2: number;
  weightKg: number;
  shortages: number;
}

export interface Bom {
  groups: BomGroup[];
  totalPieces: number;
  totalLengthM: number;
  totalAreaM2: number;
  totalWeightKg: number;
  shortageCount: number;
  /** rows whose weight is unset, so the total is a lower bound */
  unweighedRows: number;
  /** pieces whose material no longer exists in the catalog */
  orphanPieces: number;
}

/**
 * Length in metres for one piece of this material.
 *
 * Every structural element has a real length: a "პანელი 30*300" is 3 m long,
 * exactly like a 3 m waler. Length used to be counted only for `shape: 'line'`
 * materials, so panels, corners and fillers — most of a real order — reported
 * nothing and the total read far too low.
 *
 * Accessories are the exception: a nut or a clamp is ordered by the piece, and
 * neither a length nor an area means anything for it.
 */
export function unitLengthM(m: Material): number {
  return m.category === 'acc' ? 0 : lengthCm(m) / 100;
}

/**
 * Formwork face area in m² for one piece — only the materials that actually
 * form the concrete face (panels, fillers, corners). Linear members have a
 * profile, not a face, and accessories have neither.
 */
export function unitAreaM2(m: Material): number {
  return isLinear(m) || m.category === 'acc' ? 0 : (m.w * m.h) / 10000;
}

/**
 * Live bill of materials for the pieces passed in (normally the active drawing).
 *
 * Each row carries both a length and an area; see `unitLengthM` / `unitAreaM2`
 * for which materials get which.
 *
 * `documents` is optional: when supplied, each row also reports how much of the
 * stock is committed across every drawing, not just this one.
 */
export function buildBom(
  materials: Material[],
  pieces: Piece[],
  documents: DrawingDoc[] = [],
  activeDocId = '',
): Bom {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const commitments: Map<string, Commitment> = documents.length
    ? commitmentsByMaterial(documents, activeDocId)
    : new Map();

  const used = new Map<string, number>();
  let orphanPieces = 0;
  for (const p of pieces) {
    if (!byId.has(p.materialId)) {
      orphanPieces++;
      continue;
    }
    used.set(p.materialId, (used.get(p.materialId) ?? 0) + 1);
  }

  const groups: BomGroup[] = [];
  let totalPieces = 0;
  let totalLengthM = 0;
  let totalAreaM2 = 0;
  let totalWeightKg = 0;
  let shortageCount = 0;
  let unweighedRows = 0;

  for (const category of CATEGORY_ORDER) {
    const rows: BomRow[] = [];
    let pieceCount = 0;
    let lengthM = 0;
    let areaM2 = 0;
    let weightKg = 0;
    let shortages = 0;

    for (const m of materials) {
      if (m.category !== category) continue;
      const count = used.get(m.id) ?? 0;
      if (count === 0) continue; // BOM only lists what is actually used

      const rowLength = count * unitLengthM(m);
      const rowArea = count * unitAreaM2(m);
      const stock = totalStock(m);
      const commitment = commitments.get(m.id) ?? emptyCommitment();
      const rowWeight = count * m.weight;
      const shortage = count > stock;

      rows.push({
        material: m,
        used: count,
        stock,
        remaining: stock - count,
        committed: commitment.committed,
        available: stock - commitment.committed,
        shortage,
        lengthM: rowLength,
        areaM2: rowArea,
        weightKg: rowWeight,
        weightMissing: m.weight <= 0,
      });

      pieceCount += count;
      lengthM += rowLength;
      areaM2 += rowArea;
      weightKg += rowWeight;
      if (shortage) shortages++;
      if (m.weight <= 0) unweighedRows++;
    }

    if (!rows.length) continue;
    rows.sort((a, b) => b.used - a.used || a.material.name.localeCompare(b.material.name, 'ka'));

    groups.push({
      category,
      label: CATEGORIES[category].name,
      color: CATEGORIES[category].color,
      rows,
      pieces: pieceCount,
      lengthM,
      areaM2,
      weightKg,
      shortages,
    });

    totalPieces += pieceCount;
    totalLengthM += lengthM;
    totalAreaM2 += areaM2;
    totalWeightKg += weightKg;
    shortageCount += shortages;
  }

  return {
    groups,
    totalPieces,
    totalLengthM,
    totalAreaM2,
    totalWeightKg,
    shortageCount,
    unweighedRows,
    orphanPieces,
  };
}

/** Used-count per material id — handy for the palette and inventory panels. */
export function usageByMaterial(pieces: Piece[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of pieces) map.set(p.materialId, (map.get(p.materialId) ?? 0) + 1);
  return map;
}

/** "45 × 300" — plain size for tables (the column header carries the unit). */
export function sizeLabel(m: Material): string {
  return `${m.w} × ${m.h}`;
}

/**
 * Size as it appears on the drawing: linear materials (walers, rods, posts) are
 * labelled with their length alone, everything else with width × height.
 */
export function drawingSizeLabel(m: Material): string {
  return isLinear(m) ? `${lengthCm(m)} სმ` : `${m.w} × ${m.h}`;
}

export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = Math.round(n * 10 ** digits) / 10 ** digits;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(digits);
}

