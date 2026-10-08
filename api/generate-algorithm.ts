import { generateAlgorithm, type GenerateRequest } from '../shared/generateAlgorithm';

/**
 * Vercel's side of the detector generator - the same work as the Netlify
 * function, in the shape Vercel's Node runtime expects.
 *
 * The frontend still calls `/.netlify/functions/generate-algorithm`, because
 * that path is also what the Vite dev proxy serves; `vercel.json` rewrites it
 * here. Keeping the one path means the page does not have to know, or guess,
 * which host it is running on.
 *
 * Typed structurally rather than against `@vercel/node`: this is the only
 * thing in the repo that would need that package, and a dependency for two
 * interfaces is not worth the install.
 */

interface NodeRequest {
  method?: string;
  body?: unknown;
  setEncoding(encoding: string): void;
  on(event: 'data' | 'end' | 'error', handler: (chunk?: unknown) => void): void;
}

interface NodeResponse {
  status(code: number): NodeResponse;
  json(body: unknown): void;
}

/** Vercel parses a JSON body for us; a raw stream is the fallback. */
async function readBody(req: NodeRequest): Promise<GenerateRequest | null> {
  if (req.body && typeof req.body === 'object') return req.body as GenerateRequest;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as GenerateRequest;
    } catch {
      return null;
    }
  }
  const raw = await new Promise<string>((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      text += chunk as string;
    });
    req.on('end', () => resolve(text));
    req.on('error', (e) => reject(e));
  }).catch(() => '');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GenerateRequest;
  } catch {
    return null;
  }
}

export default async function handler(req: NodeRequest, res: NodeResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = await readBody(req);
  if (!body) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const outcome = await generateAlgorithm(body);
  res.status(outcome.status).json(outcome.body);
}
