// Who can do what. Every API route declares one of these in its route config (see api/app.ts);
// a route without a declared permission fails at startup.

export const ACCOUNT_ROLES = ['Administrator', 'Account manager', 'Analyst', 'Brand user'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Actions inside one account. The account comes from the :accountId route parameter. */
export const ACCOUNT_ACTIONS = [
  'account.read', // account header, catalogue list entry
  'catalogue.read', // products, identifiers, MAP
  'catalogue.write', // products, identifiers, imports, MAP history, promotions, policy documents
  'mapping.read', // Mapping Center: candidates, decisions, rules, suppressions
  'mapping.write', // include / exclude / retire listings, rules, suppressions
  'sellers.read', // sellers, classification history, aliases, links, contacts
  'sellers.write',
  'observations.read', // observations and evidence
  'settings.read',
  'settings.write',
  'sources.read', // subscriptions, matrix, cost estimate
  'sources.write',
  'terms.read',
  'terms.write',
  'schedules.read',
  'schedules.write',
  'users.read',
  'users.manage',
  'audit.read',
  'credentials.read', // metadata only; secrets are never returned
  'credentials.write',
  'health.read', // Data Health: source health, failures
  'collection.run', // re-run failed jobs
  'violations.read', // violations, verdicts, Overview, evidence links
  'violations.write', // status changes (dismiss, under notice, ...), evidence links
  'rules.read',
  'rules.write', // drafts, dry runs, publish, replay
  'reports.read', // report definitions, repository, hosted reports
  'reports.write', // define, schedule, run now
  'alerts.read',
  'alerts.write',
  'cases.read', // enforcement cases, notices, communications
  'cases.write', // open / move / assign cases, add violations, draft / send notices, log communications
  'notices.approve', // brand approval of a notice: the brand's own people only
] as const;
export type AccountAction = (typeof ACCOUNT_ACTIONS)[number];

/**
 * Route-level permission:
 *  - 'public'   no sign-in (health, login, accept invite)
 *  - 'user'     signed in; the handler checks account access itself (e.g. /accounts, /evidence/:id)
 *  - 'platform' Mirethos platform administrators only (shared source catalogue, crawl runs)
 *  - an AccountAction, checked against the caller's role in :accountId
 */
export type RoutePermission = 'public' | 'user' | 'platform' | AccountAction;

const READ_ALL: AccountAction[] = [
  'account.read',
  'catalogue.read',
  'mapping.read',
  'sellers.read',
  'observations.read',
  'settings.read',
  'sources.read',
  'terms.read',
  'schedules.read',
  'users.read',
  'audit.read',
  'credentials.read',
  'health.read',
  'violations.read',
  'rules.read',
  'reports.read',
  'alerts.read',
  'cases.read',
];

const GRANTS: Record<AccountRole, ReadonlySet<AccountAction>> = {
  // Everything except brand approval of notices, which only the brand's people give.
  Administrator: new Set(ACCOUNT_ACTIONS.filter((a) => a !== 'notices.approve')),
  // Configures the account: settings, subscriptions, schedules, terms, users, credentials.
  'Account manager': new Set(ACCOUNT_ACTIONS.filter((a) => a !== 'notices.approve')),
  // Cleanses and classifies: edits terms and the catalogue, reads everything else.
  Analyst: new Set<AccountAction>([...READ_ALL, 'terms.write', 'catalogue.write', 'mapping.write', 'sellers.write', 'violations.write', 'cases.write']),
  // The brand's own people: read-only catalogue, prices, violations, reports and cases; they approve
  // notices. No configuration or audit screens.
  'Brand user': new Set<AccountAction>(['account.read', 'catalogue.read', 'observations.read', 'violations.read', 'reports.read', 'cases.read', 'notices.approve']),
};

export function can(role: string | null | undefined, action: AccountAction): boolean {
  if (!role || !(role in GRANTS)) return false;
  return GRANTS[role as AccountRole].has(action);
}

/** Every action a role has, for the portal (hides screens and buttons the user cannot use). */
export function actionsFor(role: string | null | undefined): AccountAction[] {
  if (!role || !(role in GRANTS)) return [];
  return ACCOUNT_ACTIONS.filter((a) => GRANTS[role as AccountRole].has(a));
}

/** Roles a caller may hand out. Only Administrators can grant Administrator. */
export function grantableRoles(callerRole: string | null | undefined): AccountRole[] {
  if (callerRole === 'Administrator') return [...ACCOUNT_ROLES];
  if (callerRole === 'Account manager') return ['Account manager', 'Analyst', 'Brand user'];
  return [];
}
