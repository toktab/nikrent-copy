import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { Bom } from './bom';
import { fmtNum, sizeLabel } from './bom';
import { stampedName } from './files';

/**
 * The BOM *text* is rendered as ordinary HTML and rasterised with html2canvas
 * before being placed into the PDF. That keeps Georgian typography correct —
 * jsPDF's built-in fonts have no Georgian glyphs — and lets us reuse normal CSS.
 *
 * The drawing snapshot deliberately does NOT go through html2canvas: it is
 * already a PNG, and making html2canvas re-load and re-rasterise a multi-megapixel
 * data URL made the export take many seconds. It is handed straight to
 * `pdf.addImage()` instead, which is both faster and sharper.
 */
export interface PdfOptions {
  bom: Bom;
  /** PNG data URL from renderLayoutSnapshot(), or null */
  snapshot?: string | null;
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

  const groups = bom.groups
    .map(
      (g) => `
      <tr class="cat">
        <td colspan="5"><span class="dot" style="background:${esc(g.color)}"></span>${esc(g.label)}</td>
      </tr>
      ${g.rows
        .map(
          (r) => `
        <tr class="${r.shortage ? 'short' : ''}">
          <td>${esc(r.material.name)}</td>
          <td class="num">${esc(sizeLabel(r.material))}</td>
          <td class="num">${r.used}</td>
          <td class="num">${r.stock}</td>
          <td class="num">${r.remaining}${r.shortage ? ' ⚠' : ''}</td>
        </tr>`,
        )
        .join('')}
      <tr class="sub">
        <td>ჯამი — ${esc(g.label)}</td>
        <td class="num">${g.lengthM > 0 ? `${fmtNum(g.lengthM)} მ` : `${fmtNum(g.areaM2)} მ²`}</td>
        <td class="num">${g.pieces}</td>
        <td></td>
        <td></td>
      </tr>`,
    )
    .join('');

  return `
  <div class="doc">
    <header>
      <h1>${esc(title ?? 'Du ფორმვორკი — მასალების უწყისი')}</h1>
      <div class="meta">თარიღი: ${esc(date)}</div>
    </header>

    <section class="cards">
      <div class="card"><span>სულ ელემენტი</span><b>${bom.totalPieces}</b></div>
      <div class="card"><span>სულ სიგრძე</span><b>${fmtNum(bom.totalLengthM)} მ</b></div>
      <div class="card"><span>სულ ფართობი</span><b>${fmtNum(bom.totalAreaM2)} მ²</b></div>
      <div class="card ${bom.shortageCount ? 'warn' : ''}"><span>დეფიციტი</span><b>${bom.shortageCount}</b></div>
    </section>

    <table>
      <thead>
        <tr>
          <th>კომპონენტი</th><th class="num">ზომა (სმ)</th><th class="num">რაოდ.</th>
          <th class="num">მარაგი</th><th class="num">ნაშთი</th>
        </tr>
      </thead>
      <tbody>
        ${groups || '<tr><td colspan="5" class="empty">ზედაპირზე ელემენტები არ არის.</td></tr>'}
        <tr class="total">
          <td>სულ</td><td></td><td class="num">${bom.totalPieces}</td><td></td><td></td>
        </tr>
      </tbody>
    </table>
  </div>`;
}

const PRINT_CSS = `
  .doc{width:900px;padding:34px 38px;background:#fff;color:#1b1f24;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Georgian",Arial,sans-serif;}
  .doc header{display:flex;align-items:baseline;justify-content:space-between;
    border-bottom:2px solid #1b1f24;padding-bottom:10px;margin-bottom:18px;}
  .doc h1{font-size:20px;margin:0;font-weight:700;}
  .doc .meta{font-size:12px;color:#5c6572;}
  .doc figure{margin:0 0 20px;text-align:center;}
  .doc figure img{max-width:100%;border:1px solid #d5dae1;border-radius:6px;}
  .doc figcaption{font-size:11px;color:#7a8492;margin-top:5px;}
  .doc .cards{display:flex;gap:10px;margin-bottom:18px;}
  .doc .card{flex:1;border:1px solid #dfe4ea;border-radius:8px;padding:9px 12px;background:#f7f9fb;}
  .doc .card span{display:block;font-size:10px;color:#6b7480;text-transform:uppercase;letter-spacing:.5px;}
  .doc .card b{font-size:17px;}
  .doc .card.warn{background:#fdecec;border-color:#f0b4b4;}
  .doc table{width:100%;border-collapse:collapse;font-size:12px;}
  .doc th{background:#eef1f5;text-align:left;padding:7px 9px;border-bottom:1px solid #c9ced6;font-size:11px;}
  .doc td{padding:6px 9px;border-bottom:1px solid #eceff3;}
  .doc .num{text-align:right;}
  .doc tr.cat td{background:#f3f5f8;font-weight:700;font-size:12px;padding-top:9px;}
  .doc .dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:7px;}
  .doc tr.sub td{font-weight:600;background:#fafbfc;color:#404853;}
  .doc tr.total td{font-weight:700;border-top:2px solid #1b1f24;background:#eef1f5;}
  .doc tr.short td{background:#fdecec;color:#8e1f1f;font-weight:600;}
  .doc .empty{color:#7a8492;text-align:center;padding:22px;}
`;

/** Builds the printable table off-screen, rasterises it and paginates onto A4. */
export async function exportBomToPdf(options: PdfOptions): Promise<void> {
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

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const margin = 10;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const contentW = pageW - margin * 2;

    // The drawing goes on first, straight from its PNG, capped at half a page
    // so the materials list still starts on page 1.
    let topOffset = margin;
    if (options.snapshot) {
      const props = pdf.getImageProperties(options.snapshot);
      const ratio = props.height / props.width;
      const maxH = (pageH - margin * 2) * 0.5;
      const drawH = Math.min(contentW * ratio, maxH);
      const drawW = drawH / ratio;
      // 'FAST' = Flate-compress the bitmap. Without it jsPDF embeds raw pixels
      // and a single drawing pushes the file past 20 MB.
      pdf.addImage(options.snapshot, 'PNG', margin, topOffset, drawW, drawH, undefined, 'FAST');
      topOffset += drawH + 5;
    }

    // Slice the rasterised table across pages; page 1 starts below the drawing.
    const pxPerMm = canvas.width / contentW;
    let y = 0;
    let startY = topOffset;
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
        pdf.addPage();
        startY = margin;
      }
    }

    pdf.save(stampedName('du-bom', 'pdf'));
  } finally {
    host.remove();
    style.remove();
  }
}
