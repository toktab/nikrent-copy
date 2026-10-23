import type { Material, Piece } from '../types';
import { planH, planW } from './geometry';
import {
  connectorMaterial,
  fittingStack,
  isNut,
  latchMaterial,
  latchStack,
  nutMaterial,
  openBolts,
  openLatches,
  openRodEnds,
  openRods,
  outward,
  pieceCentre,
  rodMaterialFor,
  rodSpot,
  rodStack,
  withBoltOff,
  withRodOff,
} from './bolts';
import { boltKindOf, type BoltKindName } from './boltMarks';

/*
 * ჩანაცვლება - swap pieces on the drawing for another catalog item.
 *
 * As the user asked (2026-10-23): pick a kind from a list and every one of it
 * on the drawing is selected, or pick pieces by hand with Ctrl + click; then
 * choose what to put in their place - a შტირი of another length, another
 * კონექტორი, another panel - from what the catalog has of the same kind.
 *
 * The worked-out ჭანჭიკები are marks, not pieces, so selecting a ჭანჭიკი kind
 * first turns its marks into real pieces where they stand - the same as taking
 * hold of one - so there is something to select and replace.
 */

/**
 * What a piece can be swapped for: the same ჭანჭიკი kind, the same side of a
 * corner, or else the same catalog category.
 */
export function replaceKindOf(m: Material): string {
  const bolt = boltKindOf(m);
  if (bolt) return `bolt:${bolt}`;
  if (m.category === 'corner') {
    if (m.name.includes('შიდა')) return 'corner:inner';
    if (m.name.includes('გარე')) return 'corner:outer';
    return `corner:${m.id}`;
  }
  return m.category;
}

/** The catalog items the selected pieces can become - none when they are not all one kind. */
export function replacementsFor(selected: Material[], materials: Material[]): Material[] {
  const kinds = new Set(selected.map(replaceKindOf));
  if (kinds.size !== 1) return [];
  const [kind] = kinds;
  return materials.filter((m) => replaceKindOf(m) === kind);
}

/**
 * The pieces with `ids` turned into `m`, standing where they stood: a fitting
 * centred on its spot at its height stays centred, a ქანჩი + დისკო keeps to the
 * face it sits on, and anything else keeps its middle and its floor.
 */
export function replacePieces(pieces: Piece[], ids: Set<string>, m: Material, byId: Map<string, Material>): Piece[] {
  return pieces.map((p) => {
    const old = byId.get(p.materialId);
    if (!ids.has(p.id) || !old || old.id === m.id) return p;
    let c = pieceCentre(p, old);
    if (isNut(old)) {
      // From the face out: the end it is on, then half the new one.
      const o = outward(p.rot);
      const d = (planW(m) - planW(old)) / 2;
      c = { x: c.x + o.x * d, y: c.y + o.y * d };
    }
    const fitting = boltKindOf(old) !== null;
    const z = fitting ? Math.max(0, (p.z ?? 0) + old.h / 2 - m.h / 2) : p.z;
    const next: Piece = { ...p, materialId: m.id, x: c.x - planW(m) / 2, y: c.y - planH(m) / 2 };
    if (z !== undefined) next.z = z;
    return next;
  });
}

/**
 * Every worked-out mark of a ჭანჭიკი kind made a real piece where it stands,
 * each spot's whole stack - so all of that kind can be selected. `added` are the
 * new pieces' ids.
 */
export function materializeBolts(
  pieces: Piece[],
  byId: Map<string, Material>,
  materials: Material[],
  kind: BoltKindName,
  newId: () => string,
): { pieces: Piece[]; added: string[] } {
  let out = pieces;
  const made: Piece[] = [];
  if (kind === 'connectors') {
    const m = connectorMaterial(materials);
    if (m) {
      for (const b of openBolts(pieces, byId)) {
        out = withBoltOff(out, b.a, b.b);
        made.push({ id: newId(), materialId: m.id, x: b.x - planW(m) / 2, y: b.y - planH(m) / 2, rot: 0, z: Math.max(0, b.z) });
      }
    }
  } else if (kind === 'rods') {
    for (const r of openRods(pieces, byId)) {
      const m = rodMaterialFor(materials, r.to - r.from);
      if (!m) continue;
      out = withRodOff(out, r);
      made.push(...rodStack(m, rodSpot(r), [], newId));
    }
  } else if (kind === 'nuts') {
    const m = nutMaterial(materials);
    if (m) for (const e of openRodEnds(pieces, byId)) made.push(...fittingStack(m, e, [], newId));
  } else {
    const m = latchMaterial(materials);
    if (m) for (const s of openLatches(pieces, byId)) made.push(...latchStack(m, s, [], newId));
  }
  return { pieces: [...out, ...made], added: made.map((p) => p.id) };
}

/** One line of the "select all of" list: a catalog item on the drawing, or a whole ჭანჭიკი kind. */
export type SelectTarget = { materialId: string } | { bolts: BoltKindName };
