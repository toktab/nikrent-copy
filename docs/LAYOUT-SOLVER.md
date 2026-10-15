# Layout solver - how the architect fills a wall, and the plan to copy it

Status: implemented 2026-10-15 in `src/lib/layoutSolver.ts` (tests: `layoutSolver.test.ts`).
Written before the code; section 8 records where the code ended up differing.

The fill we have (`sketchFill.ts` + `fillOptions.ts`) is exact: every face is
covered between its corners to the centimetre, an outside corner is left open
20 cm, and the odd 5 or 10 goes between size groups. It works, but it is not how
the architect fills a real job. His example (`exported/du-layout-2026-10-14*.json`,
"ნახაზი 1") does four things the fill cannot, and this document reads them off
the file and turns them into an algorithm.

## 1. What the example contains

Two lines, one inside the other:

- **შიდა (inner) line**: a closed rectangle 355 x 170, `(100,100)-(455,270)`.
  Its panels stand INSIDE it (the room), so its four corners are inside corners.
- **გარე (outer) line**: drawn as two pieces that meet end to end - a straight
  `(100,80)-(455,80)` and an open run round the other three sides. Together
  they are a closed rectangle `(85,80)-(475,280)`. Its panels stand OUTSIDE it,
  so its four corners are outside corners.
- The wall between them is 20 thick at the top and right, 15 at the left and
  10 at the bottom.

What he placed (world cm, along each face):

| face | pieces, in order | span | line |
|---|---|---|---|
| inner top | L · 90 90 90 45 · L | 120-435 | 100-455 |
| inner bottom | L · **ჩ10** · 90 90 30 90 · **ჩ5** · L | 120-435 | 100-455 |
| inner left | L · **ჩ5** · 60 60 · **ჩ5** · L | 120-250 | 100-270 |
| inner right | L · **ჩ5** · 60 60 · **ჩ5** · L | 120-250 | 100-270 |
| outer top | 45 · 90 90 90 · 45 · 60 | **75-495** | 85-475 |
| outer bottom | 45 · 90 90 30 90 · 45 | 85-475 | 85-475 |
| outer left | 45 · 60 60 · 45 | 80-**290** | 80-280 |
| outer right | 45 · 60 60 · 45 | 80-**290** | 80-280 |

38 panels and fillers, 4 inner corner profiles, nothing left open.

## 2. The rules read off it

**A1 - Outside corners are lapped, not left open.** At every outside corner one
face runs THROUGH - past the end of its line by at least one panel depth (9 cm)
so its last panel covers the end of the other face - and the other face BUTTS
exactly at the line's end, under it. Top-left: the top row runs to x=75 (needs
76), the left column starts at y=80. Bottom-left: the left column runs to
y=290 (needs 289), the bottom row starts at x=85.

**A2 - Running through may overshoot.** The run-through end is only bounded
below. The top row needed to reach 484 and reaches 495 because the next panel
is a 60; the extra 11 cm in the air is cheaper than a filler on the outside.
This is the user's "the panels went past the line" - the line is a minimum,
not an exact length, wherever a panel can stick out into air.

**A3 - The two faces carry the same panels opposite each other.** Every panel
on the inner face has a panel of the same width at the same position on the
outer face (tie rods). The outer face is the inner sequence plus an END PIECE at
each end that reaches to its own corner: outer top = `[45] 90 90 90 45 [60]`
against inner `90 90 90 45`. The fillers on the inner face are not mirrored:
they face part of an outer end piece.

**A4 - Fillers go to the corner.** Every filler in the example touches an inner
corner profile. The left wall is 130 between profiles: one ჩ10 would be one
piece fewer, but `ჩ5 60 60 ჩ5` puts both inner joints at 125 and 245, so the
outer face closes with two 45s and no filler. The fillers are placed so the
OTHER face comes out in whole panels.

**A5 - (from the user, the architect's rule)** a **ჩ5 between two panels needs
a ნიანგი** clamp, and ნიანგები are scarce, so a ჩ5 always goes against a corner
(inner or outer) or the end of a run when it can. A **ჩ10** may go between two
panels or at a corner, either is fine.

**A6 - The thicker wall runs through.** At each outside corner the face that
runs through belongs to the thicker of the two walls; of two equal walls, the
longer face. Top-left: the 20 cm top over the 15 cm left. Top-right: 20 over
20, the longer top. Bottom corners: the 15 and 20 cm sides over the 10 cm
bottom. (Inferred from his job - every corner of it fits; to confirm with him.)

**A7 - No 30 beside a filler.** Inner bottom is `ჩ10 90 90 30 90 ჩ5`, not
`ჩ10 90 90 90 30 ჩ5`: the narrow panel moves one in so two weak strips do not
sit together, and otherwise the run stays widest first.

The user's rule (2026-10-15): given his lines, the #1 suggestion must be his
layout. `layoutSolver.test.ts` holds it to that, piece for piece.

## 3. What the user asked for (the brief)

1. Suggestions for a selected line may cross the line end: exact, or allowed
   past the start, the end, or both - a preference, not a rule.
2. ყველას შევსება over several lines at once (both squares, or one): suggest
   whole-layout variants automatically and finish the job in one click.
3. Filters: may it cross line ends, how far; which panel sizes to go easy on.
4. Panels placed by hand on a line are recognised. With **keep placed pieces**
   on, every suggestion builds around them; off, applying a suggestion replaces
   them.
5. A5 above.

## 4. The algorithm

Pure, in a new `src/lib/layoutSolver.ts`. The old `planSketchFillAll` stays as
it is (the fill dialog, the wall wizard and 600 tests use it); the
recommendation tab and ყველას შევსება move to the solver.

### 4.1 Faces, from lines

1. **Join** the selected lines end to end where endpoints meet (within 0.5 cm),
   so a face drawn in two strokes - like the example's outer line - is one
   chain, closed if it closes. Then `cornersOnly` drops the vertices the run
   goes straight through.
2. **Side** of every chain from `sidesFromNeighbours` (unchanged - the
   neighbour vote is what puts the inner panels in the room).
3. Each leg becomes a **face**: axis, line coordinate, panel side, and an
   **end condition** at each end:
   - inside corner with a profile: FIXED at the vertex +- profile reach (20);
   - inside corner with no profile: one side gives way by a panel depth (as now);
   - outside corner: LAP (A1) - decided per corner, see 4.4; or OPEN 20 when
     the corner filter is set to the old behaviour;
   - free end of a line: FIXED at the line end, or REACH `[end, end + max
     overhang]` when crossing is allowed at that end (filter: none / start /
     end / both, read in the line's drawing direction);
   - a hand-placed piece (keep on): FIXED at the piece's edge.

   An end condition is therefore one of `fixed(p)` or `reach(min, max)`.

### 4.2 Walls

Two faces are one wall when they are parallel, look away from each other, are
at most `MAX_WALL_CM` apart and share length - the test `pairFaces` already
uses, minus its length-trimming, which lapping replaces. Everything else is a
lone face.

### 4.3 Solving one wall for given end conditions

1. Pick a **reference face**: the one with more FIXED ends (the inner face,
   normally); try the other one too and keep both results.
2. **Enumerate reference sequences.** Its length is a range (FIXED-FIXED is one
   length; a REACH end adds every 5 cm step up to the max overhang). For each
   length: every panel multiset within `PIECE_WINDOW` of the fewest pieces (the
   `fillOptions` search), every filler set up to `maxFillers`, and every
   **arrangement** - size groups kept together (P1) in every group order, and
   each filler at the low end, the high end or between two groups.
3. **Derive the other face** (A3): take the reference panels that lie inside
   the other face's mandatory span, at the same positions. From the face's own
   end to the first kept panel is an **end gap**; close it with the fewest
   panels (plus one filler, at the corner end only, if FIXED and the gap is not
   a multiple of 15). A REACH end may overshoot up to its max. If a gap cannot
   be closed, drop the next panel into the gap and retry. Panels that end up
   unmatched are scored, not forbidden.
4. **Score** (lowest wins; the existing weights where a rule already exists):

   | term | weight | rule |
   |---|---|---|
   | each panel or filler, both faces, all courses | 1000 | R2 |
   | each filler, on top of that | 500 | R3 |
   | each filler not against a profile or a free line end | 2500 | A4 |
   | each lapped corner run through by the thinner wall | 1500 | A6 |
   | each 30 beside a filler (leading face) | 300 | A7 |
   | each broken size group (leading face) | 20 | P1 |
   | each ჩ5 between two panels | 3000 | A5 |
   | each ჩ10 between two panels | 0 | A5 |
   | each filler beyond the first on a face | 700 | R4 |
   | two fillers touching | 3000 | R4 |
   | each cm sticking out past a line or corner, beyond the 9 a lap needs | 4 | A2 |
   | each reference panel without its twin opposite | 5000 | A3 / R6 |
   | each distinct width | 200 | P5 |
   | each width below the widest | 60 | R2 |
   | each 30 or 45 | 40 | P4 |
   | each piece of a width the user marked "spare" | 400 | filter |
   | each cm of face left bare | 200 | - |
   | needs more than is free in stock | 1e9 | stock filter |

   Ties break on the sequence text, so the order is stable.
5. Keep the best `K` (12) per wall per end state.

### 4.4 Outside corners across the layout

Each outside corner is one binary choice - which of its two faces runs
through - and it touches exactly two walls. Every wall is solved for each
combination of its own corner choices (at most 2 x 2), so the whole layout is a
small sum: brute force over every assignment up to 2^12 corners, coordinate
descent from the best single choices beyond that. The `N` best assignments,
each with every wall at its best, are the **whole-layout variants**.

### 4.5 Courses

Unchanged: the fewest-courses stack, or another stack from the `fewer300`
filter. A height repeated in a stack repeats its sequence (P6). Widths that
exist only at some heights come from `optionsAt` per height.

### 4.6 Hand-placed pieces

A piece belongs to a face when its footprint lies against the face line on the
panel side (0.5 cm tolerance) and overlaps the face along the axis - the test
`lengthCheck` already makes. With **keep** on, those pieces split the face:
each stretch between them is solved as a face of its own with FIXED ends at the
pieces, and a kept panel on one face of a wall becomes a required panel at the
same place on the other. With keep off, applying removes them and builds the
suggestion in their place.

### 4.7 Output

A `LayoutVariant` per whole-layout answer: the pieces to add, the ids to
remove, totals, overhang cm, fillers by kind, warnings, and per wall its
chosen sequence and alternatives. The recommendation tab shows the variants
best first (hover previews, click picks, one button applies as one undo step).
The list mixes the best corner choices with the best choice where one wall at a
time takes its next answer, so per-wall alternatives are cards of their own.

## 5. UI changes

- Recommendation tab: whole-layout variant cards on top; filters gain
  **გადაცილება** (none / both ends / start / end, plus max cm), **გარე კუთხე**
  (lap / leave open), **დასაზოგი ზომები** (spare widths) and **ხელით დადებულის
  შენარჩუნება** (keep placed pieces).
- ყველას შევსება uses the best whole-layout variant with the same filters, and
  no longer skips lines that already have pieces when keep is on.
- ცდომილება (`lengthCheck`) accepts a lapped corner and a run-through end, so
  the architect's own layout checks clean.

## 6. Tests

- The architect's layout: solving his two lines must give no open corners,
  every inner panel matched opposite, no ჩ5 between panels, and no more than his
  38 pieces.
- Each rule above gets a named example; the existing suites stay green.

## 7. Defaults chosen (change any on request)

- Outside corners: lap (the architect's way). Max overhang: 45 cm.
- Crossing a free line end: off (exact) until switched on.
- Keep placed pieces: on.
- ჩ10 between panels costs nothing extra, per the user's note.

## 8. As built

- Fillers cost 500 on top of the piece, and overhang 4 per cm, so that with
  crossing allowed a panel sticking out beats a filler at the same piece count
  (1000 cm allowed past its end: `11x90 + 30`, 20 cm out, not `11x90 + ჩ10`).
- On the architect's job the #1 variant is his layout exactly (38 panels and
  fillers). A 36-piece answer exists - his layout turned round, top butting
  instead of running through - and is listed lower: it breaks A6 at all four
  corners and puts two fillers on the outside faces (A4).
- ცდომილება now counts a piece past an outside corner as a lap when it reaches
  at least a panel thickness past it, and any overhang at a free line end.
- The old `planSketchFillAll` / `fillOptions` are untouched and still drive
  the fill dialog and the wall wizard; `planFillAll` is no longer used by the
  button.

## 9. Building outward from the inner face (2026-10-15)

The user's workflow: draw the შიდა line, fill it, then make the გარე line
round it and fill that.

- **Shift + click** on a line, or on a panel standing on one, picks up the
  joined lines and every piece on them (`connectedLines`, `piecesOnLines`).
  Ctrl + click adds or takes off one line.
- With a built line picked and nothing drawn alongside it, the recommendation
  tab offers **გარე ხაზის შექმნა**: one distance for every side, or one per leg
  (`offsetFace`, `src/lib/outerLines.ts`). It makes the line only, marked
  გარე, and picks it.
- A closed line picked alone brings whatever is inside it into the solve
  (`enclosed`), so the outer face is matched to the built inner one. A line
  marked შიდა with things inside it is offered a switch to გარე.
- With keep placed pieces on, the outer face is fitted round the inner face as
  it was built. Filled alone first, the inner face is not the one the
  architect would pick (it never saw the outer face), so his exact job comes
  back with keep OFF - both faces re-solved together - or by drawing the outer
  line before filling. Tested both ways in `layoutSolver.test.ts`.
