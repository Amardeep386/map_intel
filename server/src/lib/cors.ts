// CORS_ORIGINS is a comma-separated list typed into a dashboard. Browsers send the origin as
// scheme://host[:port] with no path or trailing slash, and CORS compares exactly, so a value like
// "https://portal.vercel.app/" or '"https://portal.vercel.app"' would silently block the portal.
export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim().replace(/^["']+|["']+$/g, '').trim().replace(/\/+$/, ''))
    .filter(Boolean);
}
