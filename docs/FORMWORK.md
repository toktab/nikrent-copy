# What a drawn line means

The rules the fill implements. Every one of these was learned by getting it
wrong first, so changing one without reading the reason is expensive.

## A line is a concrete FACE, not a centreline

```
   ▓▓▓▓▓▓▓ panels ▓▓▓▓▓▓▓▓   9 cm, outside the pour
   ───────drawn line──────   ← what you drew: the face itself
   ░░░░░░░ concrete ░░░░░░
```

The person setting out chalks the edge of the pour, not a line up the middle of
it that nothing can be measured from. **A wall is two lines, one per face.** The
tool therefore never needs a thickness, and a wall with one face already built
is an ordinary thing to draw rather than a special case.

## Which side the panels stand on

Formwork stands OUTSIDE the pour, always. This is never a preference. The answer
is resolved for the whole job at once, in this order:

1. **`spec.flip`** - the escape hatch. Absolute; nothing overrules it.
2. **The neighbouring face.** Two parallel legs closer together than a wall is
   thick have the POUR between them, so each faces away from the other. Every
   leg listens to its NEAREST facing neighbour, and only legs of DIFFERENT lines
   vote. The vote is per LINE, not per leg, because one scalar drives the corner
   treatment as well as the panels.
3. **The shape, plus `perimeter`.** The shoelace winding says which side the run
   encloses; `perimeter: 'inner'` inverts it, for a room, a shaft, or the void a
   wall's second face bounds.

Why the neighbour beats the winding: on an open zigzag the shoelace sum is a
small number whose SIGN turns on the proportions. Two lines that were exact
parallel offsets of each other came out at -2975 and +14875 and were handed
opposite answers. A face 15 cm away is hard evidence; that winding is not.

Two opposite legs of the SAME line are the genuinely ambiguous case - a narrow
column has its pour between them, a lift shaft has its void - which is why
same-line legs never vote and `perimeter` is still needed.

## Corners come from the shape, not from the vertex list

People put junctions on a drawing to measure from and to hang the next wall off.
A vertex the run goes straight through is a mark, not a bend. `cornersOnly()`
strips them before anything is planned.

- **Inside (concave) corner**: exactly one 20 cm L profile, standing in the
  notch, placed FIRST. It is a fixed part in a fixed place, so it is the datum
  the runs measure from, and the panels are laid away from it.
- **Outside (convex) corner**: NO piece at all. Both runs stop at least 20 cm
  short. There is more than one right answer on site, so it is handed over as a
  measured hole rather than a part somebody has to take off again.
- **The end of a pour** - a short leg spanning from one face to the other - is
  left open the same way. It is not a third face.

A leg its own two corners have eaten is reported, never built. Measure the run
ALONG the direction of travel: a 25 cm leg giving 20 cm at each end has its
start 15 cm PAST its end, and sorting those into a low and a high turns -15 into
+15 and lays panels back across the corner.

## The two faces of a wall get identical panels

Tie rods pass through the pour, so a panel on one face needs a panel facing it
on the other. `pairFaces()` finds two runs with the pour between them, brings
them onto a common extent and lays one panel sequence on both.

Any end may give way to make that happen, by at most **the pour thickness** -
the only honest reason two faces differ in length is the corner. Unbounded, this
once shortened a five-metre face to the 30 cm it shared with a wall across a
corridor. Candidates are ranked NEAREST first, not by overlap: the true partner
is routinely the shorter of the two, because that is what a corner does to it.

## Nothing is lost quietly

Every stretch of face with nothing on it is reported as an `Opening` with a
length and a position: outside corners, pour ends, legs too short to build, and
anything the catalog cannot close. A hole you have been told about is a
decision; one you have not is a leak.

## Numbers

| | |
|---|---|
| panel depth | 9 cm |
| panel widths | 90 / 75 / 60 / 45 / 30 |
| ჩაკერება fillers | 10 / 5 |
| inner corner profile | 20 x 20, reaches 20 cm along each face |
| outside corner left open | 20 cm of each face, plus any given up to match |
| drawing grid and snap | 5 cm |
| widest thing treated as one wall | 120 cm (`MAX_WALL_CM`) |
| furthest two faces can face each other | 300 cm (`MAX_FACING_CM`) |

The last two are estimates, not measurements from real jobs. Worth revisiting.
