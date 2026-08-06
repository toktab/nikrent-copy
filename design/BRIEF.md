# კუბი — design brief

A brief for a logo, a visual identity and a UI system. Written to be handed
to a designer (human or AI) as a single self-contained prompt. Everything in
it is drawn from the working application, not from an idea of one.

---

## 1. What the product is

**კუბი** (*Kubi*, "cube") is a planning tool for **concrete formwork** — the
temporary panel structures that hold wet concrete until it sets. It is used by
a Georgian formwork **rental company**: they own the panels, hire them out,
and plan the assemblies their clients need.

The name is the unit the whole business is measured in. Concrete is ordered,
poured and billed in cubic metres.

Three things happen in it:

1. **Drawing** — lay out panels, corners, walers and tie rods, in plan, in two
   elevations and in 3D. Two wizards generate a whole column or wall from its
   dimensions.
2. **Counting** — every drawing produces a bill of materials, checked against
   what the company actually owns, per warehouse.
3. **Sharing** — three to ten people, three roles, working on the same
   drawings at the same time.

It is not a CAD program and should not look like one pretending to be Revit.
It is closer to a **very good workshop tool**: precise, dense, unfussy.

## 2. Who uses it, and where

| | |
| --- | --- |
| **Language** | Georgian (`ქართული`) throughout. English is not a fallback. |
| **People** | An owner/admin, one or two people who draw, and site staff who only look. |
| **Devices** | Desktop in the office, **tablet on site**. Occasionally a phone. |
| **Conditions** | Sometimes bright sun. Sometimes gloves. Often one-handed. |
| **Sessions** | Long and concentrated in the office; short and urgent on site. |

The person on site is not browsing. They have opened it to answer one
question — *how many 30×300 panels do I need, and do we have them* — and they
want it answered without reading anything.

## 3. Non-negotiable constraints

These come from the working app. A design that ignores them cannot ship.

- **Georgian script.** No uppercase, no small caps, distinct letterforms.
  Anything relying on `text-transform: uppercase` for hierarchy is out. Letter
  spacing that flatters Latin often damages Georgian. The chosen typeface must
  have a real Georgian cut — not a Latin face with fallback glyphs, which is
  what the app does today and it shows.
- **Dark by default.** The drawing surface is dark so the coloured components
  read as objects on it. A light theme may be proposed as an addition, never
  as a replacement.
- **Density is a feature.** A column assembly is 32 pieces; a wall is more. The
  bill of materials is a real table. Do not propose generous whitespace that
  halves what fits on screen.
- **Colour already carries meaning.** Components are coloured by category and
  those colours appear in the drawing, the palette swatch, the 3D view and the
  PDF. The brand palette must sit *around* them without competing.
- **The canvas is the product.** Chrome is currently 16–26% of the screen
  depending on width. Less is better. Nothing decorative may take canvas.

## 4. What exists today

Honest starting point, so the work is a redesign and not a guess.

**Colour tokens** (all in `src/styles.css`):

```
--bg        #1e2228   app background
--surface   #20252b   drawing surface
--panel     #272c33   side panels, header
--panel2    #2f353d   raised controls
--line      #3a424c   borders
--text      #e6e9ee   primary text
--muted     #9aa4b1   secondary text
--accent    #f5a623   selection, primary action, height marker
--accent2   #4a90e2   secondary highlight
--ok        #7fc08a   saved
--bad       #e06c6c   shortage, danger, errors
--grid      #333b45 / --gridMajor #454f5b
```

**Type:** system stack with `Noto Sans Georgian` as a fallback. This is the
weakest part of the current design and the highest-value thing to fix.

**Icons:** 33 hand-drawn SVGs on a 24×24 grid, 2px stroke, `currentColor`,
no fill. Names: `plus minus pencil trash copy grid array search download
upload print sheet folder users key warning check close undo redo rotate-cw
rotate-ccw reset fit column wall chevron-{left,right,down} arrow-{up,down,
left,right} height dot circle`.

**Screens:** login · recovery · the editor (plan / front / side / 3D, with a
material palette left and an inspector right holding details, bill of
materials and inventory tabs) · and 15 dialogs, of which the substantial ones
are the column wizard, the wall wizard, sheet import, inventory, users and
templates.

## 5. What to design

### 5.1 Logo

A mark for **კუბი**. It will appear at 16px as a favicon, ~28px in the app
header, and large on a printed drawing's title block.

Territory worth exploring — the brief is not prescribing the answer:

- The **cube** itself, as the unit of poured concrete.
- The **negative**: formwork is a mould. The interesting shape is the void it
  leaves, not the panels. A cube defined by what surrounds it.
- **Panels standing in a ring** — what a column form looks like from above, and
  what the current favicon draws.
- The **isometric cube** as three rhombi, which is also exactly how the 3D view
  projects. A mark that is literally the app's own geometry.

Requirements:

- Must survive 16×16 in one colour.
- Must work on the dark surface *and* on white paper (the PDF title block).
- Must not require the Georgian word beside it to be legible.
- Give a lockup with `კუბი` set in the chosen typeface, and a mark-only form.
- No gradients that die in print. No thin strokes that vanish at favicon size.

### 5.2 Typography

Pick a typeface family with a **genuine Georgian cut** and a Latin companion
that shares its skeleton — numerals appear constantly (dimensions, counts,
quantities) and must be unmistakable.

Specify: display / heading / body / small / numeric-tabular, with sizes and
weights. Note that the UI is dense: body is likely 12–13px, not 16px.

Tabular figures are required anywhere numbers stack in a column.

### 5.3 Colour

Take the existing tokens as a starting point and improve them. Judge them
honestly — `--accent #f5a623` doing selection, primary action and the height
marker at once may be one job too many.

Deliver a scale, not seven hex codes: surfaces, borders, text, and semantic
colours for **saved / unsaved / failed / conflict / shortage / read-only**.
Those six states all exist in the app and currently share three colours.

Check contrast at AA against the dark surface, and say which pairs fail.

### 5.4 The editor shell

Redesign the header, side panels and the status strip. Today the header is two
bars with ~25 controls and it wraps badly between 1150 and 1400px. Propose a
structure that holds: drawing switcher, view switcher (plan/front/side/3D),
snap controls, the two wizards, edit actions, zoom, save state, live presence
avatars and the account menu — without wrapping and without eating canvas.

Include the collapsed states: both side panels fold away on small screens.

### 5.5 Touch

Specify a tablet layout. Targets are currently 21–23px tall, which is too small
for a gloved hand. Say what the minimum is and what has to change to reach it
without losing density on desktop.

### 5.6 States nobody designs but everybody meets

- Empty drawing, empty catalog, empty inventory, no templates yet.
- Loading from the server, and the moment before data arrives.
- **Save failed**, and **someone else edited this drawing** — both are real,
  both currently render as a small coloured badge.
- A viewer who cannot edit: every disabled control needs to say *why*, not just
  be grey.
- Offline.

### 5.7 Print

The app exports a scaled, dimensioned drawing with a title block, plus material
lists as PDF, Excel and CSV. The printed sheet is what a client sees. It is
currently plain. Design the title block and the sheet furniture.

## 6. Tone

Confident, quiet, industrial. It should feel like a well-made instrument —
the visual equivalent of a good spirit level. Specifically **not**:

- consumer-app rounded and bubbly
- enterprise-dashboard grey and apologetic
- "construction-themed": no hazard stripes, no hi-vis orange, no hard-hat
  icons, no concrete textures

The subject matter is already industrial. The design does not need to say so.

## 7. Deliverables

1. Logo: mark, lockup, favicon, one-colour version. SVG.
2. Type scale with named tokens.
3. Colour scale with named tokens, mapped onto the existing CSS variables so it
   can be dropped in.
4. Editor shell redesign at 1440px, 1024px and 768px.
5. Component sheet: buttons (4 sizes × 5 states), inputs, selects, tabs,
   dialogs, tables, badges, tooltips, the material palette row, the BOM row.
6. The six state designs from §5.6.
7. PDF title block.

Deliver tokens as CSS custom properties using the existing names where
possible. The application is React with plain CSS — no Tailwind, no component
library, no design-system dependency. Anything requiring one will not be used.
