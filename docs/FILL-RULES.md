# How a run gets filled - the ruleset

The rules the fill recommendations (`src/lib/fillOptions.ts`) follow when they
propose ways to cover a drawn line with panels and ჩაკერება. This file grows as
rules are confirmed with the architect who fills drawings by hand today.

Every rule has a status:

- **CONFIRMED** - said by the architect, or already how the tool has to work
  (`docs/FORMWORK.md`, `CLAUDE.md`).
- **PROPOSED** - the tool follows it now, but it needs a yes or no.
- **OPEN** - a question to ask. When answered, move it up and note the date.

Each rule names what enforces it, so this file and the code stay in step.

---

## The one piece of arithmetic behind all of it

Every panel width in the catalog - 30, 45, 60, 75, 90 - is a multiple of **15**,
and the drawing is ruled in 5 cm. So panels alone can only ever cover a length
that divides by 15, and whatever is left over has to be ჩაკერება:

| run length mod 15 | fillers needed |
|---|---|
| 0 | none |
| 5 | one 5 cm |
| 10 | one 10 cm |

Two fillers (5 + 5, 10 + 10) are therefore never *needed*. They only happen when
a panel choice was worse than it had to be - which is exactly why the architect
says a second filler "loses the idea" even though it is not forbidden.
Enforced by: `fillerRemainder()`, and the extra-filler penalty below.

---

## CONFIRMED

**R1 - Exact.** Panel widths plus fillers add up to the run length exactly. No
gap, no overhang. Enforced by: every variant is an exact sum; lengths that no
allowed combination reaches produce a warning, not a near miss.

**R2 - Start from 90.** Among ways to cover a run, the fewest pieces wins, which
means the widest panels first. Fewer pieces is fewer joints to leak, fewer
clamps and ties to supply, fewer crane moves, less assembly and strip-down time.
Among variants with the same piece count, more 90s wins - the way it is done by
hand: lay 90s until they stop fitting, then take what is left. Enforced by:
`pieces` is the heaviest score term; `nonWidest` breaks ties toward more 90s and
outranks P4.

**R3 - A filler only closes.** ჩაკერება close what panels cannot; they never
build a face. At most three close a strip. Enforced by: `maxFillers` (default 2,
hard cap 3, `CLOSURE_PIECES` in `formwork.ts`).

**R4 - A second filler is allowed but bad.** Not forbidden, but it loses the
idea. Enforced by: `extraFiller` penalty per filler beyond the first in a
course, and a much larger `adjacentFillers` penalty when two sit side by side.

**R5 - The filler sits between size groups.** Biggest panels, then the filler,
then the smaller ones: `90 90 90 | 10 | 75 75 60`. With only one size group
there is no "between", and it goes at the end. A second filler goes between the
next two groups, so fillers do not end up side by side. Enforced by:
`layOrder()`.

**R6 - Both faces of a wall get the same sequence**, facing each other, so tie
rods meet. Enforced by: `pairFaces` in `sketchFill.ts`; a variant is one face's
sequence and its counts are multiplied by `faces`.

**R7 - Corners.** Inside corner: one 20 cm L profile. Outside corner: nothing,
left open and measured. See `docs/FORMWORK.md`. The run length handed to the
recommendations is what is left between corners.

**R8 - No walers, ties or props.** Decided on site against the pour rate.

---

## PROPOSED (the tool does this until told otherwise)

**P1 - Same widths stay grouped.** `90 90 75 75`, never `90 75 90 75`.
Enforced by: `layOrder()`.

**P2 - One filler of `length mod 15`.** See the arithmetic above. Enforced by:
the ranking (a single filler always beats two at the same panel count).

**P3 - One tall course beats a stack.** A 300 cm pour is one course of 300
panels rather than 150 + 150, because it is half the pieces - unless the
**fewer 300s** filter is on. Note that stacking changes what widths exist: 90
comes only at 300; 75 at 90, 150 and 300; 60 and 45 at 150 and 300. Enforced by:
`pieces`, and `fewer300` adds a penalty per 300-high panel.

**P4 - 30 and 45 only when needed.** A narrow panel is weaker and more
handling. Enforced by: `narrow` penalty per 30 or 45, weaker than R2 - it only
chooses between variants with the same number of 90s. So `8×90 + 45` still
beats `6×90 + 3×75` at 765 cm, and `5×90 + 30` beats `4×90 + 60 + 60` at 480 cm.

**P5 - Fewer different sizes.** At the same piece count, fewer distinct widths
is simpler to deliver and assemble. Enforced by: `distinct` penalty.

**P6 - Stacked courses of one height use the same sequence.** In 150 + 150,
both courses get the same widths in the same order, so joints line up. See Q3.

---

## OPEN - ask the architect

**Q1.** Should the filler sit at the same position on both faces? (R6 implies
yes; confirm.)

**Q2.** At the same piece count, which does he prefer: `2×75` or `90 + 60`?
(Now: `90 + 60`, by R2.)

**Q3.** In a 150 + 150 stack, must the vertical joints of the two courses line
up? (Now: yes, P6.)

**Q4.** Is there a real cost per size - rental price, weight - that should
outrank piece count?

**Q5.** Is a filler ever preferred next to a corner rather than between size
groups?

**Q6.** R2 vs P4: is "most 90s, then whatever is left" right even when what is
left is a narrow panel? At 765 cm: `8×90 + 45` or `6×90 + 3×75`? At 480 cm:
`5×90 + 30` or `4×90 + 60 + 60`? (Now: the first of each. The **spare 90s**
filter gives the second.)

---

## Filters (change the ranking, never the rules)

| filter | effect |
|---|---|
| fewer 300s (`fewer300`) | penalty per 300-high panel, so stacked courses rise |
| spare 90s (`spare90`) | penalty per 90, so variants with the same piece count but fewer 90s rise |
| exclude widths (`excludeWidths`) | those widths are not used at all |
| max fillers (`maxFillers`) | 0 to 3 per course |
| stock (`useStock`) | a variant needing more than is free sinks below every one that fits; free = stock minus what the **open drawing** already uses, the same figure as the ნაშთი tab (other drawings are the architect's call) |
| sort (`sort`) | `pieces` (default), `fillers`, or `scarce` (spare what other drawings need) |

## Learning loop

When recommendations are applied (phase 2 on), record which rank was picked
and with which filters. Where the architect keeps picking #3 over #1, a rule
is missing from this file.
