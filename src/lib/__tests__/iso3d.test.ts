import { describe, expect, it } from 'vitest';
import type { Material, Piece } from '../../types';
import {
  boundsCentre,
  canDragOnGround,
  canDragOnHeight,
  contentBounds3,
  DEFAULT_CAMERA,
  dragOnGround,
  dragOnHeight,
  faceNormal,
  faceShade,
  fitZoom,
  isFrontFacing,
  piecePrism,
  project,
  viewDirection,
  type Vec3,
} from '../iso3d';
import { planOutline, shoelace } from '../shapePath';

const material = (over: Partial<Material> = {}): Material => ({
  id: 'panel',
  name: 'პანელი 45*300',
  category: 'panel',
  w: 45,
  h: 300,
  depth: 9,
  shape: 'rect',
  color: '#c9a36a',
  builtin: true,
  stock: {},
  weight: 0,
  article: '',
  supplier: '',
  ...over,
});

const piece = (over: Partial<Piece> = {}): Piece => ({
  id: 'p1',
  materialId: 'panel',
  x: 0,
  y: 0,
  rot: 0,
  ...over,
});

const CAM = { azimuth: Math.PI / 4, elevation: Math.PI / 6 };

describe('project', () => {
  it('puts the origin at the origin', () => {
    const q = project({ x: 0, y: 0, z: 0 }, CAM);
    expect(q.x).toBeCloseTo(0);
    expect(q.y).toBeCloseTo(0);
  });

  it('draws greater height higher up the screen', () => {
    const low = project({ x: 0, y: 0, z: 0 }, CAM);
    const high = project({ x: 0, y: 0, z: 100 }, CAM);
    expect(high.y).toBeLessThan(low.y); // screen y grows downward
  });

  it('keeps the projection linear, so parallel edges stay parallel', () => {
    const a = project({ x: 10, y: 0, z: 0 }, CAM);
    const b = project({ x: 20, y: 0, z: 0 }, CAM);
    const c = project({ x: 30, y: 0, z: 0 }, CAM);
    expect(b.x - a.x).toBeCloseTo(c.x - b.x);
    expect(b.y - a.y).toBeCloseTo(c.y - b.y);
  });

  it('reports points nearer the camera with greater depth', () => {
    const dir = viewDirection(CAM);
    const near = project({ x: dir.x * 100, y: dir.y * 100, z: dir.z * 100 }, CAM);
    const far = project({ x: -dir.x * 100, y: -dir.y * 100, z: -dir.z * 100 }, CAM);
    expect(near.depth).toBeGreaterThan(far.depth);
  });

  it('spins the model around the vertical axis with azimuth', () => {
    const p = { x: 100, y: 0, z: 0 };
    const a = project(p, { azimuth: 0, elevation: 0 });
    const b = project(p, { azimuth: Math.PI / 2, elevation: 0 });
    expect(a.x).not.toBeCloseTo(b.x);
  });

  it('looks straight down at elevation π/2, where height stops shifting things', () => {
    const cam = { azimuth: 0, elevation: Math.PI / 2 };
    const ground = project({ x: 10, y: 20, z: 0 }, cam);
    const raised = project({ x: 10, y: 20, z: 500 }, cam);
    expect(raised.y).toBeCloseTo(ground.y); // plan view: height is invisible
  });

  describe('orientation', () => {
    // Plan y grows downward, so (x, y, z) is left-handed and the textbook
    // camera formula mirrors the model — which looks exactly like viewing the
    // formwork from underneath.

    it('reproduces the 2D plan exactly when looking straight down', () => {
      const cam = { azimuth: 0, elevation: Math.PI / 2 };
      const q = project({ x: 10, y: 20, z: 0 }, cam);
      expect(q.x).toBeCloseTo(10);
      expect(q.y).toBeCloseTo(20);
    });

    it('never mirrors the ground plane, at any camera angle', () => {
      // A triangle wound one way in plan must stay wound that way on screen.
      const planCross = (a: { x: number; y: number }, b: typeof a, c: typeof a) =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const source = [
        { x: 0, y: 0, z: 0 },
        { x: 100, y: 0, z: 0 },
        { x: 0, y: 100, z: 0 },
      ];
      const before = planCross(source[0], source[1], source[2]);

      for (const azimuth of [-2.4, -0.9, 0, 0.7, 3]) {
        for (const elevation of [0.05, 0.48, 1.2, Math.PI / 2]) {
          const [a, b, c] = source.map((p) => project(p, { azimuth, elevation }));
          expect(Math.sign(planCross(a, b, c))).toBe(Math.sign(before));
        }
      }
    });

    it('keeps the eye above the ground for every usable elevation', () => {
      for (const elevation of [0.05, 0.48, 1.2, Math.PI / 2]) {
        expect(viewDirection({ azimuth: 1.1, elevation }).z).toBeGreaterThan(0);
      }
    });

    it('puts the bottom of the plan nearest the camera at azimuth 0', () => {
      const cam = { azimuth: 0, elevation: 0.5 };
      const front = project({ x: 0, y: 100, z: 0 }, cam);
      const back = project({ x: 0, y: -100, z: 0 }, cam);
      expect(front.depth).toBeGreaterThan(back.depth);
    });
  });
});

const corner = (over: Partial<Material> = {}): Material =>
  material({ id: 'corner', name: 'გარე კუთხე 300', category: 'corner', w: 24, h: 300, depth: 24, shape: 'L', ...over });

/** Ray casting — enough to say whether a probe point is inside the outline. */
function pointInPolygon(x: number, y: number, poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe('piecePrism', () => {
  it('extrudes the plan footprint to the material height', () => {
    const { vertices } = piecePrism(piece(), material());
    expect(vertices).toHaveLength(8); // a rectangle: 4 base + 4 top
    const zs = [...new Set(vertices.map((c) => c.z))].sort((a, b) => a - b);
    expect(zs).toEqual([0, 300]); // ground to full height
  });

  it('uses width × depth on the ground, not width × height', () => {
    const { vertices } = piecePrism(piece(), material());
    const xs = vertices.map((c) => c.x);
    const ys = vertices.map((c) => c.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(45); // w
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(9); // depth
  });

  it('rotates the footprint about the piece centre', () => {
    const { vertices } = piecePrism(piece({ rot: 90 }), material());
    const xs = vertices.map((c) => c.x);
    const ys = vertices.map((c) => c.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(45);
    // centre is rotation-invariant
    expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(22.5);
  });

  it('honours the placed position', () => {
    const { vertices } = piecePrism(piece({ x: 500, y: 200 }), material());
    expect(Math.min(...vertices.map((c) => c.x))).toBeCloseTo(500);
    expect(Math.min(...vertices.map((c) => c.y))).toBeCloseTo(200);
  });

  it('starts the extrusion at the piece elevation', () => {
    const { vertices } = piecePrism(piece({ z: 150 }), material());
    const zs = [...new Set(vertices.map((c) => c.z))].sort((a, b) => a - b);
    expect(zs).toEqual([150, 450]);
  });

  it('relies on every outline winding the same way', () => {
    // The extruder derives "up" and "outward" from the winding alone, so a
    // shape whose outline came back reversed would render inside out.
    for (const m of [material(), corner(), material({ shape: 'line', w: 100, depth: 12 })]) {
      expect(shoelace(planOutline(m))).toBeGreaterThan(0);
    }
  });

  describe('L corners', () => {
    // An L-corner drawn as its bounding box shows up in 3D as a plain square
    // and fills in the notch the panels tuck into.
    it('extrudes the actual L outline, not its bounding box', () => {
      const { vertices, faces } = piecePrism(piece({ materialId: 'corner' }), corner());
      expect(vertices).toHaveLength(12); // 6-sided outline, base + top
      expect(faces).toHaveLength(8); // top, bottom and one wall per edge
    });

    it('leaves the notch empty', () => {
      // the inner quadrant of a 24×24 corner must not be covered
      const { vertices } = piecePrism(piece({ materialId: 'corner' }), corner());
      const inNotch = vertices.some((v) => v.x > 23.9 && v.y < 0.1);
      expect(inNotch).toBe(false);
    });

    it('still spans the full footprint overall', () => {
      const { vertices } = piecePrism(piece({ materialId: 'corner' }), corner());
      const xs = vertices.map((v) => v.x);
      const ys = vertices.map((v) => v.y);
      expect(Math.min(...xs)).toBeCloseTo(0);
      expect(Math.max(...xs)).toBeCloseTo(24);
      expect(Math.min(...ys)).toBeCloseTo(0);
      expect(Math.max(...ys)).toBeCloseTo(24);
    });

    it('winds every wall outwards, including the two inside the notch', () => {
      // A mis-wound wall is culled from outside and drawn from inside, which
      // turns the notch into a hole you can see straight through. A centroid
      // test is not enough here: an L is concave, and its own centroid can sit
      // outside the material.
      const m = corner();
      const outline = planOutline(m);
      const { vertices, faces } = piecePrism(piece({ materialId: 'corner' }), m);

      expect(faceNormal(vertices, faces[0]).z).toBeLessThan(0); // bottom, -Z
      expect(faceNormal(vertices, faces[1]).z).toBeGreaterThan(0); // top, +Z

      const n = outline.length;
      for (let i = 0; i < n; i++) {
        const face = faces[2 + i];
        const normal = faceNormal(vertices, face);
        expect(Math.abs(normal.z)).toBeCloseTo(0); // walls stand vertical

        // Stepping off the wall along its normal must leave the material, and
        // stepping the other way must stay inside it.
        const [ax, ay] = outline[i];
        const [bx, by] = outline[(i + 1) % n];
        const mid = { x: (ax + bx) / 2, y: (ay + by) / 2 };
        const len = Math.hypot(normal.x, normal.y);
        const step = 0.01;
        const ux = (normal.x / len) * step;
        const uy = (normal.y / len) * step;

        expect(pointInPolygon(mid.x + ux, mid.y + uy, outline)).toBe(false);
        expect(pointInPolygon(mid.x - ux, mid.y - uy, outline)).toBe(true);
      }
    });
  });
});

describe('face culling', () => {
  const { vertices: corners, faces } = piecePrism(piece(), material());

  it('shows exactly three faces of a box from a corner viewpoint', () => {
    const visible = faces.filter((f) => isFrontFacing(corners, f, CAM));
    expect(visible).toHaveLength(3);
  });

  it('shows the top but not the bottom when looking down', () => {
    const down = { azimuth: 0.7, elevation: Math.PI / 3 };
    expect(isFrontFacing(corners, faces[1], down)).toBe(true); // top
    expect(isFrontFacing(corners, faces[0], down)).toBe(false); // bottom
  });

  it('never shows both the top and the bottom at once', () => {
    for (const elevation of [0.05, 0.5, 1.2]) {
      const cam = { azimuth: 0.3, elevation };
      expect(isFrontFacing(corners, faces[0], cam) && isFrontFacing(corners, faces[1], cam)).toBe(
        false,
      );
    }
  });
});

describe('faceShade', () => {
  const { vertices: corners, faces } = piecePrism(piece(), material());

  it('lights the top more than the sides', () => {
    const top = faceShade(corners, faces[1]);
    const side = faceShade(corners, faces[2]);
    expect(top).toBeGreaterThan(side);
  });

  it('stays within a usable brightness range', () => {
    for (const f of faces) {
      const s = faceShade(corners, f);
      expect(s).toBeGreaterThanOrEqual(0.45);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe('contentBounds3', () => {
  const byId = new Map([['panel', material()]]);

  it('is null with nothing placed', () => {
    expect(contentBounds3([], byId)).toBeNull();
  });

  it('spans plan extent and the tallest piece', () => {
    const b = contentBounds3([piece(), piece({ id: 'p2', x: 100 })], byId)!;
    expect(b.min.x).toBeCloseTo(0);
    expect(b.max.x).toBeCloseTo(145);
    expect(b.max.z).toBeCloseTo(300);
  });

  it('ignores pieces whose material is gone', () => {
    const b = contentBounds3([piece(), piece({ id: 'p2', materialId: 'ghost' })], byId)!;
    expect(b.max.x).toBeCloseTo(45);
  });

  it('centres between the extremes', () => {
    const b = contentBounds3([piece()], byId)!;
    const c = boundsCentre(b);
    expect(c.x).toBeCloseTo(22.5);
    expect(c.z).toBeCloseTo(150);
  });
});

describe('fitZoom', () => {
  const byId = new Map([['panel', material()]]);

  it('is null with nothing to frame', () => {
    expect(fitZoom([], byId, CAM, 800, 600)).toBeNull();
  });

  it('fits the model inside the viewport', () => {
    const fit = fitZoom([piece()], byId, CAM, 800, 600)!;
    let maxX = 0;
    let maxY = 0;
    for (const c of piecePrism(piece(), material()).vertices) {
      const q = project(
        { x: c.x - fit.centre.x, y: c.y - fit.centre.y, z: c.z - fit.centre.z },
        CAM,
      );
      maxX = Math.max(maxX, Math.abs(q.x * fit.zoom));
      maxY = Math.max(maxY, Math.abs(q.y * fit.zoom));
    }
    expect(maxX * 2).toBeLessThanOrEqual(800);
    expect(maxY * 2).toBeLessThanOrEqual(600);
  });

  it('zooms out for a bigger model', () => {
    const small = fitZoom([piece()], byId, CAM, 800, 600)!;
    const large = fitZoom(
      [piece(), piece({ id: 'p2', x: 2000 })],
      byId,
      CAM,
      800,
      600,
    )!;
    expect(large.zoom).toBeLessThan(small.zoom);
  });
});

/**
 * The drag inverses are checked against `project` itself rather than against a
 * hand-computed number. A test that restates the formula would pass just as
 * happily if both copies were wrong the same way; a round trip through the
 * real projection cannot.
 */
describe('drag inverses', () => {
  const CAMERAS = [
    { name: 'default', cam: DEFAULT_CAMERA },
    { name: 'azimuth 0', cam: { azimuth: 0, elevation: 0.5 } },
    { name: 'negative azimuth', cam: { azimuth: -2.2, elevation: 0.9 } },
    { name: 'steep', cam: { azimuth: 1.1, elevation: 1.3 } },
  ];

  /** Screen delta the renderer would produce for a world delta. */
  const toScreen = (d: Vec3, cam: typeof DEFAULT_CAMERA, zoom: number) => {
    const a = project({ x: 0, y: 0, z: 0 }, cam);
    const b = project(d, cam);
    return { dx: (b.x - a.x) * zoom, dy: (b.y - a.y) * zoom };
  };

  describe.each(CAMERAS)('$name', ({ cam }) => {
    it('recovers a ground movement from the pixels it would produce', () => {
      const zoom = 2.5;
      for (const move of [
        { x: 30, y: 0, z: 0 },
        { x: 0, y: -45, z: 0 },
        { x: 17.5, y: 62.5, z: 0 },
      ]) {
        const { dx, dy } = toScreen(move, cam, zoom);
        const back = dragOnGround(dx, dy, cam, zoom)!;
        expect(back.dx).toBeCloseTo(move.x, 6);
        expect(back.dy).toBeCloseTo(move.y, 6);
      }
    });

    it('recovers a height change from the pixels it would produce', () => {
      const zoom = 1.8;
      for (const dz of [50, -125, 7.25]) {
        const { dy } = toScreen({ x: 0, y: 0, z: dz }, cam, zoom);
        expect(dragOnHeight(dy, cam, zoom)!).toBeCloseTo(dz, 6);
      }
    });
  });

  it('moves a piece up when the pointer is dragged up the screen', () => {
    // Screen y grows downward, so a negative dy is an upward drag.
    expect(dragOnHeight(-40, DEFAULT_CAMERA, 1)!).toBeGreaterThan(0);
  });

  it('scales with zoom: the same pixels mean less world when zoomed in', () => {
    const far = dragOnHeight(-40, DEFAULT_CAMERA, 0.5)!;
    const near = dragOnHeight(-40, DEFAULT_CAMERA, 4)!;
    expect(Math.abs(near)).toBeLessThan(Math.abs(far));
  });

  /**
   * The "გეგმა" button sets exactly this camera. cos(π/2) is 6e-17 rather than
   * 0, so an unguarded divide returns ~1e16 instead of throwing — the piece
   * would silently leave the drawing.
   */
  it('refuses to change height from straight overhead', () => {
    const overhead = { azimuth: 0, elevation: Math.PI / 2 };
    expect(canDragOnHeight(overhead)).toBe(false);
    expect(dragOnHeight(-40, overhead, 1)).toBeNull();
    // Ground movement is exactly what that view is good for.
    expect(canDragOnGround(overhead)).toBe(true);
    expect(dragOnGround(10, 10, overhead, 1)).not.toBeNull();
  });

  it('refuses to move along the ground from eye level', () => {
    // The renderer clamps elevation to 0.05, so this is reachable.
    const eyeLevel = { azimuth: 0.4, elevation: 0.05 };
    expect(canDragOnGround(eyeLevel)).toBe(false);
    expect(dragOnGround(10, 10, eyeLevel, 1)).toBeNull();
    expect(dragOnHeight(-40, eyeLevel, 1)).not.toBeNull();
  });

  it('always allows at least one of the two, at every reachable angle', () => {
    for (let e = 0.05; e <= Math.PI / 2 + 1e-9; e += 0.01) {
      const cam = { azimuth: 0.3, elevation: e };
      expect(canDragOnGround(cam) || canDragOnHeight(cam)).toBe(true);
    }
  });

  it('treats a nonsense zoom as undraggable rather than dividing by it', () => {
    expect(dragOnGround(5, 5, DEFAULT_CAMERA, 0)).toBeNull();
    expect(dragOnHeight(5, DEFAULT_CAMERA, 0)).toBeNull();
  });
});
