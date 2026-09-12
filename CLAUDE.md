# კუბი - concrete formwork planner

A planning tool for a formwork **rental** company. You draw a layout in plan and
it works out the panels, fillers and corner profiles to deliver, what they weigh,
what is in stock, and what is left open for the site to decide.

React 18 + Vite 6 + TypeScript + Zustand + Supabase. UI text is **Georgian**.

## Commands

```bash
npm test          # vitest, 600+ tests - run this before every commit
npm run typecheck # tsc --noEmit
npm run build     # typecheck + vite build
```

There is no lint script. Use the Browser pane (`preview_start` with
`du-formwork-solo`, port 5175) to see the app - never `npm run dev` in Bash.

## The one thing to read first

`docs/FORMWORK.md` is the domain model - what a drawn line MEANS, which side the
panels go, how corners are treated, how the two faces of a wall are matched. It
is short, and it is the thing that is expensive to re-derive from the code.
Getting it wrong produces formwork standing inside the concrete, which is the
single most common bug in this project's history.

`docs/STATE-AND-SYNC.md` is the other one worth reading before touching the
store: two storage modes, why `pieces` is a mirror of the active document, when
to use `commit` against `apply`, and the rehydration trap that silently drops a
saved drawing.

## Where things live

| what | where |
|---|---|
| the fill generator - drawn layout to pieces | `src/lib/sketchFill.ts` |
| catalog maths - covering a face with panels | `src/lib/formwork.ts` |
| the drawn layout itself - legs, vertices, snapping | `src/lib/sketch.ts` |
| plan geometry, grid, zoom | `src/lib/geometry.ts` |
| open-gap detection between placed pieces | `src/lib/gap.ts` |
| lengths on the drawing - which show, where, stacking | `src/lib/dimensions.ts`, `src/components/DimensionLayer.tsx` |
| measure tool (გაზომვა) - snapping helper, saved lines | `src/lib/measure.ts`, `src/components/MeasureLayer.tsx` |
| drawing export / import file | `src/lib/catalogFile.ts` |
| all state, undo, persistence, sync | `src/store/useEditorStore.ts` |
| the canvas | `src/components/StageCanvas.tsx`, `SketchLayer.tsx` |

## Conventions that are easy to get wrong

- **Plan view.** A "პანელი 90*300" is drawn 90 wide by 9 DEEP. The 300 is height
  and points out of the page. Always go through `planW` / `planH`.
- **The drawing is ruled and snapped in 5 cm** (`DRAW_STEP_CM`). Nothing finer -
  there is deliberately no 1 cm option any more.
- **Georgian UI text**, and in it: plain hyphens, never em dashes, and spaces
  either side of a `+`.
- Comments explain **why**, at the density of the surrounding code. This codebase
  is heavily commented on purpose; match it.
- Never place walers, ties or props. They are decided on site against the pour
  rate, and a guessed count on a delivery note is worse than none.

## Testing

Three layers, all of which must stay green:

1. `src/lib/__tests__/sketchFill.test.ts` - named examples, including shapes that
   came off real drawings and used to be wrong.
2. `src/lib/__tests__/sketchFillInvariants.test.ts` - a seeded generator draws
   179 layouts and holds every one to six statements.
3. `src/lib/__tests__/scenarios.ts` + `scenarioFill.test.ts` - the shapes a real
   job contains, each with a written spec of what a correct fill looks like.

**Do not skip a failing test to get a green suite.** If something cannot be
fixed, say so in the reply and leave it visible.
