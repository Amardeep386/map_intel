import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickSliceSkus, sliceTerms, type SliceProduct } from '../src/lib/amazonSlice.js';

const p = (code: string, category: string, modelFamily: string, status = 'Active'): SliceProduct => ({ code, name: `LG ${code}`, model: code, category, modelFamily, status });

// The shape of the LG demo catalogue: 5 gram lines, several families each.
const catalogue = [
  p('14Z90T-G.AAB2U1', 'gram', 'gram 14 (2025)'),
  p('14Z90T-G.ADB6U1', 'gram', 'gram 14 (2025)'),
  p('14Z90U-G.AS63U1', 'gram', 'gram 14 Copilot+ PC (2026)'),
  p('14Z90U-G.AU82U1', 'gram', 'gram 14 Copilot+ PC (2026)'),
  p('14Z95U-G.AS67U1', 'gram', 'gram 14 Copilot+ PC, AMD (2026)'),
  p('15Z90S-H.AAB5U1', 'gram', 'gram 15 (2024)'),
  p('14T90S-G.AAB4U1', 'gram 2-in-1', 'gram 2-in-1 14 (2024)'),
  p('15U50T-G.AAS3U1', 'gram Book', 'gram Book 15 (2025)'),
  p('15U50U-H.AA56U1', 'gram Book', 'gram Book 15 (2026)'),
  p('16Z90SP-A.ADB9U1', 'gram Pro', 'gram Pro 16 (2024)'),
  p('16Z90TS-G.AUG4U1', 'gram Pro', 'gram Pro 16 (2025)'),
  p('16T90SP-G.AAB6U1', 'gram Pro 2-in-1', 'gram Pro 2-in-1 16 (2024)'),
  p('16T95TP-K.AA77U1', 'gram Pro 2-in-1', 'gram Pro 2-in-1 16 (2026)'),
  p('00PAUSED', 'gram', 'gram 00', 'Paused'),
];

test('slice SKUs: round-robin over categories, one SKU per model family, active only', () => {
  assert.deepEqual(
    pickSliceSkus(catalogue).map((x) => x.code),
    ['14Z90T-G.AAB2U1', '14T90S-G.AAB4U1', '15U50T-G.AAS3U1', '16Z90SP-A.ADB9U1', '16T90SP-G.AAB6U1', '14Z90U-G.AS63U1', '15U50U-H.AA56U1', '16Z90TS-G.AUG4U1', '16T95TP-K.AA77U1', '14Z95U-G.AS67U1'],
  );
  // Input order does not matter.
  assert.deepEqual(pickSliceSkus([...catalogue].reverse()).map((x) => x.code), pickSliceSkus(catalogue).map((x) => x.code));
});

test('slice SKUs: fewer families than asked fills up in code order', () => {
  const two = [p('A2', 'x', 'f1'), p('A1', 'x', 'f1'), p('B1', 'x', 'f2')];
  assert.deepEqual(pickSliceSkus(two, 3).map((x) => x.code), ['A1', 'B1', 'A2']);
});

test('slice terms: a model-number and a name term per SKU', () => {
  const terms = sliceTerms(pickSliceSkus(catalogue));
  assert.equal(terms.length, 20);
  assert.deepEqual(terms.slice(0, 2), [
    { type: 'identifier', value: '14Z90T-G.AAB2U1', productCode: '14Z90T-G.AAB2U1' },
    { type: 'keyword', value: 'LG 14Z90T-G.AAB2U1', productCode: '14Z90T-G.AAB2U1' },
  ]);
});
