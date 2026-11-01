/**
 * Wave M5 — client-side account standing helper.
 *
 * One cached call to the getMyAccountStanding server function per browser
 * session, shared by the root suspension banner and the client-side guards
 * on messaging, proposals and listing publishing. The authoritative checks
 * live server-side (e.g. project checkout); these guards exist so a
 * suspended user gets a clear message instead of a failed request.
 *
 * Failure-open for reads by design: if the standing check itself fails
 * (offline, function unavailable), the user is treated as not suspended so
 * browsing and reading never break because of an enforcement hiccup.
 */

export interface AccountStanding {
  suspended: boolean;
  state: string | null;
  reason: string | null;
}

const NOT_SUSPENDED: AccountStanding = { suspended: false, state: null, reason: null };

let cached: Promise<AccountStanding> | null = null;

export function fetchMyStanding(): Promise<AccountStanding> {
  if (!cached) {
    cached = (async () => {
      try {
        const { getMyAccountStanding } = await import("./account-standing.functions");
        const result = await getMyAccountStanding({ data: {} });
        return {
          suspended: !!result.suspended,
          state: result.state ?? null,
          reason: result.reason ?? null,
        };
      } catch {
        return NOT_SUSPENDED;
      }
    })();
  }
  return cached;
}

/** Drop the cached standing (call on sign-in / sign-out). */
export function clearStandingCache(): void {
  cached = null;
}
