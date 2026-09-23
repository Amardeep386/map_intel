// Minimal robots.txt check (User-agent: * group, longest-match Allow/Disallow, * and $ wildcards).
// Results are cached per host for 12 hours.

interface Rule {
  allow: boolean;
  pattern: RegExp;
  length: number;
}

const cache = new Map<string, { rules: Rule[]; fetchedAt: number }>();
const TTL_MS = 12 * 3_600_000;

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

export async function robotsAllows(url: string, userAgent: string): Promise<boolean> {
  const u = new URL(url);
  const now = Date.now();
  let entry = cache.get(u.host);
  if (!entry || now - entry.fetchedAt > TTL_MS) {
    let rules: Rule[] = [];
    try {
      const res = await fetch(`${u.protocol}//${u.host}/robots.txt`, {
        headers: { 'user-agent': userAgent },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) rules = parseRobots(await res.text());
    } catch {
      // Unreachable robots.txt: treat as no rules (standard behaviour), but log it.
      console.warn(`[robots] could not read robots.txt for ${u.host}`);
    }
    entry = { rules, fetchedAt: now };
    cache.set(u.host, entry);
  }
  return isAllowed(entry.rules, u.pathname + u.search);
}
