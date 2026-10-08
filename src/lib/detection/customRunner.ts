/**
 * customRunner.ts
 *
 * Runs a user-uploaded `.ts` detector entirely in the browser — no backend,
 * no bundler step, no Python. The source is transpiled to CommonJS with
 * sucrase (a tiny in-browser TS→JS compiler — the same thing web REPLs use)
 * and executed inside the detection worker via `new Function`, with a
 * `require` shim that resolves the built-in helper modules (./opencv, ./pdf,
 * ./types, the three detectors) to the real bundled modules.
 *
 * NOTE: this is a convenience shim, not a security boundary — the compiled
 * code runs in the worker's own global scope and can reach `self`/`globalThis`.
 * That is acceptable because the user runs their own code on their own machine,
 * and the worker is created per job and terminated when the job settles.
 *
 * The file must export a `detectPage(page, rasterAt, options)` function
 * returning a PageResult — the exact contract the built-in detectors expose
 * (`rasterAt(dpi) -> gray Mat`, `options = { cv, algorithm, drawingType,
 * mode, scale, pagePtH }`).
 *
 * Auto-wrap: a file that instead exports `detectBritaniaPage` or
 * `analyzeUnifiedPage` (i.e. a verbatim copy of what the dialog's copy
 * buttons emit) is wrapped into the same contract, so copied built-in
 * detectors run unchanged.
 *
 * Memory: the user's detectPage is responsible for the Mats it allocates
 * (newTracker/releaseMats, as documented in the help panel). If it leaks, the
 * worker is per-job and terminated afterwards, which returns WASM memory to
 * baseline anyway.
 */

import { transform } from 'sucrase';
import type { AlgorithmName, PageResult } from './types';
import * as opencvNs from './opencv';
import * as pdfNs from './pdf';
import * as typesNs from './types';
import * as britaniaNs from './britania_detector_pdf';
import * as unifiedNs from './unified_detector_v2_pdf';
import * as superNs from './super_detector_pdf';
import * as detectorNs from './detector_pdf';

type AnyNs = Record<string, unknown>;

/**
 * Built-in modules the sandboxed require() can resolve, keyed by basename
 * (extension and leading ../ stripped). A `default` alias is added so both
 * `import { x } from './opencv'` and `import cv from './opencv'` styles work.
 */
const BUILTINS: Record<string, AnyNs> = {
  opencv: { default: opencvNs, ...opencvNs },
  pdf: { default: pdfNs, ...pdfNs },
  types: { default: typesNs, ...typesNs },
  britania_detector_pdf: { default: britaniaNs, ...britaniaNs },
  unified_detector_v2_pdf: { default: unifiedNs, ...unifiedNs },
  super_detector_pdf: { default: superNs, ...superNs },
  detector_pdf: { default: detectorNs, ...detectorNs },
};

/** Resolve an import specifier to a built-in module, or throw a clear error. */
function resolveSpecifier(spec: string): AnyNs {
  const base = spec.split('/').pop()?.replace(/\.ts$/, '') ?? spec;
  const mod = BUILTINS[base];
  if (!mod) {
    throw new Error(
      `იმპორტი არ არის ხელმისაწვდომი: "${spec}". ნებადართულია მხოლოდ ჩაშენებული დამხმარეები: opencv, pdf, types, britania_detector_pdf, unified_detector_v2_pdf, super_detector_pdf, detector_pdf.`,
    );
  }
  return mod;
}

/**
 * A minimal pdf.js-like page for the pre-flight check: no operators, no text,
 * a fixed height. Empty layers are exactly what the synthetic run wants — the
 * vector walker and text reader both return nothing, so any detector that
 * merely *touches* the page rather than the raster runs to completion.
 */
const SYNTHETIC_PAGE = {
  getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
  getTextContent: async () => ({ items: [] }),
  // Width included so a detector that reads the viewport's box (e.g. into a
  // cv.Size) sees numbers, not undefined.
  getViewport: () => ({ width: 100, height: 100 }),
};

/** Result of the upload-time live test of a user's `.ts` detector. */
export type VerifyOutcome =
  | { ok: true }
  | {
      ok: false;
      /** One-line headline for the status bar. */
      error: string;
      /** Multi-line detail (offending source line + caret) for the tooltip. */
      detail?: string;
    };

/** A friendly compile-error breakdown: a headline and the full detail. */
export interface CompileErrorInfo {
  /** One line, e.g. „კომპილაცია ვერ მოხერხდა — ხაზი 2“. */
  short: string;
  /** Multi-line: headline, the offending source line, a caret, the raw
   * sucrase message. */
  detail: string;
}

/**
 * Turn a sucrase syntax error into something the user can act on.
 *
 * sucrase messages end with a 1-based "(line:col)" position and are wrapped
 * in "Error transforming <file>: ". Extract the position, pull the offending
 * line out of the user's own source, and render it compiler-style:
 *
 *   კომპილაცია ვერ მოხერხდა — ხაზი 2:
 *   2 │   const x = ;
 *     │             ^
 *   Unexpected token (2:13)
 *
 * Falls back to the stripped raw message when there is no position to map.
 */
export function explainCompileError(source: string, e: unknown): CompileErrorInfo {
  const raw = (e as Error).message;
  const stripped = raw.replace(/^Error transforming .+?:\s*/, '');
  const m = stripped.match(/\((\d+):(\d+)\)\s*$/);
  if (!m) {
    const short = `კომპილაცია ვერ მოხერხდა: ${stripped}`;
    return { short, detail: short };
  }
  const line = Number(m[1]);
  const col = Number(m[2]);
  const srcLine = source.split('\n')[line - 1] ?? '';
  const width = String(line).length;
  // sucrase columns are 1-based; the caret sits on the offending character.
  const caretAt = Math.min(col - 1, srcLine.length);
  const detail = [
    `კომპილაცია ვერ მოხერხდა — ხაზი ${line}:`,
    `${String(line).padStart(width)} │ ${srcLine}`,
    `${' '.repeat(width)} │ ${' '.repeat(Math.max(0, caretAt))}^`,
    stripped,
  ].join('\n');
  return { short: `კომპილაცია ვერ მოხერხდა — ხაზი ${line}`, detail };
}

/**
 * Live-test a user's detector before it ever sees a real PDF: transpile it,
 * then call its `detectPage` once on a tiny synthetic page. This catches
 * compile errors, whitelist violations, runtime crashes and contract mistakes
 * (a non-PageResult return) the moment the file is dropped, instead of
 * halfway through a multi-page run.
 *
 * Runs in the worker with the real opencv.js (`cv`), so the check is exactly
 * the code the PDF run will execute — a fake cv would validate nothing.
 * The synthetic raster is an 8×8 all-black 8UC1 Mat the detector owns and
 * frees; at that size the full pipeline is near-instant. `ok: true` does not
 * promise correct detections — only that the code runs and speaks the
 * contract.
 */
export async function verifyCustomSource(
  source: string,
  fileName: string,
  cv: unknown,
): Promise<VerifyOutcome> {
  let entry: CustomEntry;
  try {
    entry = compileCustom(source, fileName);
  } catch (e) {
    // compileCustom throws the full highlighted detail; the status bar shows
    // the one-line headline and the tooltip the full detail.
    const detail = (e as Error).message;
    const headline = detail.split('\n')[0].replace(/:$/, '');
    return { ok: false, error: `${fileName}: ${headline}`, detail };
  }

  const cvMod = cv as {
    Mat: new (...args: unknown[]) => unknown;
    CV_8UC1: number;
    Scalar: new (...args: unknown[]) => unknown;
  };
  // Built lazily: a detector that never asks for a raster (pure vector work on
  // the empty operator list) does not need a Mat at all.
  const rasterAt = async () =>
    new cvMod.Mat(8, 8, cvMod.CV_8UC1, new cvMod.Scalar(0));

  let result: unknown;
  try {
    result = await entry.detectPage(SYNTHETIC_PAGE, rasterAt, {
      cv,
      algorithm: 'custom',
      drawingType: 'auto',
      mode: 'auto',
      scale: 50,
      pagePtH: 100,
    });
  } catch (e) {
    return { ok: false, error: `ალგორითმი ჩაიშალა სატესტო გვერდზე: ${(e as Error).message}` };
  }

  // The real run reads `result.drawing_type` to decide which arrays to count,
  // so a detector that returns anything else would crash the page loop — that
  // is exactly the kind of mistake this check exists to catch early.
  const rt = result as { drawing_type?: unknown } | null;
  const valid = !!rt && (rt.drawing_type === 'plan' || rt.drawing_type === 'section');
  if (!valid) {
    return {
      ok: false,
      error:
        'ალგორითმმა არასწორი შედეგი დააბრუნა — საჭიროა PageResult: ' +
        '{drawing_type: "plan" | "section", …} (იხ. ინსტრუქცია).',
    };
  }
  return { ok: true };
}

/** A compiled custom detector ready to process pages. */
export interface CustomEntry {
  /** (page, rasterAt, options) => PageResult — the built-in detectPage contract. */
  detectPage: (
    page: unknown,
    rasterAt: (dpi: number) => Promise<unknown>,
    options: {
      cv: unknown;
      algorithm: string;
      drawingType: string;
      mode: string;
      scale: number;
      pagePtH: number;
    },
  ) => Promise<PageResult>;
  /** What the algorithms map / page log should say this page ran as. */
  algo: AlgorithmName;
}

/**
 * Transpile + execute the user's source, then resolve the page processor.
 * Throws a Georgian, dialog-friendly error on compile/runtime failure.
 */
export function compileCustom(source: string, fileName: string): CustomEntry {
  let code: string;
  try {
    code = transform(source, { transforms: ['typescript', 'imports'], filePath: fileName }).code;
  } catch (e) {
    // The message is the full detail (offending line + caret) so the run
    // path's console log shows exactly where the syntax broke, and the
    // verify path can derive the one-line headline from its first line.
    throw new Error(explainCompileError(source, e).detail);
  }

  const module = { exports: {} as AnyNs };
  try {
    // The sandboxed module gets our built-ins under `require`; everything else
    // (npm packages, node builtins) fails loudly inside the shim.
    const fn = new Function('require', 'module', 'exports', code) as (
      requireFn: (spec: string) => AnyNs,
      mod: { exports: AnyNs },
      exp: AnyNs,
    ) => void;
    fn(resolveSpecifier, module, module.exports);
  } catch (e) {
    throw new Error(`შენი ალგორითმი ვერ გაეშვა: ${(e as Error).message}`);
  }

  const exp = module.exports;
  const dflt = (exp.default as AnyNs | undefined) ?? {};

  // Accept the idiomatic shapes: named export, `export default { detectPage }`,
  // and the single-function module `export default function detectPage(...)`.
  const direct = exp.detectPage ?? dflt.detectPage;
  const entry = (typeof direct === 'function' ? direct : exp.default) as unknown;
  if (typeof entry === 'function') {
    return {
      algo: 'custom',
      detectPage: entry as CustomEntry['detectPage'],
    };
  }

  // Verbatim Britania copy: detectBritaniaPage(cv, gray) at BRITANIA_PARAMS.DPI.
  const britania = (exp.detectBritaniaPage ?? dflt.detectBritaniaPage) as unknown;
  if (typeof britania === 'function') {
    return {
      algo: 'britania',
      detectPage: async (_page, rasterAt, options) => {
        const gray = await rasterAt(britaniaNs.BRITANIA_PARAMS.DPI);
        try {
          return (britania as (cv: unknown, gray: unknown) => PageResult)(options.cv, gray);
        } finally {
          (gray as { delete?: () => void })?.delete?.();
        }
      },
    };
  }

  // Verbatim GlassWorks copy: analyzeUnifiedPage({ cv, drawings, text, ... }).
  const unified = (exp.analyzeUnifiedPage ?? dflt.analyzeUnifiedPage) as unknown;
  if (typeof unified === 'function') {
    return {
      algo: 'glassworks',
      detectPage: async (page, rasterAt, options) => {
        const [drawings, text] = await Promise.all([
          pdfNs.getPageDrawings(page),
          pdfNs.getPageText(page),
        ]);
        return (unified as (o: unknown) => Promise<PageResult>)({
          cv: options.cv,
          drawings,
          text,
          pagePtH: options.pagePtH,
          drawingType: options.drawingType,
          mode: options.mode,
          scale: options.scale,
          grayAt: rasterAt,
        });
      },
    };
  }

  throw new Error(
    'ფაილმა უნდა ექსპორტიროს detectPage(page, rasterAt, options) — ან იყოს Britania/GlassWorks კოდის ასლი (detectBritaniaPage / analyzeUnifiedPage).',
  );
}
