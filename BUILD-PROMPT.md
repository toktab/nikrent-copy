# Build Prompt — Du Formwork Drawer (v1)

Copy everything below the line into Claude Code (or any coding agent) to start the first real version.

---

## Role & goal

You are building the **first production version** of a 2D drawing/editor tool for construction companies — a "drawer" for column formwork, conceptually similar to **DokaCAD**. Users pick prefabricated formwork materials from a catalog, drag them onto a 2D surface, and assemble a column formwork layout using approximately-correct real-world sizes. The output is a visual layout plus an automatic bill of materials (BOM).

A working single-file HTML prototype already exists (`Du-Formwork-Editor.html`) that proves the core drag-drop mechanic. Your job is to turn that concept into a proper, maintainable project.

## Tech stack

- **React + TypeScript + Vite**.
- **Konva.js** (`react-konva`) for the 2D canvas — it handles zoom/pan, transforms, hit detection, and export better than raw DOM.
- **Zustand** for state (pieces, selection, view). Keep state serializable.
- **Tailwind CSS** for UI chrome (toolbar, palette, inspector). Canvas itself is Konva.
- No backend in v1. Persist to `localStorage` and support JSON export/import. Keep the data layer isolated so a backend can be added later.
- Metric units throughout: internal unit = **centimeters**.

## Core concepts / data model

```ts
type Category = "panel" | "waler" | "corner" | "post" | "filler" | "rod" | "acc";

interface Material {
  id: string;          // stable slug
  name: string;        // Georgian display name
  category: Category;
  w: number;           // cm
  h: number;           // cm
}

interface Piece {
  id: string;          // instance id
  materialId: string;
  x: number;           // cm, top-left in world space
  y: number;           // cm
  rot: 0 | 90 | 180 | 270;
}

interface Project {
  version: number;
  name: string;
  pieces: Piece[];
  view: { zoom: number; panX: number; panY: number };
}
```

## Material catalog (seed data — sizes are approximate, cm: width × height)

Group by category. These are the exact 41 items to ship with.

**panel** — პანელი 30×300, 45×150, 45×300, 60×150, 60×300, 75×90, 75×150, 75×300, 90×300
**waler** — waler 100 (100×12), 120 (120×12), 150 (150×12), 300 (300×12), 600 (600×12)
**corner** — გარე კუთხე 300 (15×300), შიდა კუთხე 20×20×150 (20×150), შიდა კუთხე 20×20×300 (20×300), შიდა კუთხე 20×20×300 ჯონი (20×300), კუთხის თეფში (15×15), კუთხის კონექტორი (8×8), კუთხის კონექტორი 40სმ (8×40)
**post** — დგარი 100 (10×100), დგარი 200 (10×200)
**filler** — ჩაკერება 5×150, 5×300, 10×150, 10×300 (widths 5/10, heights as named)
**rod** — ჭანჭიკი (შტირი) 0,60 (60×3), 0,80 (80×3), 100 (100×3), 150 (150×3)
**acc** — კაუჭი ამწესთვის (15×25), პანელზე სამაგრი კომპლექტი (12×12), პანელის ბეტონზე სამაგრი (12×12), ქანჩი + დისკო (8×8), ჩამკეტი fix (10×20), ჩამკეტი რეგულირებადი (10×25), ძირის სამაგრი (15×15), ხარაჩოს ფეხი (20×30), გილზა ფიქსატორის (5×15), ქანჩი (გაიკა) ფიქსატორის (6×6)

Put this catalog in a single `src/data/materials.ts` file so it is easy to edit and later replace with real spec-sheet dimensions. Assign each category a distinct color.

## Features (v1 scope)

1. **Material palette** (left): categorized, collapsible, searchable, each item shows name + dimensions + a scaled color swatch. Items are draggable onto the canvas.
2. **Canvas surface** (center): Konva stage with a metric grid (minor 20cm, major 100cm) and rulers in cm. Wheel zoom (cursor-anchored), pan via space+drag or middle mouse, "fit to content" button.
3. **Place**: drop a material to create a `Piece` at the cursor at true scale.
4. **Manipulate**: select (click), move (drag), rotate 90° (`R` / button), delete (`Del`). Snap-to-grid toggle with selectable step (1/5/10/25 cm). Snapping applies on drop and move.
5. **Inspector** (right): selected piece details (name, category, size, position, rotation) and a live **bill of materials** — counts per material + total.
6. **Persistence**: autosave to localStorage; Export/Import project as JSON; "New/Clear" with confirm.
7. **Export layout**: export the canvas as **PNG** (and stub a PDF export path for a later milestone).

## Non-goals for v1 (note but don't build)

Multi-page projects, cloud sync/auth, wall/column outline drawing, collision/fit validation, cost pricing, real component thumbnails, undo/redo history (nice-to-have — implement if cheap via Zustand middleware).

## Project structure

```
src/
  data/materials.ts
  store/useProject.ts        // zustand
  components/
    Palette.tsx
    Canvas.tsx               // react-konva stage, grid, pieces
    PieceShape.tsx
    Toolbar.tsx
    Inspector.tsx
  lib/
    grid.ts                  // snap, ruler steps
    persist.ts               // localStorage + JSON import/export
    exportImage.ts
  App.tsx  main.tsx  index.css
```

## Milestones (build in this order, keep each runnable)

1. Scaffold Vite + TS + Tailwind + Konva. Render an empty grid canvas with zoom/pan.
2. Load catalog, render the palette, implement drag-from-palette → drop-to-place at scale.
3. Selection, move, rotate, delete, snap-to-grid.
4. Inspector + live BOM.
5. localStorage autosave + JSON export/import.
6. PNG export + "fit to content".

## Acceptance criteria

- All 41 materials appear in the palette under the right category with correct dimensions.
- Dropping `პანელი 45×300` renders a rectangle that is 45cm wide × 300cm tall relative to the grid at any zoom.
- Rotating a piece 90° swaps its on-canvas footprint; snapping keeps pieces aligned to the chosen grid step.
- The BOM count updates immediately on add/delete and matches what's on canvas.
- Reloading the page restores the last layout; JSON export then import reproduces the layout exactly.
- Type-checks clean (`tsc --noEmit`), builds clean (`vite build`), no console errors.

## Conventions

Small, focused components; no business logic in JSX. Keep all dimensions in cm and convert to pixels only at render time (`pxPerCm = zoom`). Comment the coordinate math. Write a short `README.md` with run instructions.

Start with milestone 1 and show me the running scaffold before moving on.
