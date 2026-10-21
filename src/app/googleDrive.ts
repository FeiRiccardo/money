import { consentUrl, readRedirect } from '../domain/googleAuth';

/** Set at build time. Without it the Google Drive backup is not offered. */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

/**
 * What the user was doing when they were sent to Google, so it can carry on when they come back.
 * `reconnect` is the app's own trip on opening, after the token ran out: Google is asked to show nothing.
 */
export type DriveIntent = 'connect' | 'restore' | 'reconnect';

export interface StoredToken {
  token: string;
  expiresAt: number;
}

const TOKEN_KEY = 'money.drive.token';
const PENDING_KEY = 'money.drive.pending';
/** The Google account's email, so a silent reconnect picks it in a browser signed in to several. */
const ACCOUNT_KEY = 'money.drive.account';
/** When the last silent reconnect failed (signed out of Google, say): the app does not try again for a while. */
const SILENT_FAILED_KEY = 'money.drive.silentFailedAt';

/** After a failed silent reconnect, opening the app again within this time does not go to Google. */
const SILENT_RETRY_MS = 60 * 60 * 1000;

// Browser storage can throw (private mode, blocked site data); Drive then simply needs connecting again.
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeKey(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do: see `read`.
  }
}

/** The last token Google gave this device, even if it has run out (null after Disconnect). */
export const storedToken = (): StoredToken | null => read<StoredToken>(TOKEN_KEY);

/** Disconnect: forgets the token, the account and any failed reconnect. */
export function forgetToken(): void {
  writeKey(TOKEN_KEY, null);
  writeKey(ACCOUNT_KEY, null);
  writeKey(SILENT_FAILED_KEY, null);
}

export const storedAccount = (): string | null => read<string>(ACCOUNT_KEY);

export const rememberAccount = (email: string): void => writeKey(ACCOUNT_KEY, email);

/** True when the token has run out and the app may go to Google by itself to get a new one. */
export function maySilentlyReconnect(now: number): boolean {
  const token = storedToken();
  if (!token || token.expiresAt > now) return false;
  const failedAt = read<number>(SILENT_FAILED_KEY);
  return failedAt === null || now - failedAt > SILENT_RETRY_MS;
}

/** The app's own address: Google sends the user back here, and it must be listed in the Google client. */
export const redirectUri = (): string => new URL('./', window.location.href).href;

/** Leaves the app for Google's consent page. The page comes back through `takeRedirect`. */
export function goToGoogle(intent: DriveIntent): void {
  const state = crypto.randomUUID();
  writeKey(PENDING_KEY, { state, intent });
  window.location.assign(
    consentUrl({
      clientId: GOOGLE_CLIENT_ID,
      redirectUri: redirectUri(),
      state,
      silent: intent === 'reconnect',
      loginHint: storedAccount() ?? undefined,
    }),
  );
}

export type Arrival = { kind: 'none' } | { kind: 'connected'; intent: DriveIntent } | { kind: 'refused'; intent: DriveIntent };

/** On start-up: keeps the token Google sent back, if any, and clears it from the address bar. */
export function takeRedirect(): Arrival {
  const pending = read<{ state: string; intent: DriveIntent }>(PENDING_KEY);
  const result = readRedirect(window.location.hash, pending?.state ?? null, Date.now());
  if (result.kind === 'none' || !pending) return { kind: 'none' };
  writeKey(PENDING_KEY, null);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (result.kind === 'error') {
    if (pending.intent === 'reconnect') writeKey(SILENT_FAILED_KEY, Date.now());
    return { kind: 'refused', intent: pending.intent };
  }
  writeKey(TOKEN_KEY, { token: result.token, expiresAt: result.expiresAt });
  writeKey(SILENT_FAILED_KEY, null);
  return { kind: 'connected', intent: pending.intent };
}
