import { angleGap, segAngleDeg, type Pt } from './segments';

/**
 * Turning traced lines into a drawing with the right lengths.
 *
 * This is the hard half of tracing a PDF, and it is worth being plain about
 * why. A PDF carries no scale anybody can trust: a drawing is printed at
 * whatever fitted the sheet, re-exported, cropped, and the title block's
 * "1:50" is a claim about the original. So the geometry recovered from the page
 * is the right SHAPE at the wrong SIZE, and the only reliable source of true
 * size is the person who knows the building.
 *
 * So it is done the way a surveyor would:
 *
 * 1. **One known length sets the scale.** The user traces a wall they know and
 *    types its real length. Every other line is then in centimetres - probably
 *    out by a little, but all of them out by the SAME little, because they came
 *    off one drawing.
 * 2. **Any line can be corrected on its own.** Typing a length on a second wall
 *    does not re-scale everything: it fixes that wall and lets the rest move as
 *    little as they can. That matters because the scaling error is rarely
 *    uniform - the sheet was cropped, or the drawing was stretched to fit.
 * 3. **The corners stay joined.** This is what makes it hard. Moving one wall's
 *    end to make it 490 drags the wall it meets. So the lines are not adjusted
 *    one at a time; the whole network is solved at once.
 *
 * The solve is simple because the drawing is orthogonal (the app only builds
 * square formwork). A horizontal wall's length is a difference of x values, and
 * its two ends share a y; a vertical wall is the mirror of that. The problem
 * therefore splits into two independent one-dimensional problems - "where do
 * the vertical rails sit" and "where do the horizontal rails sit" - each a
 * small set of statements of the form `value[j] - value[i] = length`. Typed
 * lengths are stiff statements, measured ones are springy, and a few hundred
 * relaxation sweeps settle it. Corners hold because the two ends of a wall are
 * one node, not two.
 */

export interface TracedLine {
  id: string;
  /** endpoints in PDF page points */
  a: Pt;
  b: Pt;
  /** the real length the user typed, in cm; absent means "whatever the page says" */
  lengthCm?: number;
}

export interface FitOptions {
  /** cm per PDF point, from the calibration line */
  cmPerPoint: number;
  /** endpoints this close in cm are the same corner */
  joinTolCm?: number;
  /** within this many degrees of an axis counts as on it */
  orthoTolDeg?: number;
  /** round the result onto this grid, 0 for none (the drawing is ruled in 5) */
  snapCm?: number;
  iterations?: number;
}

export interface FittedLine {
  id: string;
  a: Pt;
  b: Pt;
  axis: 'h' | 'v' | 'free';
  /** what the page said it was, scaled - before any correcting */
  measuredCm: number;
  /** what the user typed, if they did */
  targetCm?: number;
  /** what it ended up as */
  lengthCm: number;
  /** lengthCm - targetCm; 0 on a line that got what it asked for */
  errorCm: number;
  /** how far its ends had to move for the rest of the drawing to work out */
  movedCm: number;
}

export interface FitPath {
  points: Pt[];
  closed: boolean;
}

export interface FitResult {
  lines: FittedLine[];
  /** the lines chained into runs, ready to become drawn layout lines */
  paths: FitPath[];
  /** how many lines the user gave a length to */
  assigned: number;
  /** the worst miss on a typed length, in cm - should be 0 */
  maxErrorCm: number;
  /** how far the furthest line had to move, in cm */
  maxMovedCm: number;
  /** typed lengths this could not enforce, because the line is not square */
  skewed: string[];
}

const DEFAULTS = {
  joinTolCm: 12,
  orthoTolDeg: 4,
  snapCm: 0,
  iterations: 400,
};

interface Constraint {
  i: number;
  j: number;
  /** value[j] - value[i] should equal this */
  target: number;
  /** 0..1; 1 is "do not argue with this" */
  stiffness: number;
}

/** Union-find over endpoints, so a corner is one node and not two. */
class Nodes {
  readonly parent: number[] = [];

  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[i] !== root) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }

  add(): number {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/**
 * Relaxes one axis: a set of "this value minus that value should be N"
 * statements, settled by nudging both ends of each statement towards it, over
 * and over. Stiff statements win where two disagree.
 *
 * Each pass ends by sliding every connected group back onto where it started,
 * so a drawing does not wander off the page while its insides are corrected.
 */
function relax(
  values: number[],
  constraints: Constraint[],
  groups: number[][],
  iterations: number,
): void {
  const start = values.slice();
  for (let pass = 0; pass < iterations; pass++) {
    for (const c of constraints) {
      const error = c.target - (values[c.j] - values[c.i]);
      const step = (error * c.stiffness) / 2;
      values[c.i] -= step;
      values[c.j] += step;
    }
    for (const group of groups) {
      let drift = 0;
      for (const n of group) drift += values[n] - start[n];
      drift /= group.length;
      for (const n of group) values[n] -= drift;
    }
  }
}

/**
 * The traced lines as a drawing in centimetres, with every typed length
 * honoured and every corner still a corner.
 */
export function fitTracedLines(lines: TracedLine[], options: FitOptions): FitResult {
  const opt = { ...DEFAULTS, ...options };
  const scale = opt.cmPerPoint;

  // ── endpoints to nodes ────────────────────────────────────────────────────
  const nodes = new Nodes();
  const seedX: number[] = [];
  const seedY: number[] = [];
  const ends: Array<{ a: number; b: number }> = [];

  const addPoint = (p: Pt): number => {
    const x = p.x * scale;
    const y = p.y * scale;
    for (let i = 0; i < seedX.length; i++) {
      if (Math.hypot(seedX[i] - x, seedY[i] - y) <= opt.joinTolCm) return nodes.find(i);
    }
    const id = nodes.add();
    seedX.push(x);
    seedY.push(y);
    return id;
  };

  for (const line of lines) {
    ends.push({ a: addPoint(line.a), b: addPoint(line.b) });
  }

  // Averaged so a corner sits between the ends that met there, rather than on
  // whichever of them happened to be traced first.
  const count = new Map<number, number>();
  const sumX = new Map<number, number>();
  const sumY = new Map<number, number>();
  for (let i = 0; i < seedX.length; i++) {
    const root = nodes.find(i);
    count.set(root, (count.get(root) ?? 0) + 1);
    sumX.set(root, (sumX.get(root) ?? 0) + seedX[i]);
    sumY.set(root, (sumY.get(root) ?? 0) + seedY[i]);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  const index = new Map<number, number>();
  for (const root of count.keys()) {
    index.set(root, xs.length);
    xs.push(sumX.get(root)! / count.get(root)!);
    ys.push(sumY.get(root)! / count.get(root)!);
  }
  const nodeOf = (end: number) => index.get(nodes.find(end))!;

  const startX = xs.slice();
  const startY = ys.slice();

  // ── statements about where things sit ─────────────────────────────────────
  const xConstraints: Constraint[] = [];
  const yConstraints: Constraint[] = [];
  const axes: Array<'h' | 'v' | 'free'> = [];
  const measured: number[] = [];
  const skewed: string[] = [];

  lines.forEach((line, k) => {
    const i = nodeOf(ends[k].a);
    const j = nodeOf(ends[k].b);
    const angle = segAngleDeg({ a: line.a, b: line.b });
    const axis: 'h' | 'v' | 'free' =
      angleGap(angle, 0) <= opt.orthoTolDeg ? 'h' : angleGap(angle, 90) <= opt.orthoTolDeg ? 'v' : 'free';
    axes.push(axis);

    const dx = (line.b.x - line.a.x) * scale;
    const dy = (line.b.y - line.a.y) * scale;
    measured.push(Math.hypot(dx, dy));

    if (axis === 'free') {
      // Not square, so its length cannot be a difference of rails. It still
      // follows its corners; it just cannot be told what to be.
      if (line.lengthCm !== undefined) skewed.push(line.id);
      return;
    }

    const typed = line.lengthCm !== undefined && line.lengthCm > 0;
    const along = typed ? line.lengthCm! : Math.abs(axis === 'h' ? dx : dy);
    const sign = (axis === 'h' ? dx : dy) < 0 ? -1 : 1;
    // A typed length is near-rigid; a scaled one gives way to it.
    const stiffness = typed ? 0.9 : 0.12;

    if (axis === 'h') {
      xConstraints.push({ i, j, target: sign * along, stiffness });
      // Both ends of a horizontal wall are level: that is what keeps it straight.
      yConstraints.push({ i, j, target: 0, stiffness: 0.9 });
    } else {
      yConstraints.push({ i, j, target: sign * along, stiffness });
      xConstraints.push({ i, j, target: 0, stiffness: 0.9 });
    }
  });

  // Connected groups, so each is re-centred on its own and an island of lines
  // does not drag the rest of the drawing with it.
  const groupOf = new Map<number, number[]>();
  for (let n = 0; n < xs.length; n++) groupOf.set(n, [n]);
  const linked = new Nodes();
  for (let n = 0; n < xs.length; n++) linked.add();
  for (const c of [...xConstraints, ...yConstraints]) linked.union(c.i, c.j);
  const groups = new Map<number, number[]>();
  for (let n = 0; n < xs.length; n++) {
    const root = linked.find(n);
    const list = groups.get(root);
    if (list) list.push(n);
    else groups.set(root, [n]);
  }
  const groupList = [...groups.values()];

  relax(xs, xConstraints, groupList, opt.iterations);
  relax(ys, yConstraints, groupList, opt.iterations);

  // ── optional: sit the result on the drawing's own 5 cm rule ───────────────
  if (opt.snapCm > 0) {
    for (let n = 0; n < xs.length; n++) {
      xs[n] = Math.round(xs[n] / opt.snapCm) * opt.snapCm;
      ys[n] = Math.round(ys[n] / opt.snapCm) * opt.snapCm;
    }
    // Rounding can knock a typed length out by a centimetre or two, so the
    // stiff statements are settled once more - and only those, or the rounding
    // would simply be undone everywhere.
    const hard = (c: Constraint) => c.stiffness >= 0.9;
    relax(xs, xConstraints.filter(hard), groupList, Math.min(120, opt.iterations));
    relax(ys, yConstraints.filter(hard), groupList, Math.min(120, opt.iterations));
  }

  // ── results ───────────────────────────────────────────────────────────────
  const fitted: FittedLine[] = lines.map((line, k) => {
    const i = nodeOf(ends[k].a);
    const j = nodeOf(ends[k].b);
    const a = { x: xs[i], y: ys[i] };
    const b = { x: xs[j], y: ys[j] };
    const lengthCm = Math.hypot(b.x - a.x, b.y - a.y);
    const moved = Math.max(
      Math.hypot(a.x - startX[i], a.y - startY[i]),
      Math.hypot(b.x - startX[j], b.y - startY[j]),
    );
    return {
      id: line.id,
      a,
      b,
      axis: axes[k],
      measuredCm: measured[k],
      ...(line.lengthCm !== undefined ? { targetCm: line.lengthCm } : {}),
      lengthCm,
      errorCm: line.lengthCm !== undefined ? lengthCm - line.lengthCm : 0,
      movedCm: moved,
    };
  });

  return {
    lines: fitted,
    paths: chainPaths(fitted, ends.map((e) => ({ a: nodeOf(e.a), b: nodeOf(e.b) }))),
    assigned: lines.filter((l) => l.lengthCm !== undefined).length,
    maxErrorCm: fitted.reduce((worst, l) => Math.max(worst, Math.abs(l.errorCm)), 0),
    maxMovedCm: fitted.reduce((worst, l) => Math.max(worst, l.movedCm), 0),
    skewed,
  };
}

/**
 * Lines that meet end to end, strung into runs.
 *
 * The drawing stores a wall as a polyline, not as loose pieces: a run that is
 * one line is one thing to select, to fill and to check. Where three lines meet
 * the run stops, because a junction is a decision the person traced, not a
 * corner to guess through.
 */
export function chainPaths(
  lines: Array<{ a: Pt; b: Pt }>,
  ends: Array<{ a: number; b: number }>,
): FitPath[] {
  const at = new Map<number, number[]>();
  ends.forEach((e, k) => {
    for (const node of [e.a, e.b]) {
      const list = at.get(node);
      if (list) list.push(k);
      else at.set(node, [k]);
    }
  });

  const used = new Set<number>();
  const paths: FitPath[] = [];

  /** The one line continuing from `node`, or null at an end or a junction. */
  const next = (node: number, from: number): number | null => {
    const here = (at.get(node) ?? []).filter((k) => k !== from && !used.has(k));
    const degree = (at.get(node) ?? []).length;
    if (degree !== 2 || here.length !== 1) return null;
    return here[0];
  };

  const pointOf = (k: number, node: number): Pt => (ends[k].a === node ? lines[k].a : lines[k].b);
  const otherNode = (k: number, node: number): number => (ends[k].a === node ? ends[k].b : ends[k].a);

  // Starts and junctions first, so a run is walked from its end rather than
  // being cut in half by starting somewhere in the middle of it.
  const order = [...lines.keys()].sort((p, q) => {
    const degP = Math.min((at.get(ends[p].a) ?? []).length, (at.get(ends[p].b) ?? []).length);
    const degQ = Math.min((at.get(ends[q].a) ?? []).length, (at.get(ends[q].b) ?? []).length);
    return degP - degQ;
  });

  for (const seed of order) {
    if (used.has(seed)) continue;
    used.add(seed);

    let startNode = ends[seed].a;
    let endNode = ends[seed].b;
    // Walk from the end that looks like a start.
    if ((at.get(startNode) ?? []).length === 2 && (at.get(endNode) ?? []).length !== 2) {
      [startNode, endNode] = [endNode, startNode];
    }

    const points: Pt[] = [pointOf(seed, startNode), pointOf(seed, endNode)];
    let node = endNode;
    let from = seed;
    for (;;) {
      const step = next(node, from);
      if (step === null) break;
      used.add(step);
      node = otherNode(step, node);
      points.push(pointOf(step, node));
      from = step;
      if (node === startNode) break; // closed loop
    }

    const closed = points.length > 3 && node === startNode;
    if (closed) points.pop();
    paths.push({ points, closed });
  }

  return paths;
}

/** Moves a set of runs so the whole drawing starts at `margin`, in cm. */
export function originAt(paths: FitPath[], margin = 50): FitPath[] {
  const all = paths.flatMap((p) => p.points);
  if (!all.length) return paths;
  const minX = Math.min(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  return paths.map((p) => ({
    closed: p.closed,
    points: p.points.map((pt) => ({
      x: Math.round((pt.x - minX + margin) * 10) / 10,
      y: Math.round((pt.y - minY + margin) * 10) / 10,
    })),
  }));
}
