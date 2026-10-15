import type { Material, Piece, SketchPath } from '../types';
import { uid } from './ids';
import { pieceBounds, planH, planW, rotatedExtent } from './geometry';
import { coverExact, optionsAt, panelDepthFor, panelHeights, placeAt, type PanelOption } from './formwork';
import { isOrthogonal, type Point } from './sketch';
import {
  MAX_WALL_CM,
  OUTER_CORNER_GAP,
  cornerRot,
  cornersOnly,
  innerCorner,
  legDir,
  leftNormal,
  sidesFromNeighbours,
  turnSign,
  type Opening,
} from './sketchFill';
import { byWidth, courseStacks, fillerCombos, panelCombos } from './fillOptions';

/**
 * The layout solver - a whole selection of drawn lines to whole-layout fill
 * variants, the way the architect fills a job by hand. `docs/LAYOUT-SOLVER.md`
 * is the plan this follows, and the rule ids below (A1..A5) point into it; the
 * R/P ids point into `docs/FILL-RULES.md` as before.
 *
 * What it does that `planSketchFillAll` does not:
 *
 * - An outside corner is LAPPED (A1): one face runs past the corner far enough
 *   to cover the end of the other, which butts under it. The old fill left the
 *   corner open 20 cm for the site to close.
 * - A face may run PAST the end of its line into air (A2), at a lapped corner
 *   always and at the free end of a line when the user allows it. The line is
 *   then a minimum, not an exact length.
 * - The two faces of a wall are solved TOGETHER (A3): every panel on one face
 *   has its twin opposite it, and the other face closes its own ends with end
 *   pieces. Fillers are placed where they let the other face come out in whole
 *   panels (A4), and a ჩ5 between two panels - which needs a ნიანგი - costs
 *   heavily (A5).
 * - Pieces already standing on a line are kept and built around, or replaced.
 *
 * Pure: lines, catalog and placed pieces in; ranked variants out, each with the
 * pieces to add and the ids to remove. Nothing is placed here.
 */

// ── Filters ─────────────────────────────────────────────────────────────────

/** Which free ends of a line a face may run past - in the line's drawing direction. */
export type OverhangEnds = 'none' | 'start' | 'end' | 'both';

export interface LayoutFilters {
  /** free line ends a face may run past (A2); lapped corners always may */
  overhangEnds: OverhangEnds;
  /** how far past a line end, or past what a lap needs, a face may reach, cm */
  maxOverhang: number;
  /** outside corners lapped (A1), or left open 20 cm the old way */
  outerCorners: 'lap' | 'open';
  /** panel widths to go easy on - used only when it saves something */
  spareWidths: number[];
  /** panel widths not to use at all */
  excludeWidths: number[];
  /** ჩაკერება per face, 0 to 3 (R3) */
  maxFillers: number;
  /** sink variants that need more than is free */
  useStock: boolean;
  /** keep what already stands on the lines and build around it */
  keepPlaced: boolean;
  /** prefer stacked shorter courses to 300-high panels (P3) */
  fewer300: boolean;
}

export const DEFAULT_LAYOUT_FILTERS: LayoutFilters = {
  overhangEnds: 'none',
  maxOverhang: 45,
  outerCorners: 'lap',
  spareWidths: [],
  excludeWidths: [],
  maxFillers: 2,
  useStock: true,
  keepPlaced: true,
  fewer300: false,
};

/** Anything saved - junk included - as usable filters. */
export function normalizeLayoutFilters(value: unknown): LayoutFilters {
  const saved = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const d = DEFAULT_LAYOUT_FILTERS;
  const widths = (v: unknown) =>
    Array.isArray(v) ? v.filter((w): w is number => typeof w === 'number' && w > 0) : [];
  const num = Number(saved.maxOverhang);
  const fillers = Number(saved.maxFillers);
  return {
    overhangEnds: (['none', 'start', 'end', 'both'] as const).includes(saved.overhangEnds as OverhangEnds)
      ? (saved.overhangEnds as OverhangEnds)
      : d.overhangEnds,
    maxOverhang: Number.isFinite(num) && num >= 0 && num <= 300 ? num : d.maxOverhang,
    outerCorners: saved.outerCorners === 'open' ? 'open' : 'lap',
    spareWidths: widths(saved.spareWidths),
    excludeWidths: widths(saved.excludeWidths),
    maxFillers: Number.isFinite(fillers) ? Math.max(0, Math.min(3, Math.round(fillers))) : d.maxFillers,
    useStock: typeof saved.useStock === 'boolean' ? saved.useStock : d.useStock,
    keepPlaced: typeof saved.keepPlaced === 'boolean' ? saved.keepPlaced : d.keepPlaced,
    fewer300: typeof saved.fewer300 === 'boolean' ? saved.fewer300 : d.fewer300,
  };
}

// ── Request and result ──────────────────────────────────────────────────────

export interface LayoutRequest {
  /** the lines to fill - one wall's two faces, a whole layout, or one line */
  paths: SketchPath[];
  /** pour height, cm */
  height: number;
  /** stand inner corner profiles in inside corners */
  includeCorners: boolean;
  /** course heights bottom to top, in place of the fewest-courses stack */
  stack?: number[];
  materials: Material[];
  /** what already stands on the drawing */
  pieces?: Piece[];
  filters?: Partial<LayoutFilters>;
  /** materialId → how many are free to take; see `freeStock` */
  free?: Map<string, number>;
  /** how many variants to return */
  limit?: number;
}

/** One face of one wall in a variant, for showing it. */
export interface FaceSummary {
  /** widths in laying order along the axis, fillers as `ჩ5` */
  parts: string[];
  /** cm the face reaches past its line or past what a lap needs */
  overhang: number;
}

export interface WallSummary {
  key: string;
  /** cm between the face's line ends, the longer face */
  length: number;
  faces: FaceSummary[];
  /** where to point at it, world cm */
  x: number;
  y: number;
}

export interface LayoutVariant {
  key: string;
  /** which way the outside corners are lapped, as a rank - 0 is the best choice */
  family: number;
  stack: number[];
  /** pieces to add, every course */
  add: Piece[];
  /** pieces standing on the lines that applying this takes away (keep off) */
  remove: string[];
  /** counts across every course */
  panels: number;
  fillers: number;
  corners: number;
  /** ჩ5 between two panels - each needs a ნიანგი (A5) */
  nianguri: number;
  /** cm of face past its lines, beyond what the laps need, one course */
  overhang: number;
  /** panels without their twin opposite (A3), one course */
  unmatched: number;
  /** face left bare, cm, one course */
  openCm: number;
  total: Record<string, number>;
  feasible: boolean;
  score: number;
  reasons: string[];
  walls: WallSummary[];
}

export interface LayoutResult {
  variants: LayoutVariant[];
  warnings: string[];
  openings: Opening[];
}

// ── Lines into chains ───────────────────────────────────────────────────────

const EPS = 0.01;
/** endpoints closer than this are the same point - a line drawn in two strokes */
const JOIN_TOL = 0.5;
/** a piece is standing on a face when it is this close to flush */
const FLUSH_TOL = 0.5;

const same = (a: Point, b: Point) => Math.abs(a.x - b.x) <= JOIN_TOL && Math.abs(a.y - b.y) <= JOIN_TOL;

export interface Chain {
  path: SketchPath;
  /** the drawn lines it was joined from */
  sources: string[];
}

/**
 * Lines that meet end to end, as one line.
 *
 * People draw a face in more than one stroke - the architect's outer line is a
 * straight top and an open run round the other three sides - and read one at a
 * time, the two strokes are two lines with two free ends where they meet, so
 * neither end can be a corner. Joined, the face is the closed rectangle it is.
 *
 * Only where exactly two ends meet: three lines meeting at a point is a
 * junction of walls, not one face, and is left alone.
 */
export function joinLines(paths: SketchPath[]): Chain[] {
  const chains: Array<{ points: Point[]; closed: boolean; base: SketchPath; sources: string[] }> = paths.map(
    (p) => ({ points: p.points.map((q) => ({ ...q })), closed: !!p.closed && p.points.length > 2, base: p, sources: [p.id] }),
  );
  const ends = (c: (typeof chains)[number]) => [c.points[0], c.points[c.points.length - 1]];
  const degree = (pt: Point) =>
    chains.filter((c) => !c.closed).reduce((n, c) => n + ends(c).filter((e) => same(e, pt)).length, 0);

  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < chains.length; i++) {
      const a = chains[i];
      if (a.closed || a.points.length < 2) continue;
      for (let j = i + 1; j < chains.length; j++) {
        const b = chains[j];
        if (b.closed || b.points.length < 2) continue;
        const [as, ae] = ends(a);
        const [bs, be] = ends(b);
        let points: Point[] | null = null;
        if (same(ae, bs) && degree(ae) === 2) points = [...a.points, ...b.points.slice(1)];
        else if (same(ae, be) && degree(ae) === 2) points = [...a.points, ...[...b.points].reverse().slice(1)];
        else if (same(as, be) && degree(as) === 2) points = [...b.points, ...a.points.slice(1)];
        else if (same(as, bs) && degree(as) === 2) points = [...[...a.points].reverse(), ...b.points.slice(1)];
        if (!points) continue;
        let closed = false;
        if (points.length > 3 && same(points[0], points[points.length - 1])) {
          points.pop();
          closed = true;
        }
        chains[i] = { points, closed, base: a.base, sources: [...a.sources, ...b.sources] };
        chains.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return chains.map((c) => ({
    path: {
      ...c.base,
      id: c.sources.join('+'),
      points: c.points,
      closed: c.closed || undefined,
    },
    sources: c.sources,
  }));
}

// ── Faces ───────────────────────────────────────────────────────────────────

/**
 * Where one end of a face stops.
 *
 * `fixed` - exactly here: a corner profile, the butt of a lap, a line end that
 * may not be crossed, a piece standing there. `next` says what the end touches,
 * for A5: a ჩ5 against a panel there needs a ნიანგი, against anything else not.
 *
 * `reach` - anywhere from `near` out to `far`: the run-through side of a lap,
 * or a free line end that may be crossed. `near` is the least it must reach.
 *
 * `lap` - an outside corner not yet decided; see `resolve`.
 */
type EndSpec =
  | { t: 'fixed'; p: number; next: 'profile' | 'line' | 'end' | 'piece' }
  | { t: 'reach'; near: number; far: number }
  | { t: 'lap'; corner: number; v: number; out: 1 | -1 };

type Resolved = Exclude<EndSpec, { t: 'lap' }>;

interface Face {
  key: string;
  across: boolean;
  /** the face line's coordinate on the other axis */
  at: number;
  outward: 1 | -1;
  /** the drawn leg's extent along its axis */
  lineLo: number;
  lineHi: number;
  lo: EndSpec;
  hi: EndSpec;
}

/** A piece standing on a face, kept as it is (or a twin to stand opposite one). */
interface Lock {
  from: number;
  to: number;
  materialId: string;
  /** course elevations it already stands at; empty for a twin still to place */
  zs: number[];
}

/** An outside corner to lap: which face runs through is the choice. */
interface Corner {
  id: number;
  /** the two faces' indexes and which of their ends meets here */
  a: { face: number; end: 'lo' | 'hi' };
  b: { face: number; end: 'lo' | 'hi' };
}

interface Profile {
  piece: Omit<Piece, 'id' | 'z'>;
  material: Material;
}

interface Geometry {
  faces: Face[];
  corners: Corner[];
  profiles: Profile[];
  openings: Opening[];
  warnings: string[];
}

/** Every face of every chain at one course height, with its ends worked out. */
function readFaces(
  chains: Chain[],
  sides: Array<1 | -1>,
  opts: {
    depth: number;
    profile: { material: Material; reach: number } | null;
    filters: LayoutFilters;
  },
): Geometry {
  const faces: Face[] = [];
  const corners: Corner[] = [];
  const profiles: Profile[] = [];
  const openings: Opening[] = [];
  const warnings: string[] = [];
  const { depth, profile, filters } = opts;

  chains.forEach((chain, c) => {
    const run = cornersOnly(chain.path);
    const pts = run.points;
    const n = pts.length;
    const closed = !!run.closed && n > 2;
    const legCount = closed ? n : n - 1;
    if (legCount < 1 || !isOrthogonal(run)) {
      warnings.push('დახრილი ხაზის შევსება შეუძლებელია - კატალოგში მხოლოდ 90° კუთხეებია.');
      return;
    }
    const side = sides[c];
    const dirs: Point[] = [];
    for (let j = 0; j < legCount; j++) dirs.push(legDir(pts[j], pts[(j + 1) % n]));
    const turnCount = closed ? legCount : legCount - 1;
    const kind = (j: number): 'straight' | 'inside' | 'outside' => {
      const t = turnSign(dirs[j], dirs[(j + 1) % legCount]);
      return t === 0 ? 'straight' : side * t > 0 ? 'outside' : 'inside';
    };
    const allowStart = filters.overhangEnds === 'both' || filters.overhangEnds === 'start';
    const allowEnd = filters.overhangEnds === 'both' || filters.overhangEnds === 'end';

    const first = faces.length;
    const cornerIds = new Map<number, number>();
    const lapCorner = (j: number) => {
      if (!cornerIds.has(j)) {
        cornerIds.set(j, corners.length);
        corners.push({
          id: corners.length,
          a: { face: first + j, end: 'hi' },
          b: { face: first + ((j + 1) % legCount), end: 'lo' },
        });
      }
      return cornerIds.get(j)!;
    };

    // Ends first, without the profiles' fit, then the profiles that fit.
    const legEnds: Array<{ start: EndSpec; end: EndSpec; startPos: number; endPos: number; forward: 1 | -1 }> = [];
    for (let j = 0; j < legCount; j++) {
      const dir = dirs[j];
      const across = dir.x !== 0;
      const a = pts[j];
      const b = pts[(j + 1) % n];
      const startPos = across ? a.x : a.y;
      const endPos = across ? b.x : b.y;
      const forward: 1 | -1 = endPos >= startPos ? 1 : -1;
      const sc = closed ? (j - 1 + legCount) % legCount : j - 1;
      const ec = closed ? j : j < legCount - 1 ? j : -1;

      const spec = (corner: number, atEnd: boolean): EndSpec => {
        const pos = atEnd ? endPos : startPos;
        const out = (atEnd ? forward : -forward) as 1 | -1;
        if (corner < 0) {
          const allowed = atEnd ? allowEnd : allowStart;
          return allowed && filters.maxOverhang > 0
            ? { t: 'reach', near: pos, far: pos + out * filters.maxOverhang }
            : { t: 'fixed', p: pos, next: 'line' };
        }
        const k = kind(corner);
        if (k === 'straight') return { t: 'fixed', p: pos, next: 'piece' };
        if (k === 'inside') {
          if (profile) return { t: 'fixed', p: pos - out * profile.reach, next: 'profile' };
          // No profile: exactly one of the two runs gives way by a panel
          // thickness, the other holds the line - see `cornerExtend`.
          return { t: 'fixed', p: atEnd ? pos - out * depth : pos, next: atEnd ? 'end' : 'piece' };
        }
        if (filters.outerCorners === 'open') {
          return { t: 'fixed', p: pos - out * OUTER_CORNER_GAP, next: 'end' };
        }
        return { t: 'lap', corner: lapCorner(corner), v: pos, out };
      };
      legEnds.push({ start: spec(sc, false), end: spec(ec, true), startPos, endPos, forward });
    }

    // Least a face can be: a lap counted at its butt.
    const bound = (e: EndSpec) => (e.t === 'fixed' ? e.p : e.t === 'reach' ? e.near : e.v);
    const fits = (j: number) => {
      const e = legEnds[j];
      return (bound(e.end) - bound(e.start)) * e.forward > EPS;
    };

    for (let j = 0; j < legCount; j++) {
      const e = legEnds[j];
      const across = dirs[j].x !== 0;
      const at = across ? pts[j].y : pts[j].x;
      const out = leftNormal(dirs[j]);
      const outward: 1 | -1 = (across ? side * out.y : side * out.x) > 0 ? 1 : -1;
      const [lo, hi] = e.forward > 0 ? [e.start, e.end] : [e.end, e.start];
      faces.push({
        key: `${chain.path.id}:${j}`,
        across,
        at,
        outward,
        lineLo: Math.min(e.startPos, e.endPos),
        lineHi: Math.max(e.startPos, e.endPos),
        lo,
        hi,
      });
    }

    // Inside corner profiles, where both legs beside them still have a face.
    for (let j = 0; j < turnCount; j++) {
      if (kind(j) !== 'inside' || !profile) continue;
      if (!fits(j) || !fits((j + 1) % legCount)) {
        warnings.push('მონაკვეთი კუთხეებისთვის ძალიან მოკლეა - პანელი აღარ ეტევა.');
        continue;
      }
      const a = leftNormal(dirs[j]);
      const b = leftNormal(dirs[(j + 1) % legCount]);
      const diag: Point = { x: side * (a.x + b.x), y: side * (a.y + b.y) };
      const cw = planW(profile.material);
      const ch = planH(profile.material);
      const v = pts[(j + 1) % n];
      const rot = (cornerRot(diag) + 180) % 360;
      const box = rotatedExtent(cw, ch, rot);
      const { x, y } = placeAt(diag.x > 0 ? v.x : v.x - box.w, diag.y > 0 ? v.y : v.y - box.h, cw, ch, rot);
      profiles.push({ piece: { materialId: profile.material.id, x, y, rot }, material: profile.material });
    }

    // Faces their corners have eaten are reported, never built.
    for (let j = legCount - 1; j >= 0; j--) {
      if (fits(j)) continue;
      const f = faces[first + j];
      const mid = (f.lineLo + f.lineHi) / 2;
      openings.push({
        x: f.across ? mid : f.at,
        y: f.across ? f.at : mid,
        cm: Math.round((f.lineHi - f.lineLo) * 10) / 10,
        kind: 'short',
      });
      warnings.push(`${Math.round(f.lineHi - f.lineLo)} სმ მონაკვეთი კუთხეებისთვის ძალიან მოკლეა - პანელი აღარ ეტევა.`);
      f.lo = { t: 'fixed', p: 0, next: 'end' };
      f.hi = { t: 'fixed', p: -1, next: 'end' };
    }

    // Open corners the old way are holes on purpose, and said so.
    if (filters.outerCorners === 'open') {
      for (let j = 0; j < turnCount; j++) {
        if (kind(j) !== 'outside') continue;
        const v = pts[(j + 1) % n];
        openings.push({ x: v.x, y: v.y, cm: 2 * OUTER_CORNER_GAP, kind: 'corner' });
      }
    }
  });

  return { faces, corners, profiles, openings, warnings };
}

const isDead = (f: Face) => f.lo.t === 'fixed' && f.hi.t === 'fixed' && f.hi.p < f.lo.p;

/**
 * Two faces of one wall: parallel, looking away from each other with the pour
 * between them, no further apart than a wall is thick, alongside each other
 * for most of the shorter one. Nearest first - the true partner is the near
 * face, and routinely the shorter one, because that is what a corner does.
 */
function pairFaces(faces: Face[]): Array<[number, number]> {
  const taken = new Set<number>();
  const pairs: Array<[number, number]> = [];
  const order = faces.map((_, i) => i).sort((p, q) => faces[q].lineHi - faces[q].lineLo - (faces[p].lineHi - faces[p].lineLo));
  for (const i of order) {
    if (taken.has(i) || isDead(faces[i])) continue;
    const a = faces[i];
    let best = -1;
    let bestGap = Infinity;
    faces.forEach((b, j) => {
      if (j === i || taken.has(j) || isDead(b) || b.across !== a.across) return;
      const near = a.at <= b.at ? a : b;
      const far = a.at <= b.at ? b : a;
      if (near.outward !== -1 || far.outward !== 1) return;
      const thickness = far.at - near.at;
      if (thickness <= EPS || thickness > MAX_WALL_CM) return;
      const overlap = Math.min(a.lineHi, b.lineHi) - Math.max(a.lineLo, b.lineLo);
      const shorter = Math.min(a.lineHi - a.lineLo, b.lineHi - b.lineLo);
      if (overlap <= EPS || overlap < 0.5 * shorter) return;
      if (thickness < bestGap) {
        bestGap = thickness;
        best = j;
      }
    });
    if (best >= 0) {
      taken.add(i);
      taken.add(best);
      pairs.push([i, best]);
    }
  }
  return pairs;
}

/**
 * A leg that closes the END of a pour rather than facing it: across a matched
 * wall and wholly inside the band of concrete. Left open, as before.
 */
function closesAnEnd(face: Face, faces: Face[], pairs: Array<[number, number]>): boolean {
  return pairs.some(([i, j]) => {
    const a = faces[i];
    const b = faces[j];
    if (a.across === face.across) return false;
    const near = Math.min(a.at, b.at);
    const far = Math.max(a.at, b.at);
    return face.lineLo >= near - EPS && face.lineHi <= far + EPS;
  });
}

/** What stands flush on a face, along it, and how far. */
function standing(face: Face, depthWindow: number, piece: Piece, m: Material) {
  const b = pieceBounds(piece, m);
  const near = face.across ? b.y : b.x;
  const far = face.across ? b.y + b.h : b.x + b.w;
  const flush =
    face.outward > 0
      ? Math.abs(near - face.at) <= FLUSH_TOL && far > face.at + FLUSH_TOL
      : Math.abs(far - face.at) <= FLUSH_TOL && near < face.at - FLUSH_TOL;
  if (!flush) return null;
  const from = face.across ? b.x : b.y;
  const to = face.across ? b.x + b.w : b.y + b.h;
  if (Math.min(to, face.lineHi + depthWindow) - Math.max(from, face.lineLo - depthWindow) <= FLUSH_TOL) return null;
  return { from, to };
}

// ── One wall ────────────────────────────────────────────────────────────────

/** whether `face` is the one that runs through at a lapped corner */
type Passes = (corner: number, face: number) => boolean;

interface Laid {
  opt: PanelOption;
  from: number;
  filler: boolean;
}

/** A stretch of face solved as one: a face, or the part of one between kept pieces. */
interface Segment {
  face: number;
  lo: EndSpec;
  hi: EndSpec;
}

interface FaceFill {
  segment: Segment;
  laid: Laid[];
  lo: Resolved;
  hi: Resolved;
}

interface WallFill {
  key: string;
  faces: FaceFill[];
  cost: number;
  pieces: number;
  fillers: number;
  nianguri: number;
  overhang: number;
  unmatched: number;
}

interface Catalog {
  panels: PanelOption[];
  fillers: PanelOption[];
  widest: number;
  /** step every exact length comes in - gcd of every width */
  step: number;
  /** step panels alone come in */
  panelStep: number;
  depth: number;
  maxFillers: number;
  maxOverhang: number;
  spare: Set<number>;
}

/** Score weights, lowest wins - see the table in docs/LAYOUT-SOLVER.md. */
const WEIGHT = {
  piece: 1000,
  // A filler is a closure, not a face (R3), and needs clamping either side:
  // given a choice of the same piece count, panels alone win.
  filler: 500,
  niangi: 3000, // A5: a ჩ5 between two panels
  // A4: a filler anywhere but against an inside corner profile
  looseFiller: 2500,
  // A6: the thinner wall's face run through a corner
  lapAgainst: 1500,
  narrowByFiller: 300, // A7
  groupBreak: 20, // P1
  inversion: 1, // R2, finest
  extraFiller: 700, // R4
  adjacentFillers: 3000, // R4
  // A2: cheap enough that a panel sticking out beats a filler, dear enough
  // that it never sticks out for nothing.
  overhangCm: 4,
  unmatched: 5000, // A3 - a panel with nothing opposite has no tie rod
  distinct: 200, // P5
  nonWidest: 60, // R2
  narrow: 40, // P4
  spare: 400, // filter
  widthStep: 1,
  infeasible: 1e9,
};

/** how far past the fewest pieces a reference face is still worth trying */
const PIECE_WINDOW = 2;
/** compositions tried per length */
const COMPOSITION_CAP = 40;
/** answers kept per wall per corner choice */
const KEEP_PER_WALL = 10;

function gcd(a: number, b: number): number {
  let x = Math.round(Math.abs(a));
  let y = Math.round(Math.abs(b));
  while (y) [x, y] = [y, x % y];
  return x;
}

function resolve(end: EndSpec, face: number, passes: Passes, cat: Catalog): Resolved {
  if (end.t !== 'lap') return end;
  // Runs through: past the corner by the other face's panel thickness, and
  // up to the overhang allowance beyond it. Butts: stops at the corner.
  return passes(end.corner, face)
    ? { t: 'reach', near: end.v + end.out * cat.depth, far: end.v + end.out * (cat.depth + cat.maxOverhang) }
    : { t: 'fixed', p: end.v, next: 'end' };
}

/**
 * Every composition of panels and fillers that makes `length` exactly, within
 * the piece window of the fewest - the `fillOptions` search, per length.
 */
function compositions(length: number, cat: Catalog, cache: Map<number, Array<{ panels: PanelOption[]; fillers: PanelOption[] }>>) {
  const hit = cache.get(length);
  if (hit) return hit;
  const panelWidths = cat.panels.map((o) => o.w);
  const fillerWidths = cat.fillers.map((o) => o.w);
  const combos = fillerCombos(fillerWidths, cat.fillers.length ? cat.maxFillers : 0).flatMap((counts) => {
    const fillerCm = counts.reduce((sum, k, i) => sum + k * fillerWidths[i], 0);
    const fillerCount = counts.reduce((sum, k) => sum + k, 0);
    const target = length - fillerCm;
    if (target < -EPS) return [];
    let minPanels = Infinity;
    if (Math.abs(target) <= EPS) minPanels = 0;
    else if (panelWidths.length) {
      const cover = coverExact(target, panelWidths);
      if (cover.remainder <= EPS) minPanels = cover.picks.length;
    }
    return Number.isFinite(minPanels) ? [{ counts, target, fillerCount, minPanels }] : [];
  });
  const out: Array<{ panels: PanelOption[]; fillers: PanelOption[] }> = [];
  if (combos.length) {
    const fewest = Math.min(...combos.map((c) => c.minPanels + c.fillerCount));
    for (const combo of combos) {
      const room = fewest + PIECE_WINDOW - combo.fillerCount;
      if (combo.minPanels > room) continue;
      const fillers: PanelOption[] = [];
      combo.counts.forEach((k, i) => {
        for (let q = 0; q < k; q++) fillers.push(cat.fillers[i]);
      });
      const sets = Math.abs(combo.target) <= EPS ? [panelWidths.map(() => 0)] : panelCombos(combo.target, panelWidths, room);
      for (const counts of sets) {
        const panels: PanelOption[] = [];
        counts.forEach((k, i) => {
          for (let q = 0; q < k; q++) panels.push(cat.panels[i]);
        });
        if (!panels.length && !fillers.length) continue;
        out.push({ panels, fillers });
      }
    }
  }
  out.sort((p, q) => p.panels.length + p.fillers.length - (q.panels.length + q.fillers.length));
  out.length = Math.min(out.length, COMPOSITION_CAP);
  cache.set(length, out);
  return out;
}

/**
 * Every order worth trying for one composition. Panels keep their size groups
 * widest first (P1, R2) - their order changes nothing the other face or the
 * score can see. What matters is where each filler goes: against the low end,
 * against the high end, or between size groups (R5) - that is A4.
 */
function arrangements(panels: PanelOption[], fillers: PanelOption[]): PanelOption[][] {
  const sorted = [...panels].sort((a, b) => b.w - a.w);
  const groupEnds: number[] = [];
  sorted.forEach((p, i) => {
    if (i < sorted.length - 1 && sorted[i + 1].w !== p.w) groupEnds.push(i + 1);
  });
  const out: PanelOption[][] = [];
  const seen = new Set<string>();
  const total = Math.pow(3, fillers.length);
  for (let code = 0; code < total; code++) {
    const lo: PanelOption[] = [];
    const hi: PanelOption[] = [];
    const mid: PanelOption[] = [];
    let c = code;
    for (const f of fillers) {
      const slot = c % 3;
      c = Math.floor(c / 3);
      (slot === 0 ? lo : slot === 1 ? mid : hi).push(f);
    }
    const body = [...sorted];
    // Between size groups first, then into the middle of one group.
    const cuts = groupEnds.length ? [...groupEnds] : sorted.length > 1 ? [Math.floor(sorted.length / 2)] : [];
    let shift = 0;
    for (const f of mid) {
      const cut = cuts.shift();
      if (cut === undefined) {
        body.splice(Math.floor(body.length / 2), 0, f);
        continue;
      }
      body.splice(cut + shift, 0, f);
      shift++;
    }
    // And a narrow panel the default order leaves beside a filler moved to
    // every other place in the run: widest first is the default (R2), but a
    // 30 is not left against a filler (A7), so where it goes instead has to be
    // on the table. Only then - trying every move every time made the search
    // ten times slower for nothing.
    const bodies = [body];
    const widest = sorted[0]?.w;
    const draft = [...lo, ...body, ...hi];
    const beside = (o: PanelOption) => {
      const i = draft.indexOf(o);
      const isFiller = (q: PanelOption | undefined) => q?.material.category === 'filler';
      return isFiller(draft[i - 1]) || isFiller(draft[i + 1]);
    };
    for (const odd of sorted.filter(
      (p) => p.w !== widest && p.w <= 30 && sorted.filter((q) => q.w === p.w).length === 1 && beside(p),
    )) {
      const at = body.indexOf(odd);
      for (let to = 0; to < body.length; to++) {
        if (to === at) continue;
        const moved = body.filter((_, i) => i !== at);
        moved.splice(to, 0, odd);
        bodies.push(moved);
      }
    }
    for (const b of bodies) {
      const seq = [...lo, ...b, ...hi];
      const key = seq.map((o) => o.material.id).join('.');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(seq);
    }
  }
  return out;
}

/** Every span a face may be laid over, as low end and length. */
function spans(lo: Resolved, hi: Resolved, cat: Catalog): Array<{ from: number; length: number }> {
  const step = cat.step;
  const up = (v: number) => Math.ceil(v / step - 1e-6) * step;
  const out: Array<{ from: number; length: number }> = [];
  if (lo.t === 'fixed' && hi.t === 'fixed') {
    if (hi.p - lo.p > EPS) out.push({ from: lo.p, length: hi.p - lo.p });
    return out;
  }
  if (lo.t === 'fixed' && hi.t === 'reach') {
    for (let L = up(hi.near - lo.p); lo.p + L <= hi.far + EPS; L += step) if (L > EPS) out.push({ from: lo.p, length: L });
    return out;
  }
  if (lo.t === 'reach' && hi.t === 'fixed') {
    for (let L = up(hi.p - lo.near); hi.p - L >= lo.far - EPS; L += step) if (L > EPS) out.push({ from: hi.p - L, length: L });
    return out;
  }
  if (lo.t === 'reach' && hi.t === 'reach') {
    // Both ends free: the extra is shared between them, so a lone line
    // allowed past both ends sticks out evenly rather than all at one end.
    const least = hi.near - lo.near;
    for (let L = up(least); L <= hi.far - lo.far + EPS; L += step) {
      const extra = L - least;
      const loExtra = Math.min(lo.near - lo.far, Math.floor(extra / 2 / step) * step);
      const from = lo.near - loExtra;
      if (from + L > hi.far + EPS) continue;
      if (L > EPS) out.push({ from, length: L });
    }
  }
  return out;
}

const layFrom = (from: number, seq: PanelOption[]): Laid[] => {
  let at = from;
  return seq.map((opt) => {
    const laid = { opt, from: at, filler: opt.material.category === 'filler' };
    at += opt.w;
    return laid;
  });
};

/**
 * The fewest pieces to close an end gap on the derived face, or null.
 *
 * Fixed: exactly `min`, panels, or panels and one filler against the corner.
 * Reach: anything from `min` to `max`, panels only - running past is cheaper
 * than a filler (A2), so the shortest that panels alone make, unless a longer
 * one takes fewer.
 */
function gapFill(min: number, max: number, fixed: boolean, cat: Catalog, cache: Map<string, { seq: PanelOption[]; len: number; cost: number } | null>) {
  const key = `${fixed ? 'f' : 'r'}:${min}:${max}`;
  if (cache.has(key)) return cache.get(key)!;
  const widths = cat.panels.map((o) => o.w);
  const panelsFor = (len: number): PanelOption[] | null => {
    if (len <= EPS) return [];
    const cover = coverExact(len, widths);
    return cover.remainder > EPS ? null : cover.picks.map((i) => cat.panels[i]);
  };
  let best: { seq: PanelOption[]; len: number; cost: number } | null = null;
  const consider = (seq: PanelOption[], len: number, extra: number) => {
    const fillers = seq.filter((o) => o.material.category === 'filler').length;
    const cost = seq.length * WEIGHT.piece + extra * WEIGHT.overhangCm + fillers * 50;
    if (!best || cost < best.cost) best = { seq, len, cost };
  };
  if (fixed) {
    const g = min;
    if (g >= -EPS) {
      const plain = panelsFor(g);
      if (plain) consider(plain, g, 0);
      for (const f of cat.maxFillers > 0 ? cat.fillers : []) {
        const rest = panelsFor(g - f.w);
        if (rest && g - f.w >= -EPS) consider([f, ...rest], g, 0);
      }
    }
  } else {
    const start = Math.max(0, min);
    for (let len = Math.ceil(start / cat.panelStep - 1e-6) * cat.panelStep; len <= max + EPS; len += cat.panelStep) {
      const seq = panelsFor(len);
      if (seq) consider(seq, len, len - start);
    }
    if (min <= EPS && max >= -EPS) consider([], 0, 0);
  }
  cache.set(key, best);
  return best;
}

/**
 * The other face of a wall, from the reference face (A3): the reference's
 * panels it has room for, at the same places, and an end piece out to each of
 * its own ends. Fillers inside the kept stretch are mirrored too, so every
 * joint lines up; fillers at the reference's ends are not - they face part of
 * an end piece. Where an end cannot be closed, the next panel is let go into
 * the gap and the closing tried again.
 */
function derive(ref: Laid[], lo: Resolved, hi: Resolved, cat: Catalog, cache: Map<string, ReturnType<typeof gapFill>>) {
  const loLimit = lo.t === 'fixed' ? lo.p : lo.far;
  const hiLimit = hi.t === 'fixed' ? hi.p : hi.far;
  const panelIdx = ref.map((l, i) => (l.filler ? -1 : i)).filter((i) => i >= 0);
  const inside = panelIdx.filter((i) => ref[i].from >= loLimit - EPS && ref[i].from + ref[i].opt.w <= hiLimit + EPS);
  let best: { laid: Laid[]; unmatched: number; cost: number } | null = null;

  for (let dropLo = 0; dropLo <= 2; dropLo++) {
    for (let dropHi = 0; dropHi <= 2; dropHi++) {
      const keep = inside.slice(dropLo, inside.length - dropHi);
      let loSeq: PanelOption[] | null = null;
      let hiSeq: PanelOption[] | null = null;
      let s: number;
      let e: number;
      let middle: Laid[] = [];
      if (keep.length) {
        s = ref[keep[0]].from;
        const last = ref[keep[keep.length - 1]];
        e = last.from + last.opt.w;
        middle = ref.slice(keep[0], keep[keep.length - 1] + 1);
      } else {
        // Nothing kept: the face is closed from its low end on its own.
        s = lo.t === 'fixed' ? lo.p : lo.near;
        e = s;
      }
      const loFill =
        lo.t === 'fixed' ? gapFill(s - lo.p, s - lo.p, true, cat, cache) : gapFill(s - lo.near, s - lo.far, false, cat, cache);
      if (!loFill) continue;
      const hiFill =
        hi.t === 'fixed' ? gapFill(hi.p - e, hi.p - e, true, cat, cache) : gapFill(hi.near - e, hi.far - e, false, cat, cache);
      if (!hiFill) continue;
      // The filler of a fixed end goes against the corner, which is the outer
      // end of each gap.
      loSeq = loFill.seq;
      hiSeq = [...hiFill.seq].reverse();
      const laid = [...layFrom(s - loFill.len, loSeq), ...middle, ...layFrom(e, hiSeq)];
      const unmatched = panelIdx.length - keep.length;
      const cost = loFill.cost + hiFill.cost + unmatched * WEIGHT.unmatched;
      if (!best || cost < best.cost) best = { laid, unmatched, cost };
    }
  }
  return best;
}

/** Everything the score reads off one wall's faces. */
function scoreWall(faces: FaceFill[], unmatched: number, cat: Catalog, ref: number): Omit<WallFill, 'key' | 'faces'> {
  let pieces = 0;
  let fillers = 0;
  let nianguri = 0;
  let extraFillers = 0;
  let loose = 0;
  let narrowByFiller = 0;
  let groupBreaks = 0;
  let inversions = 0;
  let adjacent = 0;
  let overhang = 0;
  let narrow = 0;
  let nonWidest = 0;
  let steps = 0;
  let spare = 0;
  const widths = new Set<number>();

  faces.forEach((face, faceIndex) => {
    const laid = face.laid;
    pieces += laid.length;
    const isPanelAt = (i: number, end: Resolved) =>
      i < 0 || i >= laid.length ? end.t === 'fixed' && end.next === 'piece' : !laid[i].filler;
    let faceFillers = 0;
    // A filler against an inside corner profile is where the architect puts
    // every one of his (A4): the profile is the datum, the filler closes onto
    // it, nothing else needs clamping. At the free end of a line - a stop end -
    // it is the same. Anywhere else, the butt of a lap included, it is loose:
    // his outside faces close in whole panels.
    const home = (e: Resolved) => e.t === 'fixed' && (e.next === 'profile' || e.next === 'line');
    const seated = (i: number) => (i === 0 && home(face.lo)) || (i === laid.length - 1 && home(face.hi));
    laid.forEach((l, i) => {
      if (l.filler) {
        fillers++;
        if (!seated(i)) {
          faceFillers++;
          loose++;
        }
        if (laid[i - 1]?.filler) adjacent++;
        const between = isPanelAt(i - 1, face.lo) && isPanelAt(i + 1, face.hi);
        if (between && l.opt.w < 10 - EPS) nianguri++;
        return;
      }
      widths.add(l.opt.w);
      if (l.opt.w < 60) narrow++;
      if (l.opt.w < cat.widest) nonWidest++;
      if (cat.spare.has(l.opt.w)) spare++;
      steps += Math.round((cat.widest - l.opt.w) / 15);
    });
    extraFillers += Math.max(0, faceFillers - 1);
    // A7: no 30 beside a filler - two weak strips together. P1: size groups
    // kept together. R2: wider before narrower, along the run. Read off the
    // face that leads only: the other face's order is the leader's mirrored
    // plus its end pieces, and is not a choice of its own.
    if (faceIndex === ref) {
      let runs = 0;
      const kinds = new Set<number>();
      laid.forEach((l, i) => {
        if (l.filler) return;
        kinds.add(l.opt.w);
        const prev = laid.slice(0, i).reverse().find((q) => !q.filler);
        if (!prev || prev.opt.w !== l.opt.w) runs++;
        if (l.opt.w <= 30 + EPS && (laid[i - 1]?.filler || laid[i + 1]?.filler)) narrowByFiller++;
        for (const later of laid.slice(i + 1)) if (!later.filler && later.opt.w > l.opt.w) inversions++;
      });
      groupBreaks += Math.max(0, runs - kinds.size);
    }
    if (laid.length) {
      const start = laid[0].from;
      const last = laid[laid.length - 1];
      const end = last.from + last.opt.w;
      if (face.lo.t === 'reach') overhang += Math.max(0, face.lo.near - start);
      if (face.hi.t === 'reach') overhang += Math.max(0, end - face.hi.near);
    }
  });

  const cost =
    pieces * WEIGHT.piece +
    fillers * WEIGHT.filler +
    loose * WEIGHT.looseFiller +
    narrowByFiller * WEIGHT.narrowByFiller +
    groupBreaks * WEIGHT.groupBreak +
    inversions * WEIGHT.inversion +
    nianguri * WEIGHT.niangi +
    extraFillers * WEIGHT.extraFiller +
    adjacent * WEIGHT.adjacentFillers +
    overhang * WEIGHT.overhangCm +
    unmatched * WEIGHT.unmatched +
    widths.size * WEIGHT.distinct +
    nonWidest * WEIGHT.nonWidest +
    narrow * WEIGHT.narrow +
    spare * WEIGHT.spare +
    steps * WEIGHT.widthStep;
  return { cost, pieces, fillers, nianguri, overhang, unmatched };
}

const fillKey = (faces: FaceFill[]) =>
  faces.map((f) => f.laid.map((l) => `${l.opt.material.id}@${Math.round(l.from * 10) / 10}`).join(',')).join('|');

/**
 * The ranked answers for one wall (one or two segments) at one choice of its
 * lapped corners.
 */
function solveWall(segments: Segment[], passes: Passes, cat: Catalog): WallFill[] {
  const resolved = segments.map((s) => ({
    segment: s,
    lo: resolve(s.lo, s.face, passes, cat),
    hi: resolve(s.hi, s.face, passes, cat),
  }));
  const out = new Map<string, WallFill>();
  const compCache = new Map<number, Array<{ panels: PanelOption[]; fillers: PanelOption[] }>>();
  const gapCache = new Map<string, ReturnType<typeof gapFill>>();

  const add = (faces: FaceFill[], unmatched: number, ref: number) => {
    const key = fillKey(faces);
    if (out.has(key)) return;
    out.set(key, { key, faces, ...scoreWall(faces, unmatched, cat, ref) });
  };

  // Either face may lead; the face with more fixed ends usually wins, but
  // trying both costs little and never misses the better one.
  const refs = resolved.length === 2 ? [0, 1] : [0];
  for (const r of refs) {
    const ref = resolved[r];
    for (const span of spans(ref.lo, ref.hi, cat)) {
      for (const comp of compositions(span.length, cat, compCache)) {
        for (const seq of arrangements(comp.panels, comp.fillers)) {
          const laid = layFrom(span.from, seq);
          const refFill: FaceFill = { segment: ref.segment, laid, lo: ref.lo, hi: ref.hi };
          if (resolved.length === 1) {
            add([refFill], 0, 0);
            continue;
          }
          const other = resolved[1 - r];
          const derived = derive(laid, other.lo, other.hi, cat, gapCache);
          if (!derived) continue;
          const otherFill: FaceFill = { segment: other.segment, laid: derived.laid, lo: other.lo, hi: other.hi };
          add(r === 0 ? [refFill, otherFill] : [otherFill, refFill], derived.unmatched, r);
        }
      }
    }
  }
  return [...out.values()]
    .sort((a, b) => a.cost - b.cost || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, KEEP_PER_WALL);
}

// ── The layout ──────────────────────────────────────────────────────────────

interface Wall {
  segments: Segment[];
  /** lapped corners this wall's ends hang on */
  vars: number[];
  /** answers per choice of `vars`, as a bit string */
  table: Map<number, WallFill[]>;
}

interface HeightSolution {
  height: number;
  geometry: Geometry;
  walls: Wall[];
  /** whole-layout answers at this height, best first */
  picks: Array<{ fills: WallFill[]; cost: number; family: number }>;
  locks: Map<number, Lock[]>;
  faceRemovals: Set<string>;
  catalog: Catalog;
  bare: number;
  /** the walls as drawn: matched face pairs, and lone faces, for showing */
  shown: number[][];
}

/** Most lapped corners tried every way; past this, one at a time from the best. */
const BRUTE_FORCE_CORNERS = 12;

function solveHeight(
  chains: Chain[],
  sides: Array<1 | -1>,
  height: number,
  req: LayoutRequest,
  filters: LayoutFilters,
): HeightSolution | null {
  const materials = req.materials;
  const exclude = new Set(filters.excludeWidths);
  const panels = byWidth(optionsAt(materials, 'panel', height)).filter((o) => !exclude.has(o.w));
  const fillerOpts = byWidth(optionsAt(materials, 'filler', height));
  if (!panels.length) return null;
  const depth = panelDepthFor(optionsAt(materials, 'panel', height));
  const profile = req.includeCorners ? innerCorner(materials, height) : null;
  const widths = [...panels.map((o) => o.w), ...fillerOpts.map((o) => o.w)];
  const catalog: Catalog = {
    panels,
    fillers: fillerOpts,
    widest: Math.max(...panels.map((o) => o.w)),
    step: Math.max(1, widths.reduce((g, w) => gcd(g, w), 0)),
    panelStep: Math.max(1, panels.reduce((g, o) => gcd(g, o.w), 0)),
    depth,
    maxFillers: filters.maxFillers,
    maxOverhang: filters.maxOverhang,
    spare: new Set(filters.spareWidths),
  };

  const geometry = readFaces(chains, sides, { depth, profile, filters });
  const { faces, corners } = geometry;
  const pairs = pairFaces(faces);
  const paired = new Map<number, number>();
  for (const [i, j] of pairs) {
    paired.set(i, j);
    paired.set(j, i);
  }

  // Ends of pours: left open whole. A lap that hung on one becomes a butt.
  const skipped = new Set<number>();
  faces.forEach((f, i) => {
    if (isDead(f)) skipped.add(i);
    else if (!paired.has(i) && closesAnEnd(f, faces, pairs)) {
      skipped.add(i);
      const mid = (f.lineLo + f.lineHi) / 2;
      geometry.openings.push({
        x: f.across ? mid : f.at,
        y: f.across ? f.at : mid,
        cm: Math.round((f.lineHi - f.lineLo) * 10) / 10,
        kind: 'corner',
      });
    }
  });
  for (const corner of corners) {
    for (const [mine, theirs] of [
      [corner.a, corner.b],
      [corner.b, corner.a],
    ] as const) {
      if (!skipped.has(theirs.face)) continue;
      const f = faces[mine.face];
      const end = f[mine.end];
      if (end.t === 'lap') f[mine.end] = { t: 'fixed', p: end.v, next: 'end' };
    }
  }

  // ── Pieces already standing on the faces ──
  const locks = new Map<number, Lock[]>();
  const faceRemovals = new Set<string>();
  const byId = new Map(materials.map((m) => [m.id, m]));
  const reachWindow = depth + filters.maxOverhang + 1;
  for (const piece of req.pieces ?? []) {
    const m = byId.get(piece.materialId);
    if (!m || (m.category !== 'panel' && m.category !== 'filler')) continue;
    if (Math.abs(((piece.rot % 90) + 90) % 90) > FLUSH_TOL && Math.abs(((piece.rot % 90) + 90) % 90) < 90 - FLUSH_TOL) continue;
    faces.forEach((f, i) => {
      if (skipped.has(i)) return;
      // Off: anything on the face or hanging off its ends goes. On: only what
      // stands on the drawn line itself is built around.
      const hit = standing(f, filters.keepPlaced ? 0 : reachWindow, piece, m);
      if (!hit) return;
      if (!filters.keepPlaced) {
        faceRemovals.add(piece.id);
        return;
      }
      const list = locks.get(i) ?? [];
      const z = Math.round(piece.z ?? 0);
      const same = list.find((l) => Math.abs(l.from - hit.from) < FLUSH_TOL && Math.abs(l.to - hit.to) < FLUSH_TOL);
      if (same) {
        if (!same.zs.includes(z)) same.zs.push(z);
      } else list.push({ from: hit.from, to: hit.to, materialId: m.id, zs: [z] });
      locks.set(i, list);
    });
  }

  // A kept panel needs its twin opposite it (A3): stand one there if the
  // other face is free at that place.
  for (const [i, j] of pairs) {
    for (const [from, to] of [
      [i, j],
      [j, i],
    ]) {
      const theirs = locks.get(to) ?? [];
      for (const lock of locks.get(from) ?? []) {
        const m = byId.get(lock.materialId);
        if (!m || m.category !== 'panel') continue;
        const target = faces[to];
        if (lock.from < target.lineLo - EPS || lock.to > target.lineHi + EPS) continue;
        if (theirs.some((t) => Math.min(t.to, lock.to) - Math.max(t.from, lock.from) > FLUSH_TOL)) continue;
        theirs.push({ from: lock.from, to: lock.to, materialId: lock.materialId, zs: [] });
      }
      if (theirs.length) locks.set(to, theirs);
    }
  }

  /** A face cut into the stretches between the pieces kept on it. */
  const segmentsOf = (i: number): Segment[] => {
    const f = faces[i];
    const list = [...(locks.get(i) ?? [])].sort((a, b) => a.from - b.from);
    if (!list.length) return [{ face: i, lo: f.lo, hi: f.hi }];
    const out: Segment[] = [];
    let lo: EndSpec = f.lo;
    for (const lock of list) {
      const hi: EndSpec = { t: 'fixed', p: lock.from, next: 'piece' };
      if (lock.from - boundOf(lo) > EPS) out.push({ face: i, lo, hi });
      lo = { t: 'fixed', p: lock.to, next: 'piece' };
    }
    if (boundOf(f.hi) - boundOf(lo) > EPS) out.push({ face: i, lo, hi: f.hi });
    return out;
  };

  // ── Walls: paired segments, and lone ones ──
  const walls: Wall[] = [];
  const used = new Set<number>();
  const lapVars = (segs: Segment[]) =>
    [...new Set(segs.flatMap((s) => [s.lo, s.hi]).flatMap((e) => (e.t === 'lap' ? [e.corner] : [])))].sort((a, b) => a - b);
  const extent = (s: Segment) => [boundOf(s.lo), boundOf(s.hi)];
  faces.forEach((_, i) => {
    if (skipped.has(i) || used.has(i)) return;
    used.add(i);
    const j = paired.get(i);
    const mine = segmentsOf(i);
    if (j === undefined) {
      for (const s of mine) walls.push({ segments: [s], vars: lapVars([s]), table: new Map() });
      return;
    }
    used.add(j);
    const theirs = segmentsOf(j);
    const takenTheirs = new Set<number>();
    for (const s of mine) {
      const [a0, a1] = extent(s);
      let best = -1;
      let bestOverlap = EPS;
      theirs.forEach((t, k) => {
        if (takenTheirs.has(k)) return;
        const [b0, b1] = extent(t);
        const overlap = Math.min(a1, b1) - Math.max(a0, b0);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = k;
        }
      });
      if (best >= 0) {
        takenTheirs.add(best);
        const segs = [s, theirs[best]];
        walls.push({ segments: segs, vars: lapVars(segs), table: new Map() });
      } else walls.push({ segments: [s], vars: lapVars([s]), table: new Map() });
    }
    theirs.forEach((t, k) => {
      if (!takenTheirs.has(k)) walls.push({ segments: [t], vars: lapVars([t]), table: new Map() });
    });
  });

  // ── Each wall at every choice of its own corners ──
  for (const wall of walls) {
    const combos = 1 << wall.vars.length;
    for (let mask = 0; mask < combos; mask++) {
      // The corner bit says which face runs: off, the leg arriving at the
      // corner; on, the leg leaving it.
      const passes: Passes = (corner, face) => {
        const on = !!(mask & (1 << wall.vars.indexOf(corner)));
        return (on ? corners[corner].b.face : corners[corner].a.face) === face;
      };
      wall.table.set(mask, solveWall(wall.segments, passes, catalog));
    }
  }

  // ── The corners, across the layout ──
  const varIds = corners.map((c) => c.id).filter((id) => walls.some((w) => w.vars.includes(id)));
  const local = (wall: Wall, global: Map<number, boolean>) =>
    wall.vars.reduce((mask, v, k) => mask | ((global.get(v) ? 1 : 0) << k), 0);
  /**
   * Which face the architect lets run through at each lapped corner: the face
   * of the THICKER wall, and of two walls alike the longer face. Read off his
   * job (docs/LAYOUT-SOLVER.md, A6): the 20 cm top runs through over the 15
   * and 20 cm sides, the sides run through over the 10 cm bottom. A face with
   * no partner has no thickness and takes no side.
   */
  const thickness = (i: number) => {
    const j = paired.get(i);
    return j === undefined ? 0 : Math.abs(faces[i].at - faces[j].at);
  };
  const lengthOf = (i: number) => faces[i].lineHi - faces[i].lineLo;
  const preferB = new Map<number, boolean | null>();
  for (const c of corners) {
    const ta = thickness(c.a.face);
    const tb = thickness(c.b.face);
    if (!ta && !tb) preferB.set(c.id, null);
    else if (Math.abs(ta - tb) > 0.5) preferB.set(c.id, tb > ta);
    else if (Math.abs(lengthOf(c.a.face) - lengthOf(c.b.face)) > 0.5) preferB.set(c.id, lengthOf(c.b.face) > lengthOf(c.a.face));
    else preferB.set(c.id, null);
  }
  const cornerCost = (global: Map<number, boolean>) =>
    [...global].reduce((sum, [id, on]) => {
      const want = preferB.get(id);
      return want === null || want === undefined || want === on ? sum : sum + WEIGHT.lapAgainst;
    }, 0);
  const totalFor = (global: Map<number, boolean>) =>
    cornerCost(global) +
    walls.reduce((sum, w) => sum + (w.table.get(local(w, global))?.[0]?.cost ?? WEIGHT.infeasible), 0);

  const assignments: Array<{ global: Map<number, boolean>; cost: number }> = [];
  if (varIds.length <= BRUTE_FORCE_CORNERS) {
    for (let mask = 0; mask < 1 << varIds.length; mask++) {
      const global = new Map(varIds.map((id, k) => [id, !!(mask & (1 << k))]));
      assignments.push({ global, cost: totalFor(global) });
    }
  } else {
    // Coordinate descent from every corner one way, then the other.
    for (const startOn of [false, true]) {
      const global = new Map(varIds.map((id) => [id, startOn]));
      let cost = totalFor(global);
      let improved = true;
      while (improved) {
        improved = false;
        for (const id of varIds) {
          global.set(id, !global.get(id));
          const next = totalFor(global);
          if (next < cost - EPS) {
            cost = next;
            improved = true;
          } else global.set(id, !global.get(id));
        }
      }
      assignments.push({ global: new Map(global), cost });
      for (const id of varIds) {
        const flipped = new Map(global);
        flipped.set(id, !flipped.get(id));
        assignments.push({ global: flipped, cost: totalFor(flipped) });
      }
    }
  }
  assignments.sort((a, b) => a.cost - b.cost);

  // Whole-layout answers: the best corner choices with every wall at its
  // best, then the best choice with one wall at a time at its next answers.
  const picks: Array<{ fills: WallFill[]; cost: number; family: number }> = [];
  const seen = new Set<string>();
  const push = (fills: Array<WallFill | undefined>, extra: number, family: number) => {
    if (fills.some((f) => !f)) return;
    const ok = fills as WallFill[];
    const key = ok.map((f) => f.key).join('#');
    if (seen.has(key)) return;
    seen.add(key);
    picks.push({ fills: ok, cost: extra + ok.reduce((s, f) => s + f.cost, 0), family });
  };
  assignments.slice(0, 8).forEach((a, family) =>
    push(
      walls.map((w) => w.table.get(local(w, a.global))?.[0]),
      cornerCost(a.global),
      family,
    ),
  );
  if (assignments.length) {
    const best = assignments[0].global;
    walls.forEach((w, k) => {
      const list = w.table.get(local(w, best)) ?? [];
      for (let r = 1; r < Math.min(list.length, 6); r++) {
        push(
          walls.map((other, q) => (q === k ? list[r] : other.table.get(local(other, best))?.[0])),
          cornerCost(best),
          0,
        );
      }
    });
  }
  picks.sort((a, b) => a.cost - b.cost);

  const bare = geometry.openings.reduce((s, o) => s + o.cm, 0);
  const shown: number[][] = [...pairs.map(([i, j]) => [i, j])];
  faces.forEach((_, i) => {
    if (!skipped.has(i) && !paired.has(i)) shown.push([i]);
  });
  return { height, geometry, walls, picks, locks, faceRemovals, catalog, bare, shown };
}

/** The least a face end can be - a lap counted at its butt. */
function boundOf(e: EndSpec): number {
  return e.t === 'fixed' ? e.p : e.t === 'reach' ? e.near : e.v;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Fill a selection of lines as one layout and return its best whole-layout
 * variants, best first.
 */
export function solveLayout(req: LayoutRequest): LayoutResult {
  const filters: LayoutFilters = { ...DEFAULT_LAYOUT_FILTERS, ...req.filters };
  const warnings: string[] = [];
  if (!req.paths.length) return { variants: [], warnings, openings: [] };
  if (!(req.height > 0)) return { variants: [], warnings: ['სიმაღლე ნულზე მეტი უნდა იყოს.'], openings: [] };

  const heights = panelHeights(req.materials);
  if (!heights.length) return { variants: [], warnings: ['კატალოგში პანელები ვერ მოიძებნა.'], openings: [] };
  const stack = chooseStack(req, heights, filters);
  if (!stack) {
    return {
      variants: [],
      warnings: [`${req.height} სმ სიმაღლე პანელების ნებისმიერი სიმაღლით ზუსტად არ შედგება.`],
      openings: [],
    };
  }

  const chains = joinLines(req.paths);
  const sides = sidesFromNeighbours(
    chains.map((c) => c.path),
    { height: req.height, includeCorners: req.includeCorners },
  );

  const solutions = new Map<number, HeightSolution>();
  for (const h of [...new Set(stack)]) {
    const solved = solveHeight(chains, sides, h, req, filters);
    if (!solved) {
      warnings.push(`${h} სმ სიმაღლის პანელები კატალოგში არ არის.`);
      continue;
    }
    solutions.set(h, solved);
    warnings.push(...solved.geometry.warnings);
  }
  const first = solutions.get(stack[0]);
  if (!first) return { variants: [], warnings: [...new Set(warnings)], openings: [] };

  const count = Math.max(...[...solutions.values()].map((s) => s.picks.length));
  const byId = new Map(req.materials.map((m) => [m.id, m]));
  const variants: LayoutVariant[] = [];
  for (let i = 0; i < count; i++) {
    variants.push(buildVariant(i, stack, solutions, req, filters, byId));
  }
  variants.sort((a, b) => a.score - b.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // Reasons are relative to the rest of the list, so they are worked out last.
  const feasibleOnes = variants.filter((v) => v.feasible);
  const pool = feasibleOnes.length ? feasibleOnes : variants;
  const fewest = Math.min(...pool.map((v) => v.panels + v.fillers));
  const names = new Map(req.materials.map((m) => [m.id, m.name]));
  for (const v of variants) {
    const reasons: string[] = [];
    const pieces = v.panels + v.fillers;
    reasons.push(pieces === fewest ? 'ყველაზე ცოტა ელემენტი' : `+${pieces - fewest} ელემენტი`);
    if (v.fillers === 0) reasons.push('ჩაკერების გარეშე');
    if (v.nianguri) reasons.push(`ნიანგი: ${v.nianguri}`);
    if (v.overhang > 0) reasons.push(`გადაცილება ${v.overhang} სმ`);
    if (v.unmatched) reasons.push(`${v.unmatched} პანელი პირისპირ წყვილის გარეშე`);
    if (v.openCm) reasons.push(`ღია ${v.openCm} სმ`);
    for (const [id, need] of Object.entries(v.total)) {
      const free = req.free?.get(id);
      if (free !== undefined && filters.useStock && need > free) {
        reasons.push(`მარაგი არ ყოფნის: ${names.get(id) ?? id} (აკლია ${need - free})`);
      }
    }
    v.reasons = reasons;
  }
  if (!feasibleOnes.length && filters.useStock && variants.length && req.free) {
    warnings.push('არცერთი ვარიანტი არ ჯდება მარაგში - ნაჩვენებია ყველაზე ახლოს მყოფები.');
  }
  return {
    variants: shortlist(variants, req.limit ?? 8),
    warnings: [...new Set(warnings)],
    openings: first.geometry.openings,
  };
}

function chooseStack(req: LayoutRequest, heights: number[], filters: LayoutFilters): number[] | null {
  if (
    req.stack?.length &&
    Math.abs(req.stack.reduce((s, h) => s + h, 0) - req.height) <= EPS &&
    req.stack.every((h) => heights.includes(h))
  ) {
    return [...req.stack];
  }
  const stacks = courseStacks(req.height, heights);
  if (!stacks.length) return null;
  const tallest = heights[0];
  if (filters.fewer300) {
    const without = stacks.filter((s) => !s.includes(tallest));
    if (without.length) return without.sort((a, b) => a.length - b.length)[0];
  }
  return stacks.sort((a, b) => a.length - b.length)[0];
}

function buildVariant(
  index: number,
  stack: number[],
  solutions: Map<number, HeightSolution>,
  req: LayoutRequest,
  filters: LayoutFilters,
  byId: Map<string, Material>,
): LayoutVariant {
  const add: Piece[] = [];
  const remove = new Set<string>();
  const total: Record<string, number> = {};
  let panels = 0;
  let fillers = 0;
  let corners = 0;
  let nianguri = 0;
  let overhang = 0;
  let unmatched = 0;
  let score = 0;
  const keyParts: string[] = [];
  let family = 0;
  let walls: WallSummary[] = [];
  let openCm = 0;

  const count = (materialId: string) => {
    total[materialId] = (total[materialId] ?? 0) + 1;
    const m = byId.get(materialId);
    if (m?.category === 'filler') fillers++;
    else if (m?.category === 'corner') corners++;
    else panels++;
  };

  // Pieces on the drawing that a placed profile would land on: kept means
  // the profile stands down, replaced means the old one goes.
  const existingCorners = (req.pieces ?? []).filter((p) => byId.get(p.materialId)?.category === 'corner');

  let elevation = 0;
  stack.forEach((h, course) => {
    const sol = solutions.get(h);
    const z = elevation;
    elevation += h;
    if (!sol) return;
    const pick = sol.picks[Math.min(index, sol.picks.length - 1)];
    if (!pick) return;
    const firstOfHeight = stack.indexOf(h) === course;
    if (firstOfHeight) {
      score += pick.cost;
      if (course === 0) family = pick.family;
      keyParts.push(`${h}:${pick.fills.map((f) => f.key).join('#')}`);
      for (const f of pick.fills) {
        nianguri += f.nianguri;
        overhang += f.overhang;
        unmatched += f.unmatched;
      }
      openCm += sol.bare;
      if (!walls.length) walls = summarise(pick.fills, sol, byId);
    }
    for (const id of sol.faceRemovals) remove.add(id);

    const faces = sol.geometry.faces;
    const place = (faceIndex: number, materialId: string, from: number) => {
      const m = byId.get(materialId);
      if (!m) return;
      const f = faces[faceIndex];
      const pw = planW(m);
      const ph = planH(m);
      const rot = f.across ? 0 : 90;
      const face = f.outward > 0 ? f.at : f.at - ph;
      const { x, y } = placeAt(f.across ? from : face, f.across ? face : from, pw, ph, rot);
      add.push({ id: uid(), materialId, x, y, rot, z });
      count(materialId);
    };

    for (const fill of pick.fills) {
      for (const face of fill.faces) {
        for (const l of face.laid) place(face.segment.face, l.opt.material.id, l.from);
      }
    }
    // Kept pieces missing from this course, and twins opposite kept panels.
    for (const [faceIndex, list] of sol.locks) {
      for (const lock of list) {
        if (lock.zs.includes(Math.round(z))) continue;
        place(faceIndex, lock.materialId, lock.from);
      }
    }
    // Profiles in the inside corners.
    for (const profile of sol.geometry.profiles) {
      const piece: Piece = { id: uid(), ...profile.piece, z };
      const box = pieceBounds(piece, profile.material);
      const clash = existingCorners.filter((p) => {
        const m = byId.get(p.materialId);
        if (!m || Math.abs((p.z ?? 0) - z) > 1) return false;
        const b = pieceBounds(p, m);
        return Math.min(b.x + b.w, box.x + box.w) - Math.max(b.x, box.x) > 1 && Math.min(b.y + b.h, box.y + box.h) - Math.max(b.y, box.y) > 1;
      });
      if (clash.length && filters.keepPlaced) continue;
      for (const c of clash) remove.add(c.id);
      add.push(piece);
      count(piece.materialId);
    }
  });

  const feasible =
    !filters.useStock || !req.free || Object.entries(total).every(([id, need]) => !req.free!.has(id) || need <= req.free!.get(id)!);
  if (!feasible) score += WEIGHT.infeasible;
  return {
    key: keyParts.join('|'),
    family,
    stack,
    add,
    remove: [...remove],
    panels,
    fillers,
    corners,
    nianguri,
    overhang: Math.round(overhang),
    unmatched,
    openCm: Math.round(openCm),
    total,
    feasible,
    score,
    reasons: [],
    walls,
  };
}

/**
 * One entry per wall as drawn - a matched pair of faces, or a lone face - with
 * each face's whole run along it: the new pieces and the ones kept on it, in
 * order, so a wall built round kept panels reads as the wall it is rather than
 * as the stretches between them.
 */
function summarise(fills: WallFill[], sol: HeightSolution, byId: Map<string, Material>): WallSummary[] {
  const faces = sol.geometry.faces;
  const onFace = new Map<number, FaceFill[]>();
  for (const fill of fills) {
    for (const face of fill.faces) {
      const list = onFace.get(face.segment.face) ?? [];
      list.push(face);
      onFace.set(face.segment.face, list);
    }
  }
  return sol.shown.flatMap((group) => {
    const parts = group.map((i) => {
      const items: Array<{ from: number; label: string }> = [];
      let over = 0;
      for (const face of onFace.get(i) ?? []) {
        for (const l of face.laid) items.push({ from: l.from, label: l.filler ? `ჩ${l.opt.w}` : String(l.opt.w) });
        const laid = face.laid;
        if (laid.length) {
          const last = laid[laid.length - 1];
          if (face.lo.t === 'reach') over += Math.max(0, face.lo.near - laid[0].from);
          if (face.hi.t === 'reach') over += Math.max(0, last.from + last.opt.w - face.hi.near);
        }
      }
      for (const lock of sol.locks.get(i) ?? []) {
        const m = byId.get(lock.materialId);
        if (!m) continue;
        items.push({ from: lock.from, label: m.category === 'filler' ? `ჩ${Math.round(lock.to - lock.from)}` : String(Math.round(lock.to - lock.from)) });
      }
      items.sort((p, q) => p.from - q.from);
      return { parts: items.map((x) => x.label), overhang: Math.round(over) };
    });
    if (parts.every((p) => !p.parts.length)) return [];
    const f0 = faces[group[0]];
    const mid = (f0.lineLo + f0.lineHi) / 2;
    return [
      {
        key: group.join('-'),
        length: Math.round(Math.max(...group.map((i) => faces[i].lineHi - faces[i].lineLo))),
        x: f0.across ? mid : f0.at,
        y: f0.across ? f0.at : mid,
        faces: parts,
      },
    ];
  });
}

/**
 * The best variants, but not eight shades of one answer: the best of the next
 * few ways to lap the corners always make the list, and so does the answer
 * with the fewest pieces - which the architect's rules may rank lower, but
 * which somebody short of panels wants to see. Still in score order.
 */
function shortlist(variants: LayoutVariant[], limit: number): LayoutVariant[] {
  const keep = new Set<LayoutVariant>();
  const count = (v: LayoutVariant) => v.panels + v.fillers;
  const leanest = variants.reduce<LayoutVariant | null>((best, v) => (!best || count(v) < count(best) ? v : best), null);
  if (leanest && limit > 1) keep.add(leanest);
  const families = new Set<number>();
  for (const v of variants) {
    if (families.size >= 3 || keep.size >= limit) break;
    if (families.has(v.family)) continue;
    families.add(v.family);
    keep.add(v);
  }
  for (const v of variants) {
    if (keep.size >= limit) break;
    keep.add(v);
  }
  return variants.filter((v) => keep.has(v));
}
