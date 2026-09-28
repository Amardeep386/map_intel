// Failure classes: why a job did not produce a price. They drive retries and the "Error class"
// column of Data Health. Pure: no I/O.
import type { Availability, BlockReason, FailureClass } from './types.js';

export interface AttemptFacts {
  robotsDisallowed?: boolean;
  /** An official API refused our key (401/403) or the key is missing for an API-only source. */
  authFailed?: boolean;
  /** The request never produced a response (message of the error). */
  fetchError?: string | null;
  httpStatus?: number | null;
  block?: BlockReason;
  kind: 'product' | 'results';
  // product pages
  price?: number | null;
  title?: string | null;
  availability?: Availability;
  // results pages
  items?: number;
  recognized?: boolean;
}

/** The failure class for one attempt, or null when it succeeded. */
export function classifyFailure(f: AttemptFacts): FailureClass | null {
  if (f.robotsDisallowed) return 'robots';
  if (f.authFailed) return 'auth';
  if (f.fetchError) return /timeout|timed out|aborted/i.test(f.fetchError) ? 'timeout' : 'network';
  if (f.block) return 'blocked';
  const status = f.httpStatus ?? 0;
  if (status === 404 || status === 410) return 'not_found';
  if (status === 401 || status === 403 || status === 429) return 'blocked';
  if (status >= 500) return 'network';
  if (f.kind === 'results') {
    if (f.recognized === false) return 'layout_changed';
    return (f.items ?? 0) === 0 ? 'empty' : null;
  }
  if (f.price !== null && f.price !== undefined) return null;
  // A readable product page that simply shows no price (sold out, no offer) is "empty";
  // a page we cannot read at all means the extractor no longer fits the layout.
  if (f.title && (f.availability === 'out_of_stock' || f.availability === 'preorder')) return 'empty';
  return 'layout_changed';
}

/** Worth another attempt later (with the browser on the second try)? */
export function isRetryable(c: FailureClass | null): boolean {
  return c === 'timeout' || c === 'network' || c === 'blocked';
}
