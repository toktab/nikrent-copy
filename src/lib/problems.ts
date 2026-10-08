import type { Material, Piece, SketchPath } from '../types';
import type { Point } from './sketch';
import { checkPath, type FaceCheck } from './lengthCheck';
import { cornersOnly } from './sketchFill';
import { pieceBounds, rectsOverlap, type Rect } from './geometry';
import { allGaps, componentThatFits, faceBands, isFace, type GapRect } from './gap';
import { hiddenSpan } from './projection';
import { remainingRows } from './remaining';
import { stockEntered } from './fillOptions';

/**
 * Everything wrong with the open drawing, in one list - the architect's rule is
 * that the check has to come to 0, and this makes 0 one number for the whole
 * job instead of a walk round every line.
 *
 * Nothing new is judged here. It gathers checks that already exist and already
 * have their own tests: the ცდომილება of every drawn line (`checkPath`), pieces
 * on top of each other, holes between pieces that no line accounts for, and
 * the ნაშთი shortfall. Each finding says where it is, so a click can go there.
 */

export type ProblemKind = 'length' | 'overlap' | 'empty' | 'gap' | 'shortage';

export interface Problem {
  /** stable while the drawing is unchanged, for list keys */
  id: string;
  kind: ProblemKind;
  /** error: the drawing is wrong as it stands; warning: worth a look */
  severity: 'error' | 'warning';
  title: string;
  detail: string;
  /** where to look, world cm; null for what has no place on the drawing */
  at: Point | null;
  pathId?: string;
  pieceIds?: string[];
  materialId?: string;
}

/** How a drawn line stands: nothing on it yet, built right, or built wrong. */
export type LineStatus = 'empty' | 'ok' | 'bad';

export interface ProblemReport {
  problems: Problem[];
  errors: number;
  warnings: number;
  lines: Map<string, LineStatus>;
}

/**
 * A hole this close to a drawn line is the line's own ცდომილება, already
 * reported with the segment it is on; listing it again as a gap says the same
 * thing twice.
 */
const NEAR_LINE_CM = 12;
/**
 * Wider than this a clear space between two pieces is a doorway, a pour end or
 * two separate walls - a decision, not a hole somebody forgot.
 */
const MAX_GAP_CM = 100;

const KIND_ORDER: ProblemKind[] = ['length', 'overlap', 'empty', 'gap', 'shortage'];

interface Input {
  materials: Material[];
  pieces: Piece[];
  sketch: SketchPath[];
}

/** Colour for each drawn line - the cheap part of `findProblems`, for the canvas. */
export function lineStatuses(
  sketch: SketchPath[],
  pieces: Piece[],
  byId: Map<string, Material>,
): Map<string, LineStatus> {
  const out = new Map<string, LineStatus>();
  for (const path of sketch) {
    const check = checkPath(path, sketch, pieces, byId);
    out.set(path.id, !check.courses.length ? 'empty' : check.ok ? 'ok' : 'bad');
  }
  return out;
}

export function findProblems({ materials, pieces, sketch }: Input): ProblemReport {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const problems: Problem[] = [];
  const lines = new Map<string, LineStatus>();

  // ── ცდომილება, line by line ──
  sketch.forEach((path, p) => {
    const check = checkPath(path, sketch, pieces, byId);
    if (!check.orthogonal) {
      lines.set(path.id, 'empty');
      return;
    }
    if (!check.courses.length) {
      lines.set(path.id, 'empty');
      problems.push({
        id: `empty:${path.id}`,
        kind: 'empty',
        severity: 'warning',
        title: `ხაზი ${p + 1}`,
        detail: 'ელემენტი არ დგას',
        at: legMid(path, 0),
        pathId: path.id,
      });
      return;
    }
    lines.set(path.id, check.ok ? 'ok' : 'bad');
    check.courses.forEach((course, c) => {
      for (const face of course.faces) {
        if (face.ok) continue;
        problems.push({
          id: `length:${path.id}:${course.z}:${face.leg}`,
          kind: 'length',
          severity: 'error',
          title: [
            `ხაზი ${p + 1}`,
            `მონაკვეთი ${face.leg + 1}`,
            check.courses.length > 1 ? `რიგი ${c + 1}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
          detail: describeFace(face),
          at: legMid(path, face.leg),
          pathId: path.id,
        });
      }
    });
  });

  // ── pieces on top of each other, course by course ──
  for (const cluster of overlapClusters(pieces, byId)) {
    problems.push({
      id: `overlap:${[...cluster.ids].sort()[0]}`,
      kind: 'overlap',
      severity: 'error',
      title: 'გადაფარვა',
      detail: `${cluster.ids.length} ელემენტი ერთ ადგილას`,
      at: { x: cluster.box.x + cluster.box.w / 2, y: cluster.box.y + cluster.box.h / 2 },
      pieceIds: cluster.ids,
    });
  }

  // ── holes no line accounts for ──
  const rects: GapRect[] = pieces.flatMap((piece) => {
    const m = byId.get(piece.materialId);
    if (!m || !isFace(m)) return [];
    const rect = pieceBounds(piece, m);
    return [
      { ...rect, heightCm: m.h, span: hiddenSpan(piece, m, 'plan'), bands: faceBands(rect, m, piece.rot, false) },
    ];
  });
  for (const gap of allGaps(rects, MAX_GAP_CM)) {
    const centre = { x: gap.x + gap.w / 2, y: gap.y + gap.h / 2 };
    if (nearAnyLine(centre, sketch)) continue;
    const fill = componentThatFits(gap.size, materials, gap.againstHeight);
    const size = Math.round(gap.size * 10) / 10;
    problems.push({
      id: `gap:${Math.round(centre.x)}:${Math.round(centre.y)}`,
      kind: 'gap',
      severity: 'warning',
      title: 'ნაპრალი',
      detail: `${size} სმ${fill ? ` - ჩაჯდება ${fill}` : ''}`,
      at: centre,
    });
  }

  // ── short of stock (only once stock has been entered at all) ──
  if (stockEntered(materials)) {
    for (const group of remainingRows(materials, pieces, { show: 'short' }).groups) {
      for (const row of group.rows) {
        problems.push({
          id: `shortage:${row.material.id}`,
          kind: 'shortage',
          severity: 'warning',
          title: row.material.name,
          detail: `მარაგი არ ჰყოფნის: ${-row.left} ცალი აკლია`,
          at: null,
          materialId: row.material.id,
        });
      }
    }
  }

  problems.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const errors = problems.filter((x) => x.severity === 'error').length;
  return { problems, errors, warnings: problems.length - errors, lines };
}

/** One segment's finding in words: how far off, and where the hole or double-up is. */
export function describeFace(face: FaceCheck): string {
  const parts: string[] = [];
  if (face.error > 0) parts.push(`+${face.error} სმ ზედმეტი`);
  else if (face.error < 0) parts.push(`−${-face.error} სმ აკლია`);
  for (const g of face.gaps) parts.push(`ღრიჭო ${g.cm} სმ, ${g.at} სმ-ზე`);
  for (const o of face.overlaps) parts.push(`გადაფარვა ${o.cm} სმ, ${o.at} სმ-ზე`);
  return parts.join(' · ');
}

/** Middle of a segment, counting corners only - the same legs `checkPath` numbers. */
function legMid(path: SketchPath, leg: number): Point {
  const pts = cornersOnly(path).points;
  const a = pts[leg % pts.length];
  const b = pts[(leg + 1) % pts.length];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function nearAnyLine(at: Point, sketch: SketchPath[]): boolean {
  for (const path of sketch) {
    const pts = path.points;
    const count = path.closed && pts.length > 2 ? pts.length : pts.length - 1;
    for (let i = 0; i < count; i++) {
      if (distanceToSegment(at, pts[i], pts[(i + 1) % pts.length]) <= NEAR_LINE_CM) return true;
    }
  }
  return false;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Face pieces sharing floor on the same course, grouped. Only the same course:
 * a 150 standing on a 150 shares its footprint in plan and is a wall, not a
 * clash - which is exactly what the older plan-only overlap check gets wrong.
 */
function overlapClusters(pieces: Piece[], byId: Map<string, Material>): Array<{ ids: string[]; box: Rect }> {
  const boxes = pieces
    .flatMap((piece) => {
      const m = byId.get(piece.materialId);
      return m && isFace(m) ? [{ id: piece.id, z: Math.round(piece.z ?? 0), box: pieceBounds(piece, m) }] : [];
    })
    .sort((a, b) => a.box.x - b.box.x);

  const parent = boxes.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[j].box.x >= boxes[i].box.x + boxes[i].box.w) break;
      if (boxes[i].z === boxes[j].z && rectsOverlap(boxes[i].box, boxes[j].box)) {
        parent[root(j)] = root(i);
      }
    }
  }

  const groups = new Map<number, number[]>();
  boxes.forEach((_, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  return [...groups.values()]
    .filter((members) => members.length > 1)
    .map((members) => {
      const x0 = Math.min(...members.map((i) => boxes[i].box.x));
      const y0 = Math.min(...members.map((i) => boxes[i].box.y));
      const x1 = Math.max(...members.map((i) => boxes[i].box.x + boxes[i].box.w));
      const y1 = Math.max(...members.map((i) => boxes[i].box.y + boxes[i].box.h));
      return { ids: members.map((i) => boxes[i].id), box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
    });
}
