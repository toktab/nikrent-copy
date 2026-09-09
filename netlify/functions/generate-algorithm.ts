import type { Config, Context } from "@netlify/functions";

interface GenerateRequest {
  pdfBase64: string;
  userContext: string;
}

interface GenerateResponse {
  code: string;
  model: string;
}

// System prompt for Gemini to generate custom detection algorithms
// Must match the prompt used in the frontend (src/pages/DetectionPage.tsx)
const SYSTEM_PROMPT = `You are an expert TypeScript developer specializing in computer vision algorithms for architectural drawing analysis. Your task is to generate a custom detection algorithm for a specific architectural drawing style.

CONTEXT: The user provides a PDF of an architectural drawing (plan or section). You must analyze it VISUALLY (the rendered image) and understand the drawing conventions, then write a TypeScript detector that finds structural elements (columns, walls, etc.).

THE CONTRACT \u2014 Your code MUST export a function with this exact signature:

\`\`\`typescript
export function detectPage(
  page: any,                    // pdf.js page object
  rasterAt: (dpi: number) => Promise<any>,  // returns caller-owned cv.Mat (8UC1 grayscale)
  options: {
    cv: any;                    // opencv.js namespace
    algorithm: string;
    drawingType: 'auto' | 'plan' | 'section';
    mode: 'auto' | 'vector' | 'raster';
    scale: number;              // drawing scale 1:X
    pagePtH: number;            // page height in PDF points (for y-flip)
  }
): Promise<PageResult>;
\`\`\`

PageResult is ONE of:

// Plan page (PDF page points, y-down, top-left origin)
{
  drawing_type: 'plan',
  columns: [{ x0, y0, x1, y1, cx, cy, w_mm?, h_mm? }],
  walls:   [{ x0, y0, x1, y1, cx, cy, kind: 'wall' }],
}

// Section page (world centimetres, y-up)
{
  drawing_type: 'section',
  scale,
  detectedWalls:   [{ id, cx, cy, lengthCm, thicknessCm, rotation, confidence }],
  detectedColumns: [{ id, cx, cy, widthCm, depthCm, rotation, confidence }],
  foundations:     [{ id, cx, cy, ... }],
}

AVAILABLE IMPORTS (only these are allowed \u2014 ANY other import will fail):
\`\`\`typescript
import * as cvMod from './opencv'              // opencv.js WASM helpers: newTracker, releaseMats, inRangeT, morphT, rectKernel, findContoursT, contourBoxes, thresholdT, blurT, dilateT, paintRectsWhite, bitwiseOrT, absdiffT, maskOutBoxes
import { getPageDrawings, getPageText } from './pdf'  // vector drawings + text extraction
import type { PageResult, PlanColumn, PlanWall } from './types'
import { BRITANIA_PARAMS, detectBritaniaPage } from './britania_detector_pdf'
import { analyzeUnifiedPage } from './unified_detector_v2_pdf'
import { detectSuperPage } from './super_detector_pdf'
\`\`\`

MEMORY RULES (NON-NEGOTIABLE):
- Every cv.Mat you allocate MUST be freed. Use: const t = newTracker(); try { ... } finally { releaseMats(t); }
- The Mat returned by rasterAt() is YOURS to free (call .delete() in finally).
- NEVER hold a Mat across await. Allocate, use, free in the same synchronous block.

DETECTION STRATEGY \u2014 Analyze the PDF visually and decide:
1. Is it a PLAN (top-down) or SECTION (cross-section)? Look for: plan = grid, room labels, column grids; section = elevation lines, hatching, foundation shapes.
2. What visual patterns indicate columns? (grey squares, dark circles, hatch patterns, specific colors, symbols)
3. What visual patterns indicate walls? (parallel lines, thick strokes, grey fills, hatch bands)
4. Are there color conventions? (e.g., red=structural, blue=MEP, green=landscape)
5. Are there hatch patterns? (45\u00b0 lines = concrete, cross-hatch = foundations, etc.)
6. What's the drawing scale? (look for scale bar, dimension text, or infer from known sizes)

OVERDETECT > UNDERDETECT: It's better to have false positives (extra detected elements) than false negatives (missed structural elements). The user can filter later.

EXISTING ALGORITHMS FOR REFERENCE:
- Britania: Grey columns (inRange 130-210), dark walls (threshold <100), directional morphology, hatch bridges between columns
- GlassWorks: Stroke pair detection (parallel lines), grey fill walls, corner clustering
- SUPER: Multi-pass, combines vector + raster, adaptive thresholds
- Unified v2: Vector-first (fills/strokes), raster fallback, section: hatch band analysis

OUTPUT FORMAT: Return ONLY the TypeScript code block. No explanations, no markdown outside the code block.

\`\`\`typescript
// Your generated algorithm here
\`\`\``;

export default async (req: Request, context: Context) => {
  // 1. Validate method
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 2. Parse body
  let body: GenerateRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!body.pdfBase64) {
    return new Response(JSON.stringify({ error: 'Missing pdfBase64' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 3. Get API key from env
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'AI service not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 4. Build prompt
  const prompt = `${SYSTEM_PROMPT}\n\nUSER CONTEXT:\n${body.userContext || '(none provided)'}\n\nAnalyze the PDF and generate the TypeScript detector code.`;

  // 5. Call Gemini API
  const model = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'application/pdf', data: body.pdfBase64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.2,
          topK: 32,
          topP: 0.95,
          maxOutputTokens: 8192,
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);

      // User-friendly error mapping
      let userError = 'Generation failed';
      if (response.status === 400) userError = 'Invalid request \u2014 PDF may be too large or corrupted';
      else if (response.status === 401) userError = 'Invalid API key \u2014 contact administrator';
      else if (response.status === 429) userError = 'Rate limit exceeded \u2014 try again in a moment';
      else if (response.status >= 500) userError = 'AI service temporarily unavailable';

      return new Response(JSON.stringify({ error: userError, details: errorText }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('No response from Gemini');

    // Extract TypeScript code block
    const codeMatch = text.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    const code = codeMatch ? codeMatch[1].trim() : text.trim();

    return new Response(JSON.stringify({ code, model } as GenerateResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (e) {
    console.error('Generation error:', e);
    return new Response(JSON.stringify({
      error: 'Generation failed',
      details: (e as Error).message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

export const config: Config = {
  maxDuration: 26,
};