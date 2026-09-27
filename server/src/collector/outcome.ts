// What one collection attempt amounts to: observation status, failure class, and whether its
// price may be stored. Pure. This is where rule 6 lives: a blocked, failed or missing page never
// stores a price, and nothing is ever copied from an earlier reading.
import type { Validation } from '../lib/validate.js';
import { classifyFailure, isRetryable, type AttemptFacts } from './failure.js';
import type { Extracted, FailureClass } from './types.js';

export type ObservationStatus = 'ok' | 'partial' | 'held' | 'blocked' | 'not_found' | 'failed' | 'skipped_robots';

export interface Decision {
  status: ObservationStatus;
  failureClass: FailureClass | null;
  retryable: boolean;
  /** The values to store: `extracted` for ok / partial / held, all-null otherwise. */
  stored: Pick<Extracted, 'price' | 'listPrice' | 'currency'>;
}

const NO_PRICE = { price: null, listPrice: null, currency: null };

export function decideOutcome(facts: AttemptFacts, extracted: Extracted | null, validation: Validation | null): Decision {
  const failureClass = classifyFailure(facts);
  if (failureClass) {
    const status: ObservationStatus =
      failureClass === 'robots' ? 'skipped_robots' : failureClass === 'blocked' ? 'blocked' : failureClass === 'not_found' ? 'not_found' : 'failed';
    return { status, failureClass, retryable: isRetryable(failureClass), stored: NO_PRICE };
  }
  // No failure class means a price was read (product pages).
  const x = extracted!;
  const stored = { price: x.price, listPrice: x.listPrice, currency: x.currency ?? 'USD' };
  if (validation?.verdict === 'hold') return { status: 'held', failureClass: null, retryable: false, stored };
  const complete = x.availability !== 'unknown' && Boolean(x.sellerName);
  return { status: complete ? 'ok' : 'partial', failureClass: null, retryable: false, stored };
}
