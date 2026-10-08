import type { Config } from '@netlify/functions';
import { generateAlgorithm, type GenerateRequest } from '../../shared/generateAlgorithm';

/**
 * Netlify's side of the detector generator. The work is in
 * `shared/generateAlgorithm.ts`; this only speaks Netlify's dialect - a
 * Request in, a Response out - so the same code can run on another host
 * without being rewritten.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export default async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const outcome = await generateAlgorithm(body);
  return json(outcome.status, outcome.body);
};

export const config: Config = {
  maxDuration: 26,
};
