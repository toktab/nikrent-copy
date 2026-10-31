import html2canvas from 'html2canvas';
import type { jsPDF } from 'jspdf';
import type { Bom } from './bom';
import { fmtNum, sizeLabel } from './bom';

/**
 * The BOM *text* is rendered as ordinary HTML and rasterised with html2canvas
 * before being placed into the PDF. That keeps Georgian typography correct —
 * jsPDF's built-in fonts have no Georgian glyphs — and lets us reuse normal CSS.
 *
 * The list goes after the drawing sheet (`drawingPdf`), which is a PNG of its
 * own handed straight to `pdf.addImage()` - never through html2canvas, which
 * took many seconds to re-rasterise a multi-megapixel image.
 */
export interface PdfOptions {
  bom: Bom;
  title?: string;
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPrintableHtml({ bom, title }: PdfOptions): string {
  const date = new Date().toLocaleDateString('ka-GE');

  // A blank rather than "0" where the quantity does not apply: accessories have
  // no length, linear members have no face area.
  const q = (value: number, unit: string) => (value > 0 ? `${fmtNum(value)} ${unit}` : '-');

  const groups = bom.groups
    .map(
      (g) => `
      <tr class="cat">
        <td colspan="5"><span class="dot" style="background:${esc(g.color)}"></span>${esc(g.label)}</td>
      </tr>
      ${g.rows
        .map(
          (r) => `
        <tr>
          <td>${esc(r.material.name)}</td>
          <td class="num">${esc(sizeLabel(r.material))}</td>
          <td class="num">${r.used}</td>
          <td class="num">${q(r.lengthM, 'მ')}</td>
          <td class="num">${r.weightMissing ? '-' : q(r.weightKg, 'კგ')}</td>
        </tr>`,
        )
        .join('')}
      <tr class="sub">
        <td>ჯამი - ${esc(g.label)}</td>
        <td class="num">${q(g.areaM2, 'მ²')}</td>
        <td class="num">${g.pieces}</td>
        <td class="num">${q(g.lengthM, 'მ')}</td>
        <td class="num">${q(g.weightKg, 'კგ')}</td>
      </tr>`,
    )
    .join('');

  // Weight drives crane and truck loads, so an incomplete total has to say so
  // rather than look like a real figure.
  const weightNote =
    bom.unweighedRows > 0
      ? `<p class="note">* წონის ჯამი არასრულია - ${bom.unweighedRows} პოზიციას წონა არ აქვს მითითებული.</p>`
      : '';

  return `
  <div class="doc">
    <header>
      <h1>${esc(title ?? 'კუბი - მასალების უწყისი')}</h1>
      <div class="meta">თარიღი: ${esc(date)}</div>
    </header>

    <section class="cards">
      <div class="card"><span>სულ ელემენტი</span><b>${bom.totalPieces}</b></div>
      <div class="card"><span>სულ სიგრძე</span><b>${fmtNum(bom.totalLengthM)} მ</b></div>
      <div class="card"><span>სულ ფართობი</span><b>${fmtNum(bom.totalAreaM2)} მ²</b></div>
      <div class="card"><span>სულ წონა${bom.unweighedRows > 0 ? ' *' : ''}</span><b>${fmtNum(bom.totalWeightKg)} კგ</b></div>
    </section>

    <table>
      <thead>
        <tr>
          <th>კომპონენტი</th><th class="num">ზომა (სმ)</th><th class="num">რაოდ.</th>
          <th class="num">სიგრძე</th><th class="num">წონა</th>
        </tr>
      </thead>
      <tbody>
        ${groups || '<tr><td colspan="5" class="empty">ზედაპირზე ელემენტები არ არის.</td></tr>'}
        <tr class="total">
          <td>სულ</td>
          <td class="num">${q(bom.totalAreaM2, 'მ²')}</td>
          <td class="num">${bom.totalPieces}</td>
          <td class="num">${q(bom.totalLengthM, 'მ')}</td>
          <td class="num">${q(bom.totalWeightKg, 'კგ')}</td>
        </tr>
      </tbody>
    </table>
    ${weightNote}
  </div>`;
}

const PRINT_CSS = `
  .doc{width:900px;padding:34px 38px;background:#fff;color:#1b1f24;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Georgian",Arial,sans-serif;}
  .doc header{display:flex;align-items:baseline;justify-content:space-between;
    border-bottom:2px solid #1b1f24;padding-bottom:10px;margin-bottom:18px;}
  .doc h1{font-size:20px;margin:0;font-weight:700;}
  .doc .meta{font-size:12px;color:#5c6572;}
  .doc .cards{display:flex;gap:10px;margin-bottom:18px;}
  .doc .card{flex:1;border:1px solid #dfe4ea;border-radius:8px;padding:9px 12px;background:#f7f9fb;}
  .doc .card span{display:block;font-size:10px;color:#6b7480;text-transform:uppercase;letter-spacing:.5px;}
  .doc .card b{font-size:17px;}
  .doc table{width:100%;border-collapse:collapse;font-size:12px;}
  .doc th{background:#eef1f5;text-align:left;padding:7px 9px;border-bottom:1px solid #c9ced6;font-size:11px;}
  .doc td{padding:6px 9px;border-bottom:1px solid #eceff3;}
  .doc .num{text-align:right;}
  .doc tr.cat td{background:#f3f5f8;font-weight:700;font-size:12px;padding-top:9px;}
  .doc .dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:7px;}
  .doc tr.sub td{font-weight:600;background:#fafbfc;color:#404853;}
  .doc tr.total td{font-weight:700;border-top:2px solid #1b1f24;background:#eef1f5;}
  .doc .empty{color:#7a8492;text-align:center;padding:22px;}
  .doc .note{font-size:11px;color:#7a8492;margin:9px 0 0;}
`;

/**
 * Lays the bill of materials onto A4 portrait pages of an existing PDF.
 *
 * Its own function so the drawing export can put the list after the sheet in
 * the same file: one PDF for the site and the yard, instead of two to keep
 * together. `newPage` starts on a fresh page; without it the list begins on the
 * document's current, still-empty first page. Every page it adds is A4 portrait
 * whatever the document started as - a drawing sheet is A3 or A4 landscape.
 */
export async function appendBomPages(pdf: jsPDF, options: PdfOptions, newPage: boolean): Promise<void> {
  // The stylesheet goes in <head> so html2canvas's document clone definitely has it.
  const style = document.createElement('style');
  style.textContent = PRINT_CSS;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;background:#fff;';
  host.innerHTML = buildPrintableHtml(options);
  document.body.appendChild(host);

  try {
    const target = host.querySelector('.doc') as HTMLElement;
    const canvas = await html2canvas(target, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
    });

    if (!canvas.width || !canvas.height) throw new Error('ცხრილის რენდერი ცარიელია');

    if (newPage) pdf.addPage('a4', 'portrait');
    const margin = 10;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const contentW = pageW - margin * 2;

    // Slice the rasterised table across pages.
    const pxPerMm = canvas.width / contentW;
    let y = 0;
    let startY = margin;
    while (y < canvas.height) {
      const availableMm = pageH - margin - startY;
      const sliceHpx = Math.max(1, Math.floor(availableMm * pxPerMm));
      const h = Math.min(sliceHpx, canvas.height - y);

      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = h;
      slice.getContext('2d')?.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      pdf.addImage(
        slice.toDataURL('image/png'),
        'PNG',
        margin,
        startY,
        contentW,
        h / pxPerMm,
        undefined,
        'FAST',
      );

      y += h;
      if (y < canvas.height) {
        // Named, not the default: the default is whatever the document was
        // opened as, and a landscape drawing sheet would turn the list sideways.
        pdf.addPage('a4', 'portrait');
        startY = margin;
      }
    }
  } finally {
    host.remove();
    style.remove();
  }
}
