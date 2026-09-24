// Subscription options validated against what the source's collector declared
// (source.options_schema, written from src/collector/catalogue.ts).
import type { SourceOption, TermCosts, TermType } from '../collector/catalogue.js';

export interface OptionsSchema {
  options: SourceOption[];
  costs: TermCosts;
}

export type OptionValues = Record<string, boolean | number | string>;

/** Merge `input` over the declared defaults. Unknown keys and wrong types are errors. */
export function resolveOptions(schema: OptionsSchema, input: Record<string, unknown> = {}): { values: OptionValues; errors: string[] } {
  const errors: string[] = [];
  const known = new Map(schema.options.map((o) => [o.key, o]));
  for (const key of Object.keys(input)) if (!known.has(key)) errors.push(`${key}: not an option of this source`);
  const values: OptionValues = {};
  for (const o of schema.options) {
    const v = input[o.key];
    if (v === undefined || v === null) {
      values[o.key] = o.default;
      continue;
    }
    if (o.type === 'boolean') {
      if (typeof v !== 'boolean') errors.push(`${o.key}: must be true or false`);
      else values[o.key] = v;
    } else if (o.type === 'integer') {
      if (typeof v !== 'number' || !Number.isInteger(v) || v < o.min || v > o.max) errors.push(`${o.key}: must be a whole number from ${o.min} to ${o.max}`);
      else values[o.key] = v;
    } else if (typeof v !== 'string' || !o.values.includes(v)) {
      errors.push(`${o.key}: must be one of ${o.values.join(', ')}`);
    } else {
      values[o.key] = v;
    }
  }
  return { values, errors };
}

/** Requests one term of `type` costs per cycle on a source with these option values. */
export function termCost(schema: OptionsSchema, values: OptionValues, type: TermType): number {
  const c = schema.costs[type];
  if (typeof c === 'number') return c;
  const v = values[c];
  if (typeof v === 'number') return v;
  const declared = schema.options.find((o) => o.key === c);
  return declared && declared.type === 'integer' ? declared.default : 1;
}
