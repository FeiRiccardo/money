import { describe, expect, it } from 'vitest';
import { consentUrl, readRedirect } from './googleAuth';

describe('consentUrl', () => {
  it('asks Google for a short-lived token to the hidden app folder only, returning to the app', () => {
    const url = new URL(
      consentUrl({ clientId: 'abc.apps.googleusercontent.com', redirectUri: 'https://example.github.io/money/', state: 's1' }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('abc.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://example.github.io/money/');
    expect(url.searchParams.get('response_type')).toBe('token');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.appdata');
    expect(url.searchParams.get('state')).toBe('s1');
    expect(url.searchParams.has('prompt')).toBe(false);
    expect(url.searchParams.has('login_hint')).toBe(false);
  });

  it('reconnects without showing anything, for the account used before', () => {
    const url = new URL(
      consentUrl({ clientId: 'abc', redirectUri: 'https://example.github.io/money/', state: 's2', silent: true, loginHint: 'me@example.com' }),
    );
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('login_hint')).toBe('me@example.com');
  });
});

describe('readRedirect', () => {
  const now = 1_000_000;

  it('reads the token and when it stops working, a minute early to be safe', () => {
    const result = readRedirect('#state=s1&access_token=tok&token_type=Bearer&expires_in=3599', 's1', now);
    expect(result).toEqual({ kind: 'token', token: 'tok', expiresAt: now + 3_539_000 });
  });

  it('ignores a return whose state is not the one this tab sent', () => {
    expect(readRedirect('#state=evil&access_token=tok&expires_in=3599', 's1', now)).toEqual({ kind: 'none' });
    expect(readRedirect('#state=s1&access_token=tok&expires_in=3599', null, now)).toEqual({ kind: 'none' });
  });

  it('reports a refusal', () => {
    expect(readRedirect('#state=s1&error=access_denied', 's1', now)).toEqual({ kind: 'error', error: 'access_denied' });
  });

  it('finds nothing in an ordinary address', () => {
    expect(readRedirect('', 's1', now)).toEqual({ kind: 'none' });
    expect(readRedirect('#month=2026-10', 's1', now)).toEqual({ kind: 'none' });
  });
});
