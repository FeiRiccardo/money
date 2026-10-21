/** Access to a hidden folder in the user's Drive that only this app can see, not their files. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

/** Treat a token as expired this long before Google says, so a save never starts with a dying token. */
const SAFETY_MS = 60_000;

/**
 * Google's consent page for the token flow: Google sends the user back to `redirectUri` with the token in the
 * address fragment. A static site cannot keep a client secret, so there is no refresh token.
 * `silent` asks Google to show nothing: it sends a new token at once if the user is still signed in and has
 * agreed before, or an error otherwise. `loginHint` names the account, for browsers signed in to several.
 */
export function consentUrl({
  clientId,
  redirectUri,
  state,
  silent = false,
  loginHint,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
  silent?: boolean;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: DRIVE_SCOPE,
    state,
    include_granted_scopes: 'true',
  });
  if (silent) params.set('prompt', 'none');
  if (loginHint) params.set('login_hint', loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export type RedirectResult =
  | { kind: 'none' }
  | { kind: 'token'; token: string; expiresAt: number }
  | { kind: 'error'; error: string };

/** Reads Google's answer from the address fragment. Anything without the `state` this tab sent is ignored. */
export function readRedirect(hash: string, expectedState: string | null, now: number): RedirectResult {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (expectedState === null || params.get('state') !== expectedState) return { kind: 'none' };
  const error = params.get('error');
  if (error) return { kind: 'error', error };
  const token = params.get('access_token');
  const seconds = Number(params.get('expires_in'));
  if (!token || !Number.isFinite(seconds)) return { kind: 'none' };
  return { kind: 'token', token, expiresAt: now + seconds * 1000 - SAFETY_MS };
}
