# Build Prompt: Du Formwork Editor v2 (React project)

Paste this whole file to Claude Code as the task. It rebuilds the existing single-file
prototype (`Du-Formwork-Editor.html`, in this same folder) into a proper React project and
adds component creation, a bill-of-materials, and inventory tracking.

---

## Context

There is a working prototype in this repo: `Du-Formwork-Editor.html`. It is a 2D drag-and-drop
editor for **Du column formwork** used by a construction company (concept: like DokaCAD for Revit).
The user drags materials from a palette onto a metric grid surface (units = centimetres), where
each piece renders at its approximately-correct real-world size. It already supports: palette
grouped by category, drag-drop placement at scale, select/move/rotate(90°)/delete, snap-to-grid,
zoom (wheel), pan (space+drag / middle mouse), cm rulers, a basic count panel, and JSON
export/import + localStorage autosave.

**Reuse the seed catalog and sizing logic from that HTML file.** The material data (41 items,
their categories and cm dimensions) is defined in the `<script>` block — extract it verbatim into
the new project's seed data. Do not lose any of the 41 items or change their sizes.

## Goal

Rebuild as a real project (do **not** keep it as one HTML file). Preserve every existing editor
feature, then add the four capability groups below.

## Tech stack

- **React + Vite + TypeScript**
- State: Zustand (or React context + reducer) — keep it simple, single store.
- Rendering the canvas: keep the current DOM/transform approach OR use react-konva if it makes
  drag/rotate/hit-testing cleaner. Pick whichever is more maintainable; document the choice.
- **Excel/CSV**: SheetJS (`xlsx`) for import and export.
- **PDF**: jsPDF + html2canvas (export BOM, optionally with a snapshot of the drawing).
- Persistence: `localStorage` for autosave **and** file-based catalog export/import (JSON).
- Clean folder structure: `src/components`, `src/store`, `src/data` (seed catalog), `src/lib`
  (bom, export, import helpers), `src/types.ts`.

## Data model

```ts
type Category = 'panel' | 'waler' | 'corner' | 'post' | 'filler' | 'rod' | 'acc';

interface Material {
  id: string;            // stable id (slug or uuid); built-ins keep a fixed id
  name: string;          // Georgian display name, e.g. "პანელი 45*300"
  category: Category;
  w: number;             // width  in cm
  h: number;             // height in cm
  shape: 'rect' | 'L' | 'line';
  color: string;         // hex; default from category
  builtin: boolean;      // true for the original 41; false for user-created
  stock: number;         // inventory: how many the company owns (default 0, editable)
}

interface Piece {         // a placed instance on the surface
  id: string;
  materialId: string;
  x: number; y: number;   // cm, top-left in world coords
  rot: number;            // 0/90/180/270
}
```

Keep a `categories` map with a Georgian label + default color for each category (copy from the
HTML). Allow user-defined categories only if trivial; otherwise the 7 fixed categories are fine.

---

## Feature 1 — Component creation & management

- **"+ New component" button** opens a form: name, category (dropdown), width (cm), height (cm),
  shape (rect / L-shape / line), color (color picker, defaults to the category color).
- **Edit** any component (including the 41 built-ins) via a pencil icon on each palette row —
  same form, pre-filled. Editing a material updates all placed pieces of that type live.
- **Delete** a component. If pieces of that type are on the surface, warn and either block or
  cascade-delete (ask via a confirm dialog).
- **Bulk import from spreadsheet**: upload or paste an Excel/CSV with columns
  `name, category, width_cm, height_cm, shape?, color?, stock?`. Show a preview table, let the
  user confirm, then add all rows to the catalog. Validate types and report bad rows.
- Render the actual **shape** on the canvas and in the palette swatch: `rect` = filled rectangle,
  `L` = L-profile corner, `line` = thin bar (for walers/rods). Approximate is fine.

## Feature 2 — Persistence (Both)

- **Autosave** the full state (catalog + placed pieces + inventory) to `localStorage` on every
  change, restore on load.
- **Catalog file**: export the catalog (materials incl. custom + stock) to a JSON file, and
  import one, so it can be shared across computers. Keep this separate from the **layout**
  export (placed pieces) so a user can share a catalog without their drawing.

## Feature 3 — Bill of materials (BOM)

- **On-screen live panel**: list every component currently used, grouped by category, with
  quantity per component and a subtotal per category and a grand total piece count. Update live.
- **Totals / aggregates**: per category and overall — total piece count, total **length** in m
  (sum of the longer dimension for linear items like walers/rods), and total **area** in m²
  (sum of w×h for panels). Show a small summary card.
- **Export to Excel/CSV**: one click → a materials list with columns
  `Component, Category, Size (cm), Quantity, In stock, Remaining`. This is the ordering sheet.
- **Export to PDF**: printable BOM table; add an option to include a snapshot image of the
  current drawing above the table.

## Feature 4 — Inventory / stock

- Each component has an editable **stock** quantity (how many the company owns). Edit inline in
  the palette or in a dedicated Inventory panel/tab.
- Everywhere the BOM shows a used quantity, also show **In stock** and **Remaining**
  (`stock − used`). When `used > stock`, highlight the row red ("shortage") and surface a small
  warning badge/count in the header.
- Stock values persist with the catalog (autosave + catalog file).

---

## Feature 5 — Always-visible dimensions on the drawing

- Every placed piece shows its size (e.g. `45 × 300`) **directly on the drawing at all times** —
  no hover, no click, no selection required. The current prototype only shows a dimension tag on
  the selected piece; change this so all pieces are labelled.
- Show the component **name and size** on/near each piece. If a piece is too small to fit the
  text at the current zoom, draw the label just outside it (leader line optional) or shorten to
  the size only, so it never overlaps unreadably.
- Keep labels readable regardless of piece rotation (counter-rotate the text so it stays
  horizontal) and regardless of zoom (scale label font sensibly, hide only when genuinely too
  dense, e.g. very zoomed out — with a toggle to force-show).
- Add a small toolbar toggle **"Show dimensions"** (default ON) and optionally a second toggle
  for **"Show names"**, so the user can declutter when needed.
- Preferred CAD style: put the size text centered on the piece; for linear items (walers, rods)
  put the length along the bar. Keep it clean and legible on the dark background.

## Keep all existing behaviour

Drag-drop placement at correct cm scale, snap-to-grid (toggle + step select), rotate 90° (`R`),
delete (`Del`), move by drag, click-to-select, zoom (wheel + buttons),
pan (space+drag / middle mouse), fit-to-content, metric rulers, dark UI, Georgian labels.
Layout (placed pieces) export/import JSON stays.

## Deliverables & acceptance

- Runs with `npm install && npm run dev`. Include a short README with run steps.
- All 41 built-in Du materials present with unchanged sizes.
- I can: create a new component and drag it onto the surface; edit and delete components;
  bulk-import components from a spreadsheet; set stock per component; see a live BOM with
  quantities, totals, in-stock and remaining, with shortages highlighted; export the BOM to
  Excel and PDF; and have everything persist after a page reload. Every piece on the drawing
  shows its size without hovering or selecting, toggleable via "Show dimensions".
- Keep the code readable and componentised; add brief comments on the canvas math (world↔screen).

## Notes on sizing (from the prototype)

Sizes are approximate, derived from the names: e.g. `პანელი 45*300` = 45×300 cm; walers/tie-rods
are sized by their length with a thin profile; small hardware has representative sizes. Preserve
these. A real spec sheet may be supplied later to correct exact dimensions — keep sizes easy to
edit centrally (the catalog), which the component-edit feature already covers.
