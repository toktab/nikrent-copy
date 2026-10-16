import { describe, expect, it } from 'vitest';
import {
  connectorCount,
  connectorsAtCorners,
  findBolts,
  openBolts,
  resetBolts,
  snapConnector,
  withBoltOff,
  findRods,
  openRods,
  rodCount,
  rodMaterialFor,
  rodPieceAt,
  rodStack,
  rodStackOf,
  snapRod,
  withRodOff,
} from '../bolts';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import type { Piece } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
let n = 0;
const put = (materialId: string, x: number, y: number, rot = 0, z?: number): Piece => ({
  id: `p${n++}`,
  materialId,
  x,
  y,
  rot,
  ...(z !== undefined ? { z } : {}),
});

/**
 * A panel standing on its end, so its footprint is 9 wide and `w` tall with its
 * top-left at (x, y). Turned about its centre, so the stored x/y are offset.
 */
const upright = (materialId: string, x: number, y: number, z?: number): Piece => {
  const w = byId.get(materialId)!.w;
  return put(materialId, x - (w - 9) / 2, y + (w - 9) / 2, 90, z);
};

describe('findBolts', () => {
  it('puts one bolt where a panel ends against the face of another - the T', () => {
    const top = put('panel-90x300', 0, 0); // 0..90 across, 0..9 deep
    const leg = upright('panel-60x300', 40, 9); // 40..49 across, 9..69 down
    const bolts = findBolts([top, leg], byId);
    expect(bolts).toHaveLength(1);
    expect(bolts[0]).toMatchObject({ kind: 'tee', x: 44.5, y: 9 });
  });

  it('bolts the lap at an outside corner the same way', () => {
    const through = put('panel-90x300', 0, 0);
    const butt = upright('panel-60x300', 81, 9); // flush with the through panel's end
    expect(findBolts([through, butt], byId)).toHaveLength(1);
  });

  it('does not bolt two panels in line', () => {
    expect(findBolts([put('panel-90x300', 0, 0), put('panel-60x300', 90, 0)], byId)).toHaveLength(0);
  });

  it('does not bolt panels that only nearly touch', () => {
    const top = put('panel-90x300', 0, 0);
    expect(findBolts([top, upright('panel-60x300', 40, 14)], byId)).toHaveLength(0);
  });

  it('bolts an inner corner where its leg ends on a ჩაკერება 5', () => {
    const corner = put('corner-inner-20x20x300', 0, 0); // foot ends at x 20, y 11..20
    const filler = put('filler-5x300', 20, 11);
    const bolts = findBolts([corner, filler], byId);
    expect(bolts).toHaveLength(1);
    expect(bolts[0]).toMatchObject({ kind: 'corner', x: 20, y: 15.5 });
  });

  it('and on a ჩაკერება 10 at the end of the other leg, turned', () => {
    const corner = put('corner-inner-20x20x300', 0, 0, 90);
    // Turned 90° the L's upright leg end moves to the right side, x 20, y 0..9.
    const filler = put('filler-10x300', 20, 0);
    expect(findBolts([corner, filler], byId)).toEqual([
      expect.objectContaining({ kind: 'corner', x: 20, y: 4.5 }),
    ]);
  });

  it('does not bolt a filler that is beside the corner but not at a leg end', () => {
    const corner = put('corner-inner-20x20x300', 0, 0);
    const filler = put('filler-5x300', 20, 0); // against the box, not the foot
    expect(findBolts([corner, filler], byId)).toHaveLength(0);
  });

  it('counts each course of a stacked wall', () => {
    const pieces = [0, 300].flatMap((z) => [
      put('panel-90x300', 0, 0, 0, z),
      upright('panel-60x300', 40, 9, z),
    ]);
    expect(findBolts(pieces, byId)).toHaveLength(2);
  });
});

describe('placed კონექტორები', () => {
  // The T from the first test: the leg's end meets the top panel along x 40..49 at y 9.
  const tee = () => [put('panel-90x300', 0, 0), upright('panel-60x300', 40, 9)];
  /** A კუთხის კონექტორი (8 × 8 in plan) with its middle at (x, y). */
  const connectorAt = (x: number, y: number) => put('corner-connector', x - 4, y - 4);

  it('takes the joint it stands on - no mark there, and not counted twice', () => {
    const pieces = [...tee(), connectorAt(44.5, 9)];
    expect(openBolts(pieces, byId)).toHaveLength(0);
    expect(connectorCount(pieces, byId)).toBe(1);
  });

  it('still takes it when slid along the joint', () => {
    const pieces = [...tee(), connectorAt(41, 9)];
    expect(openBolts(pieces, byId)).toHaveLength(0);
  });

  it('counts one placed away from the joint as well as the joint', () => {
    const pieces = [...tee(), connectorAt(44.5, 40)];
    expect(openBolts(pieces, byId)).toHaveLength(1);
    expect(connectorCount(pieces, byId)).toBe(2);
  });

  it('snaps to the middle of a worked-out joint in reach', () => {
    expect(snapConnector({ x: 50, y: 12 }, tee(), byId, 10)).toEqual({ x: 44.5, y: 9, z: 0 });
  });

  it('snaps onto any stretch where two pieces touch, nearest the pointer', () => {
    // Two panels in line: no bolt by the rule, but a joint a connector can go on.
    const pieces = [put('panel-90x300', 0, 0), put('panel-60x300', 90, 0)];
    expect(snapConnector({ x: 93, y: 3 }, pieces, byId, 10)).toEqual({ x: 90, y: 3, z: 0 });
  });

  it('finds nothing out of reach', () => {
    expect(snapConnector({ x: 300, y: 300 }, tee(), byId, 10)).toBeNull();
  });
});

describe('connectorsAtCorners', () => {
  it('marks a connector on a corner, and not one on two panels', () => {
    const corner = put('corner-inner-20x20x300', 0, 0);
    const filler = put('filler-5x300', 20, 11);
    const onCorner = put('corner-connector', 20 - 4, 15.5 - 4);
    const panels = [put('panel-90x300', 100, 0), put('panel-60x300', 190, 0)];
    const loose = put('corner-connector', 190 - 4, 4.5 - 4);
    const hits = connectorsAtCorners([corner, filler, onCorner, ...panels, loose], byId);
    expect([...hits]).toEqual([onCorner.id]);
  });
});

describe('taking a joint off and putting it back', () => {
  it('drops a joint taken off by hand, whichever piece holds it', () => {
    const [top, leg] = [put('panel-90x300', 0, 0), upright('panel-60x300', 40, 9)];
    expect(findBolts(withBoltOff([top, leg], top.id, leg.id), byId)).toHaveLength(0);
    expect(findBolts(withBoltOff([top, leg], leg.id, top.id), byId)).toHaveLength(0);
  });

  it('resets to the rule: joints back, hand-placed connectors gone', () => {
    const [top, leg] = [put('panel-90x300', 0, 0), upright('panel-60x300', 40, 9)];
    const moved = put('corner-connector', 200, 200);
    const pieces = resetBolts([...withBoltOff([top, leg], top.id, leg.id), moved], byId);
    expect(pieces.map((p) => p.id)).toEqual([top.id, leg.id]);
    expect(pieces.every((p) => p.boltsOff === undefined)).toBe(true);
    expect(findBolts(pieces, byId)).toHaveLength(1);
  });
});

describe('შტირები', () => {
  // Two faces of a wall along x, 21 cm of concrete between them, joints at x 90.
  const wall = (innerAt = 90) => [
    put('panel-90x300', 0, 0),
    put('panel-90x300', 90, 0),
    put('panel-90x300', innerAt - 90, 30),
    put('panel-90x300', innerAt, 30),
  ];

  it('puts one rod through joints that face each other across the wall', () => {
    const rods = findRods(wall(), byId);
    expect(rods).toHaveLength(1);
    expect(rods[0]).toMatchObject({ dir: 'v', at: 90, from: 0, to: 39, x: 90, y: 19.5 });
  });

  it('puts none where the joints do not line up', () => {
    expect(findRods(wall(120), byId)).toHaveLength(0);
  });

  it('turns with a wall that runs along y', () => {
    const across = (x: number, y: number) => upright('panel-90x300', x, y);
    const rods = findRods([across(0, 0), across(0, 90), across(30, 0), across(30, 90)], byId);
    expect(rods).toHaveLength(1);
    expect(rods[0]).toMatchObject({ dir: 'h', at: 90, x: 19.5, y: 90 });
  });

  it('is taken off by hand and put back by a reset of rods only', () => {
    const pieces = wall();
    const [rod] = findRods(pieces, byId);
    const off = withRodOff(pieces, rod);
    expect(findRods(off, byId)).toHaveLength(0);
    expect(findRods(off, byId, true)).toHaveLength(1);
    const back = resetBolts(off, byId, { connectors: false, rods: true });
    expect(findRods(back, byId)).toHaveLength(1);
  });

  it('counts a placed rod on the spot once, and snaps a dragged one onto it turned', () => {
    const pieces = wall();
    const m = rodMaterialFor(SEED_MATERIALS, 39)!;
    expect(m.id).toBe('rod-60');
    const spot = snapRod({ x: 95, y: 15 }, pieces, byId, 20)!;
    expect(spot).toEqual({ x: 90, y: 19.5, z: 0, rot: 90, h: 300, count: 5 });
    const placed = [...pieces, rodPieceAt(m, spot, 'r1')];
    expect(openRods(placed, byId)).toHaveLength(0);
    expect(rodCount(placed, byId)).toBe(1);
  });
});

describe('შტირები at a ჩაკერება', () => {
  it('ties a panel-to-ჩაკერება joint across from a panel joint', () => {
    // Outer face: two panels meeting at x 90. Inner face: a ჩაკერება 5 at
    // x 85..90, then a panel from 90 - its joint with the panel faces the outer one.
    const pieces = [
      put('panel-90x300', 0, 0),
      put('panel-90x300', 90, 0),
      put('panel-60x300', 25, 30),
      put('filler-5x300', 85, 30),
      put('panel-90x300', 90, 30),
    ];
    const rods = findRods(pieces, byId);
    expect(rods.map((r) => r.at)).toEqual([90]);
  });
});

describe('შტირები up the height', () => {
  const wall = (id: string) => [put(id, 0, 0), put(id, 90, 0), put(id, 0, 30), put(id, 90, 30)];

  it('counts five at a spot on 300 panels and two on 150', () => {
    expect(rodCount(wall('panel-90x300'), byId)).toBe(5);
    // panel-75x150 is the 150 the catalog has in a 75 width
    const short = [put('panel-75x150', 0, 0), put('panel-75x150', 75, 0), put('panel-75x150', 0, 30), put('panel-75x150', 75, 30)];
    expect(rodCount(short, byId)).toBe(2);
  });

  it('stacks the rods evenly up the face, and a stack fills its spot', () => {
    const pieces = wall('panel-90x300');
    const spot = snapRod({ x: 90, y: 20 }, pieces, byId, 10)!;
    const m = byId.get('rod-60')!;
    let n = 0;
    const stack = rodStack(m, spot, [], () => `s${n++}`);
    expect(stack.map((p) => p.z! + m.h / 2)).toEqual([30, 90, 150, 210, 270]);
    expect(rodStackOf(stack[2], [...pieces, ...stack], byId)).toHaveLength(5);
    expect(openRods([...pieces, ...stack], byId)).toHaveLength(0);
    expect(rodCount([...pieces, ...stack], byId)).toBe(5);
  });
});
