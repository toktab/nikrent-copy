import { describe, expect, it } from 'vitest';
import type { Material } from '../../types';
import { validateRows } from '../sheetSchema';

const existing: Material[] = [
  {
    id: 'panel-45x300',
    name: 'პანელი 45*300',
    category: 'panel',
    w: 45,
    h: 300,
    depth: 9,
    shape: 'rect',
    color: '#c9a36a',
    builtin: true,
    stock: { main: 0 },
    weight: 0,
    article: '',
    supplier: '',
  },
];

const row = (over: Record<string, unknown> = {}) => ({
  name: 'პანელი 120*300',
  category: 'panel',
  width_cm: 120,
  height_cm: 300,
  ...over,
});

describe('validateRows', () => {
  it('accepts a well-formed row', () => {
    const result = validateRows([row()], existing);
    expect(result.okCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.rows[0].draft).toMatchObject({ name: 'პანელი 120*300', category: 'panel', w: 120, h: 300 });
  });

  it('defaults shape, colour and stock', () => {
    const draft = validateRows([row()], existing).rows[0].draft!;
    expect(draft.shape).toBe('rect');
    expect(draft.color).toBe('#c9a36a'); // category colour
    expect(Object.values(draft.stock).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('rejects a missing name', () => {
    const result = validateRows([row({ name: '' })], existing);
    expect(result.rows[0].draft).toBeNull();
    expect(result.rows[0].errors.join()).toMatch(/სახელი/);
  });

  it('rejects a non-positive size', () => {
    expect(validateRows([row({ width_cm: 0 })], existing).rows[0].draft).toBeNull();
    expect(validateRows([row({ height_cm: 'abc' })], existing).rows[0].draft).toBeNull();
  });

  it('rejects an unknown category', () => {
    const result = validateRows([row({ category: 'nonsense' })], existing);
    expect(result.rows[0].draft).toBeNull();
    expect(result.rows[0].errors.join()).toMatch(/კატეგორია/);
  });

  it('accepts Georgian category labels', () => {
    expect(validateRows([row({ category: 'პანელები' })], existing).rows[0].draft?.category).toBe('panel');
  });

  it('accepts header aliases', () => {
    const result = validateRows(
      [{ დასახელება: 'ტესტი', კატეგორია: 'panel', სიგანე: 50, სიმაღლე: 100 }],
      existing,
    );
    expect(result.rows[0].draft).toMatchObject({ name: 'ტესტი', w: 50, h: 100 });
  });

  it('maps shape aliases and warns on unknown ones', () => {
    expect(validateRows([row({ shape: 'L' })], existing).rows[0].draft?.shape).toBe('L');
    expect(validateRows([row({ shape: 'line' })], existing).rows[0].draft?.shape).toBe('line');
    const odd = validateRows([row({ shape: 'triangle' })], existing).rows[0];
    expect(odd.draft?.shape).toBe('rect');
    expect(odd.warnings.join()).toMatch(/ფორმა/);
  });

  it('reads weight, article and supplier', () => {
    const draft = validateRows(
      [row({ weight: 46.5, article: 'DU-1', supplier: 'Du' })],
      existing,
    ).rows[0].draft!;
    expect(draft.weight).toBe(46.5);
    expect(draft.article).toBe('DU-1');
    expect(draft.supplier).toBe('Du');
  });

  it('warns rather than fails on a duplicate name', () => {
    const result = validateRows([row({ name: 'პანელი 45*300' })], existing);
    expect(result.rows[0].draft).not.toBeNull();
    expect(result.rows[0].warnings.join()).toMatch(/უკვე არსებობს/);
  });

  it('warns on a bad colour and falls back to the category colour', () => {
    const parsed = validateRows([row({ color: 'nope' })], existing).rows[0];
    expect(parsed.draft?.color).toBe('#c9a36a');
    expect(parsed.warnings.join()).toMatch(/ფერი/);
  });

  it('accepts a colour without the leading hash', () => {
    expect(validateRows([row({ color: 'ff0000' })], existing).rows[0].draft?.color).toBe('#ff0000');
  });

  it('reports missing headers instead of importing nonsense', () => {
    const result = validateRows([{ foo: 'bar', baz: 1 }], existing);
    expect(result.headersMissing).toBe(true);
  });

  it('numbers rows as the user sees them (header is row 1)', () => {
    const result = validateRows([row(), row({ name: 'მეორე' })], existing);
    expect(result.rows.map((r) => r.row)).toEqual([2, 3]);
  });
});
