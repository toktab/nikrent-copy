import { describe, expect, it } from 'vitest';
import { applySizeFixes } from '../useEditorStore';
import { createSeedMaterials, defaultDepth } from '../../data/seedCatalog';
import type { Material } from '../../types';

/**
 * These run against the real module, so importing this file also proves the
 * store module evaluates cleanly. That matters more than it looks: this helper
 * is called during rehydration, while the store is still being built, and the
 * persist middleware swallows anything thrown there — the saved drawing is
 * dropped and then overwritten with an empty one, with no error anywhere.
 * A `const` table declared below `create()` is exactly that failure.
 */

const corner = (over: Partial<Material> = {}): Material => ({
  id: 'corner-outer-300',
  name: 'გარე კუთხე 300',
  category: 'corner',
  w: 15,
  h: 300,
  depth: 15,
  shape: 'L',
  color: '#7cb342',
  builtin: true,
  stock: {},
  weight: 0,
  article: '',
  supplier: '',
  ...over,
});

describe('applySizeFixes', () => {
  it('turns the 24 cm outer corner into the architect\'s thin 10 × 10 angle', () => {
    const materials = [corner({ w: 24, depth: 24 })];
    applySizeFixes(materials);
    expect(materials[0].w).toBe(10);
    expect(materials[0].depth).toBe(defaultDepth('corner', 10, 300));
    expect(materials[0].leg).toBe(0.1);
  });

  it('takes a catalog saved by the v1 port all the way in one load', () => {
    const materials = [corner()];
    applySizeFixes(materials);
    expect(materials[0]).toMatchObject({ w: 10, depth: 10, leg: 0.1 });
  });

  it('gives the leg back when a server one migration behind dropped it', () => {
    const materials = [corner({ w: 10, depth: 10 })];
    applySizeFixes(materials);
    expect(materials[0].leg).toBe(0.1);
  });

  it('keeps a leg the company typed in itself', () => {
    const materials = [corner({ w: 10, depth: 10, leg: 0.3 })];
    applySizeFixes(materials);
    expect(materials[0].leg).toBe(0.3);
  });

  it('leaves a size the company has already changed alone', () => {
    const materials = [corner({ w: 18, depth: 18 })];
    applySizeFixes(materials);
    expect(materials[0].w).toBe(18);
    expect(materials[0].leg).toBeUndefined();
  });

  it('never touches a material the user created themselves', () => {
    const materials = [corner({ builtin: false })];
    applySizeFixes(materials);
    expect(materials[0].w).toBe(15);
  });

  it('is a no-op on a catalog that does not contain the material', () => {
    const materials: Material[] = [];
    expect(() => applySizeFixes(materials)).not.toThrow();
  });

  it('is idempotent, so repeated loads do not drift', () => {
    const materials = [corner()];
    applySizeFixes(materials);
    applySizeFixes(materials);
    expect(materials[0]).toMatchObject({ w: 10, depth: 10, leg: 0.1 });
  });

  it('leaves a fresh seed catalog unchanged — the seed already carries the fix', () => {
    const seeded = createSeedMaterials();
    const key = (m: Material) => `${m.id}:${m.w}x${m.h}x${m.depth}:${m.leg ?? '-'}`;
    const before = seeded.map(key);
    applySizeFixes(seeded);
    expect(seeded.map(key)).toEqual(before);
  });
});
