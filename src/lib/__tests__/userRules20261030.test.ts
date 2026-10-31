import { describe, expect, it } from 'vitest';
import { connectorCount, nutCount, rodCount } from '../bolts';
import { boltGroups } from '../boltMarks';
import { findWallMate, flipWall, wallPartner } from '../wallPen';
import { snapPost } from '../posts';
import { isMaterialShown, normalizeObjectVisibility } from '../objectVisibility';
import { pieceBounds, planH } from '../geometry';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import type { Piece, SketchPath } from '../../types';

/** What the user asked for on 2026-10-30, one rule each. */
const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));

describe('ქანჩი + დისკო', () => {
  // Two faces of a 20 cm wall, 90 + 90 on each, joints opposite each other.
  const wall: Piece[] = [
    { id: 'a1', materialId: 'panel-90x300', x: 0, y: -9, rot: 0, z: 0 },
    { id: 'a2', materialId: 'panel-90x300', x: 90, y: -9, rot: 0, z: 0 },
    { id: 'b1', materialId: 'panel-90x300', x: 0, y: 20, rot: 0, z: 0 },
    { id: 'b2', materialId: 'panel-90x300', x: 90, y: 20, rot: 0, z: 0 },
  ];

  it('is two for every შტირი and one for every კონექტორი', () => {
    expect(nutCount(wall, byId)).toBe(rodCount(wall, byId) * 2 + connectorCount(wall, byId));
    expect(rodCount(wall, byId)).toBeGreaterThan(0);
    const withConnector = [...wall, { id: 'c', materialId: 'corner-connector', x: 86, y: -13, rot: 0, z: 0 }];
    expect(nutCount(withConnector, byId)).toBe(
      rodCount(withConnector, byId) * 2 + connectorCount(withConnector, byId),
    );
  });

  it('reads the same in the menu as in the count', () => {
    const groups = boltGroups(wall, byId).nuts;
    expect(groups.reduce((n, g) => n + g.places * g.each, 0)).toBe(nutCount(wall, byId));
  });
});

describe('a wall drawn with the კედელი pen', () => {
  const line: SketchPath = { id: 'l', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }], perimeter: 'outer' };
  const mate = { ...wallPartner(line, 20), id: 'm' };

  it('finds its other face from the drawing', () => {
    const found = findWallMate(line, [line, mate]);
    expect(found?.mate.id).toBe('m');
    expect(found?.thickness).toBe(20);
    expect(findWallMate(line, [line])).toBeNull();
  });

  it('turns to the other side of the line and back', () => {
    const [turned, other] = flipWall(line, mate, 20);
    expect(turned.points).toEqual(line.points);
    expect(other.id).toBe('m');
    // The mate is now on the far side: above the first leg instead of below.
    expect(other.points[0].y).toBe(-20);
    expect(mate.points[0].y).toBe(20);
    const [again, back] = flipWall(turned, other, 20);
    expect(again.perimeter).toBe(line.perimeter);
    expect(back.points).toEqual(mate.points);
  });
});

describe('a დგარი', () => {
  const panel: Piece = { id: 'p', materialId: 'panel-90x300', x: 0, y: 0, rot: 0, z: 0 };
  const post = byId.get('post-200')!;

  it('stands square on the outside of the face it is let go beside, head on the face', () => {
    const below = snapPost({ x: 45, y: 30 }, post, [panel], byId, 60, 5)!;
    const b = pieceBounds({ id: '', materialId: post.id, ...below, z: 0 }, post);
    expect(below.rot).toBe(0);
    expect(b.y).toBeCloseTo(planH(byId.get('panel-90x300')!));
    expect(b.h).toBe(100);

    const above = snapPost({ x: 45, y: -30 }, post, [panel], byId, 60, 5)!;
    const a = pieceBounds({ id: '', materialId: post.id, ...above, z: 0 }, post);
    expect(above.rot).toBe(180);
    expect(a.y + a.h).toBeCloseTo(0);
  });

  it('lands loose with no face in reach', () => {
    expect(snapPost({ x: 45, y: 500 }, post, [panel], byId, 60, 5)).toBeNull();
  });
});

describe('visibility on the plan', () => {
  const vis = normalizeObjectVisibility(undefined);

  it('shows panels, walers and the ნიანგი by default and hides the rest', () => {
    expect(isMaterialShown(vis, byId.get('panel-90x300')!)).toBe(true);
    expect(isMaterialShown(vis, byId.get('waler-300')!)).toBe(true);
    expect(isMaterialShown(vis, byId.get('post-100')!)).toBe(false);
    expect(isMaterialShown(vis, { ...byId.get('acc-crane-hook')!, name: 'ნიანგი' })).toBe(true);
  });

  it('lets one material go against its category', () => {
    const one = { ...vis, materials: { 'post-100': true } };
    expect(isMaterialShown(one, byId.get('post-100')!)).toBe(true);
    expect(isMaterialShown(one, byId.get('post-200')!)).toBe(false);
  });
});

describe('a stretch of a line, corner to corner', async () => {
  const { spanAt } = await import('../span');
  const line: SketchPath = { id: 'l', points: [{ x: 0, y: 0 }, { x: 600, y: 0 }] };
  // Hand-placed panels at both ends, the middle left empty.
  const left: Piece = { id: 'a', materialId: 'panel-60x300', x: 0, y: -9, rot: 0, z: 0 };
  const right: Piece = { id: 'b', materialId: 'panel-60x300', x: 540, y: -9, rot: 0, z: 0 };

  it('picks only the empty part between the pieces either side of the click', () => {
    const span = spanAt('l', { x: 300, y: 0 }, [line], [left, right], SEED_MATERIALS)!;
    expect(span.points).toEqual([
      { x: 60, y: 0 },
      { x: 540, y: 0 },
    ]);
    expect(span.length).toBe(480);
  });

  it('picks nothing on a piece, or on a line with nothing on it', () => {
    expect(spanAt('l', { x: 30, y: 0 }, [line], [left, right], SEED_MATERIALS)).toBeNull();
    expect(spanAt('l', { x: 300, y: 0 }, [line], [], SEED_MATERIALS)).toBeNull();
  });
});
