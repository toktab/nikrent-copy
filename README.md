# Du კოლონის ფორმვორკის რედაქტორი (v2)

2D drag-and-drop editor for **Du column formwork** — a metric (cm) drawing surface where
materials are placed at their approximately correct real-world size, with a live bill of
materials, inventory tracking and Excel/PDF export.

Rebuilt from the single-file prototype `Du-Formwork-Editor.html` (kept in the repo as the v1
reference) into a React + Vite + TypeScript project.

---

## Running it

Requires **Node.js 18+**. This machine has Node v24.18.1 installed at
`~/.local/node-v24.18.1-darwin-arm64/`; put it on your `PATH` with:

```bash
echo 'export PATH="$HOME/.local/node-v24.18.1-darwin-arm64/bin:$PATH"' >> ~/.zshrc
```

Then:

```bash
npm install && npm run dev
```

Then open the URL Vite prints — <http://localhost:5173> by default.

| script | what it does |
| --- | --- |
| `npm run dev` | dev server with hot reload |
| `npm run build` | typecheck (`tsc --noEmit`) then production build into `dist/` |
| `npm run preview` | serve the production build |
| `npm run typecheck` | types only |
| `npm test` | Vitest suite (100 tests over the pure logic) |
| `npm run test:watch` | tests in watch mode |

### Deploying it

`npm run build` produces a fully static `dist/` — no server code, no API, no database. Copy
it to any static host (a company file share served over HTTP, Netlify, GitHub Pages, an
nginx directory) and it runs. All data lives in the browser's `localStorage` per machine, so
share the **catalog JSON** to keep component data and stock in step across computers.

---

## Project layout

```
src/
  types.ts               Material, Piece, Category, Shape, file formats
  data/
    categories.ts        the 7 fixed categories: Georgian label + default colour
    seedCatalog.ts       the 41 built-in Du materials (verbatim from v1)
  store/
    useEditorStore.ts    single Zustand store + localStorage autosave
  lib/
    geometry.ts          world↔screen maths, bounds, snapping, ruler steps
    shapePath.ts         rect / L / line geometry, shared by SVG + canvas renderers
    bom.ts               live bill-of-materials aggregation
    excelExport.ts       SheetJS: BOM → .xlsx / .csv, catalog → .xlsx
    pdfExport.ts         html2canvas + jsPDF: printable BOM, paginated onto A4
    snapshot.ts          renders the drawing to a PNG for the PDF
    sheetImport.ts       SheetJS: bulk component import + validation
    catalogFile.ts       catalog/layout JSON export + import (incl. v1 layouts)
    files.ts             download / file-picker helpers
    ids.ts               stable material ids, piece ids
  components/            Header, Palette, StageCanvas, PieceView, LabelLayer,
                         Rulers, SidePanel, DetailsPanel, BomPanel,
                         InventoryPanel, MaterialFormDialog, SheetImportDialog,
                         Modal, ConfirmDialog, ShapeSvg
```

---

## Rendering choice: DOM + CSS transform (not react-konva)

The canvas keeps the prototype's approach — absolutely positioned `div`s inside a `#world`
layer that carries `translate(panX, panY) scale(zoom)` — for three reasons:

1. **Hit-testing is free.** Each piece is a real DOM node, so selection and drag are plain
   pointer events; no manual bounding-box maths, no separate hit graph.
2. **Labels are the hard part, and HTML is better at text.** Always-visible dimension
   labels need real text layout, ellipsis, and DOM-cheap re-flow on every pan/zoom. Konva
   would mean measuring text manually anyway.
3. **Less machinery.** No extra rendering library, no stage/layer lifecycle, and shapes are
   ordinary inline SVG that the palette swatch reuses verbatim.

Konva would win if the drawing grew to thousands of pieces or needed free rotation and
snapping guides. At the scale of a column formwork layout (tens to a few hundred pieces)
the DOM approach is comfortably fast and much easier to maintain.

### Canvas maths

World units are centimetres. The world layer is drawn at 1 cm = 1 px and then transformed:

```
screen = world * zoom + pan
world  = (screen - pan) / zoom
```

so `zoom` is literally *screen pixels per centimetre*.

### The drawing is a PLAN view

This is the single most important thing to understand about the model. A name like
**„პანელი 30*300"** means **30 cm wide and 300 cm tall**. The 300 is *height* — it points
vertically, up out of the page — so it is **not** drawn. What you see is the panel's width
and its thickness:

| field | meaning | drawn? |
| --- | --- | --- |
| `w` | width along the column face (30) | **yes** |
| `h` | height of the pour (300) | no — drives area, labels and panel courses |
| `depth` | plan thickness — **9 cm for every Du panel** | **yes** |

So a 30×300 panel appears as a 30 × 9 bar. `planW()` / `planH()` in `lib/geometry.ts` are the
only sanctioned way to ask how big a piece is on screen; everything that positions, hit-tests,
snaps, prints or bounds a piece goes through them. `defaultDepth()` in `data/seedCatalog.ts`
assigns thickness per category: 9 cm for panels and fillers, the square cross-section for
corners and posts, and the existing profile for walers, tie rods and accessories.

### Rotation

`Piece.rot` is **any angle in degrees**, not just quarter turns. `R` and the toolbar button
still step by 90° because that is the common case; the Details tab has an exact degree field
and a slider.

Rotation happens about a piece's **centre**, so `Piece.x/y` — the top-left of the *un-rotated*
box — is not where a turned piece's footprint starts. `rotatedExtent()` gives the true
on-screen extents at any angle, `pieceBounds()` the axis-aligned box, and the column wizard's
`placeAt()` converts "put the footprint's corner here" into the x/y to store. Getting that
wrong is exactly what made the first plan-view column land its turned faces off the concrete.

---

## Features

### Editor (all v1 behaviour preserved)

Drag-drop placement at true cm scale · click to select · drag to move · `R` rotate 90° ·
`Del` delete · snap-to-grid with a 1/5/10/25 cm step · wheel zoom (cursor-anchored) and
zoom buttons · fit-to-content · space+drag or middle-mouse pan · cm rulers · dark Georgian
UI · layout JSON export/import (also reads **v1 prototype layout files**, which referenced
materials by array index).

### 0 — Editing that survives real use

* **Undo / redo** — `⌘Z` / `⌘⇧Z` (or `Ctrl`), plus toolbar buttons. A drag, an array, a
  catalog edit or a bulk import is one step each; live dragging does not flood the history.
  Depth 80.
* **Multi-piece editing** — drag on empty surface for a rubber-band select, `Shift`-click to
  add or remove, `⌘A` to select all. Move, rotate, duplicate and delete all act on the whole
  selection; dragging any selected piece moves the group.
* **Duplicate and clipboard** — `⌘D` duplicates in place, `⌘C` / `⌘V` copy and paste, each
  offset by one grid step. Repeated pasting keeps stepping away from the original.
* **Arrow-key nudge** — one grid step per press, or exactly 1 cm with `Shift`.
* **Array tool** — repeat the selection N times along X or Y at a fixed pitch. The pitch
  defaults to the selected piece's own width, so panels butt together; a negative pitch
  arrays the other way. This is the fast path for a run of panels or a ladder of walers.
* **Named drawings** — a drawing picker in the title bar plus a manager for
  new / switch / rename / duplicate / delete. The catalog and stock are company-wide and
  shared across every drawing; a drawing only owns its placed pieces.
* **Storage safety** — if `localStorage` is full or blocked, a banner warns that autosave
  failed rather than losing work quietly, and the app keeps running.

### Tier 2 — formwork, not just shapes

* **Column wizard** (`🏛 კოლონა`) — give it a cross-section and a pour height and it builds
  the whole assembly in plan: four panel faces closing a box around the concrete, L-corners
  at the four corners, waler rings outside the faces and tie rods across. Counts flow
  straight into the BOM, which is the point.

  It is deliberately conservative about accuracy. Panels only cover what is left *between*
  the corner profiles; walers are sized per face rather than one bar spanning everything;
  and where the catalog cannot satisfy the geometry (an odd face width, a height that does
  not divide into available panel heights) it **warns instead of rounding** — an under-count
  here is a short delivery on site.
* **Edge snapping** — dragged pieces snap to nearby piece edges and centres, not just the
  grid, with alignment guides. Panel widths are not grid multiples, so this is what actually
  makes panels butt together.
* **Overlap detection** — intersecting footprints are outlined in red. Linear materials are
  excluded: walers and ties are *meant* to lie across panels, and flagging those painted a
  correct column entirely red.
* **Price, weight, article, supplier** per component. The BOM becomes a costed ordering sheet
  and a crane/truck load figure. Rows with no price or weight are counted and the totals are
  marked with `*`, so a partial total is never mistaken for a complete one.
* **Printable drawing** (`🖨 ბეჭდვა`) — a to-scale, dimensioned A4/A3 sheet with a title block
  (project, drawing, scale, sheet, revision, date). Scale is honoured exactly, or set to
  **ავტომატური** to pick the largest standard scale that fits.

### Tier 4 — multi-site inventory

* **Warehouses** — stock is counted per store. Companies with one store never meet the
  concept; deleting a store folds its quantities into another rather than destroying them.
* **Company-wide commitment** — the Inventory tab shows what *every* drawing has committed,
  not just the open one, and therefore what is genuinely free to allocate, with a per-drawing
  breakdown.
* **Tablet support** — pinch to zoom, two-finger pan, larger touch targets, and side panels
  that fold away so the canvas is usable on a small screen.

### Navigating the view

Trackpad-first, because that is what most people are on:

| gesture | does |
| --- | --- |
| two-finger scroll | **pan** |
| pinch, or `⌘`/`Ctrl` + scroll | **zoom** (anchored on the pointer) |
| `Shift` + scroll | horizontal pan (for one-wheel mice) |
| space + drag, or middle-mouse drag | pan |

The **🖐 ტაჩპედი / 🖱 მაუსი** toggle swaps the default, so on a mouse a plain wheel zooms and
the modifier pans. The modifier always does the opposite of whichever default is active.

### Dropping materials

A dragged material shows a **live ghost** of exactly where it will land — grid snapping and
edge snapping included — and the piece is placed on that spot, so the preview and the result
can never disagree. Both come from one `dropPosition()` function.

The piece is centred on the cursor using its **plan** size (`w × depth`). Using `h` here is
the classic mistake: it put a 300 cm panel 150 cm away from the pointer.

### 1 — Component creation & management

* **＋ ახალი კომპონენტი** — name, category, width/height in cm, shape (rect / L / line),
  colour (defaults to the category colour), starting stock. Live preview.
* **✎ on any palette row** — edit any component, built-ins included. Edits apply to every
  placed piece of that type immediately, because pieces reference materials by id.
* **🗑** — delete. If the component is in use, a confirm dialog offers to cascade-delete the
  placed pieces along with it; otherwise a plain confirm. Deleted built-ins stay deleted
  across reloads.
* **📊 იმპორტი ცხრილიდან** — bulk import from `.xlsx` / `.csv`, or paste CSV/TSV straight
  into the dialog. Columns: `name, category, width_cm, height_cm, shape?, color?, stock?`
  (English or Georgian headers, plus common aliases). Every row is validated and shown in a
  preview table with per-row errors and warnings before anything is added. A template file
  is one click away.
* Shapes render identically in the palette swatch and on the surface: `rect` filled box,
  `L` angle profile, `line` thin bar with rounded ends.

### 2 — Persistence

* **Autosave** to `localStorage` (`du-formwork-v2`) on every change: catalog, stock, placed
  pieces, view and label settings. Restored on load.
* **Catalog file** — `კატალოგი ⤓ ექსპორტი` / `⤒ იმპორტი` writes and reads a JSON file with
  every material and its stock, so a catalog can be shared between computers.
* **Layout file** — `ნახაზი ⤓ ექსპორტი` / `⤒ იმპორტი` handles just the placed pieces, kept
  deliberately separate from the catalog.
* On reload the stored catalog is repaired and merged with the seed list, so new built-ins
  introduced by a future version appear without wiping the user's edits or stock.

### 3 — Bill of materials

* **Live on-screen panel** (`უწყისი` tab): every component in use, grouped by category, with
  quantity, in-stock and remaining per row, plus a per-category subtotal and a grand total.
* **Summary card**: total pieces, total length in m, total area in m², shortage count.
  Length sums the longer side of linear materials (`shape: line` — walers, tie rods, posts);
  area sums w × h for everything else.
* **⤓ Excel** — ordering sheet with `Component, Category, Size (cm), Quantity, In stock,
  Remaining` (bilingual headers), plus a second summary sheet. **⤓ CSV** writes the same
  list with a UTF-8 BOM so Excel renders Georgian correctly.
* **⤓ PDF** — printable A4 table, optionally with a snapshot of the drawing above it.

  The table is laid out as HTML and rasterised with html2canvas before being placed into
  jsPDF: jsPDF's built-in fonts have no Georgian glyphs, so drawing text directly would
  produce garbage. The drawing snapshot is rendered by a dedicated 2D-canvas routine
  (`lib/snapshot.ts`) rather than screenshotting the live stage, so the printout gets a
  clean light background with no rulers or selection chrome, independent of how the user
  happened to be zoomed.

  The snapshot goes into the PDF through `pdf.addImage()` and deliberately **not** through
  html2canvas — making html2canvas re-load and re-rasterise a multi-megapixel data URL took
  the export from 2 seconds to effectively hanging. Both the snapshot and the table slices
  are added with Flate compression (`'FAST'`); without it a single drawing produced a 20 MB
  file instead of ~140 KB.

### 4 — Inventory

* Stock is editable inline on every palette row and in the `მარაგი` tab.
* Everywhere a used quantity is shown, so are **In stock** and **Remaining** (`stock − used`).
* Rows where `used > stock` turn red, and a **⚠ დეფიციტი: n** badge appears in the header
  and on the inventory tab.
* Stock persists with the catalog — autosave and catalog file alike.

### 5 — Always-visible dimensions

Every placed piece is labelled at all times, no hover or selection needed.

* Labels are drawn in a **screen-space overlay**, so they stay horizontal whatever the piece
  rotation and stay a readable size whatever the zoom.
* The size sits centred on the piece when it fits — for linear items (walers, rods) the
  label is the length alone, positioned along the bar, CAD-style. When the full
  name + size does not fit, the label shrinks (11 → 10 → 9 px), then drops to size-only,
  and only then moves just outside the piece (above it, flipping below near the top edge).
* Pieces smaller than ~12 px on screen are skipped, as is everything below 12 % zoom.
* Toolbar toggles: **ზომები** (dimensions, on by default), **სახელები** (names, on by
  default) and **ყოველთვის**, which forces labels on even when they would normally be
  hidden for density.

---

## Notes

* Sizes are approximate, derived from the material names (`პანელი 45*300` = 45 × 300 cm);
  walers and tie rods are sized by length with a thin profile, and small hardware uses
  representative sizes. They all live in one place — `src/data/seedCatalog.ts` — and any of
  them can be corrected from the UI when a real spec sheet arrives.
* `npm audit` reports **0 vulnerabilities**. Getting there needed `xlsx` from the SheetJS CDN
  (the npm mirror is stuck on a version with two high-severity advisories and no fix),
  jsPDF 4, Vite 6 and Vitest 4 — so do not "helpfully" repoint `xlsx` at the npm registry.
* The export libraries (`xlsx`, `jspdf`, `html2canvas`) are **lazy-loaded** on first use.
  That is why `lib/sheetSchema.ts` (headers, aliases, validation — no SheetJS) is separate
  from `lib/sheetImport.ts` (the SheetJS half): the import dialog statically imports the
  former, and if it imported the latter the whole 160 kB library would land in the main
  bundle. Main bundle is ~256 kB (79 kB gzipped) instead of ~1.2 MB.
* Clearing site data in the browser resets the app to the 41 built-in materials — export the
  catalog file first if stock has been entered.
