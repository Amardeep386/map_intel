// Minimal robots.txt check (User-agent: * group, longest-match Allow/Disallow, * and $ wildcards).
// Results are cached per host for 12 hours (15 minutes when robots.txt was unreachable).

interface Rule {
  allow: boolean;
  pattern: RegExp;
  length: number;
}

const cache = new Map<string, { rules: Rule[]; unreachable: string | null; expiresAt: number }>();
const TTL_MS = 12 * 3_600_000;
const UNREACHABLE_TTL_MS = 15 * 60_000;

function toRegex(path: string): RegExp {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

export function parseRobots(text: string): Rule[] {
  const rules: Rule[] = [];
  let inStarGroup = false;
  let groupHasRules = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') {
      if (groupHasRules) {
        inStarGroup = false;
        groupHasRules = false;
      }
      if (value === '*') inStarGroup = true;
    } else if (field === 'allow' || field === 'disallow') {
      groupHasRules = true;
      if (inStarGroup && value) rules.push({ allow: field === 'allow', pattern: toRegex(value), length: value.length });
    }
  }
  return rules;
}

export function isAllowed(rules: Rule[], pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (r.pattern.test(pathAndQuery) && (!best || r.length > best.length || (r.length === best.length && r.allow))) best = r;
  }
  return best ? best.allow : true;
}

/**
 * Follows RFC 9309 §2.3.1: 2xx -> parse rules; 4xx -> no rules (allowed); 5xx or network error ->
 * robots.txt is "unreachable" and the whole site is treated as disallowed. Unreachable results are
 * cached for a short time only, so the next run tries again.
 */
export async function robotsCheck(url: string, userAgent: string): Promise<{ allowed: boolean; reason: string }> {
  const u = new URL(url);
  const now = Date.now();
  let entry = cache.get(u.host);
  if (!entry || now > entry.expiresAt) {
    let rules: Rule[] = [];
    let unreachable: string | null = null;
    try {
      const res = await fetch(`${u.protocol}//${u.host}/robots.txt`, {
        headers: { 'user-agent': userAgent },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) rules = parseRobots(await res.text());
      else if (res.status >= 500) unreachable = `HTTP ${res.status}`;
    } catch (err) {
      unreachable = err instanceof Error ? err.message : String(err);
    }
    if (unreachable) console.warn(`[robots] robots.txt for ${u.host} unreachable (${unreachable}): treating site as disallowed`);
    entry = { rules, unreachable, expiresAt: now + (unreachable ? UNREACHABLE_TTL_MS : TTL_MS) };
    cache.set(u.host, entry);
  }
  if (entry.unreachable) return { allowed: false, reason: `robots.txt unreachable (${entry.unreachable}); site treated as disallowed` };
  return isAllowed(entry.rules, u.pathname + u.search)
    ? { allowed: true, reason: '' }
    : { allowed: false, reason: 'robots.txt disallows this URL for User-agent: *' };
}
