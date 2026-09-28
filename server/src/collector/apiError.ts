/** An official API refused our credentials (401/403): failure class "auth", not retried. */
export class ApiAuthError extends Error {
  constructor(
    public api: string,
    public status: number,
  ) {
    super(`${api} refused the credentials (HTTP ${status})`);
  }
}
