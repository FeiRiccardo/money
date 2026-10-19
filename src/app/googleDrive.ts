import { consentUrl, readRedirect } from '../domain/googleAuth';

/** Set at build time. Without it the Google Drive backup is not offered. */
export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

/** What the user was doing when they were sent to Google, so it can carry on when they come back. */
export type DriveIntent = 'connect' | 'restore';

export interface StoredToken {
  token: string;
  expiresAt: number;
}

const TOKEN_KEY = 'money.drive.token';
const PENDING_KEY = 'money.drive.pending';

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

export const forgetToken = (): void => writeKey(TOKEN_KEY, null);

/** The app's own address: Google sends the user back here, and it must be listed in the Google client. */
export const redirectUri = (): string => new URL('./', window.location.href).href;

/** Leaves the app for Google's consent page. The page comes back through `takeRedirect`. */
export function goToGoogle(intent: DriveIntent): void {
  const state = crypto.randomUUID();
  writeKey(PENDING_KEY, { state, intent });
  window.location.assign(consentUrl({ clientId: GOOGLE_CLIENT_ID, redirectUri: redirectUri(), state }));
}

export type Arrival = { kind: 'none' } | { kind: 'connected'; intent: DriveIntent } | { kind: 'refused' };

/** On start-up: keeps the token Google sent back, if any, and clears it from the address bar. */
export function takeRedirect(): Arrival {
  const pending = read<{ state: string; intent: DriveIntent }>(PENDING_KEY);
  const result = readRedirect(window.location.hash, pending?.state ?? null, Date.now());
  if (result.kind === 'none' || !pending) return { kind: 'none' };
  writeKey(PENDING_KEY, null);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (result.kind === 'error') return { kind: 'refused' };
  writeKey(TOKEN_KEY, { token: result.token, expiresAt: result.expiresAt });
  return { kind: 'connected', intent: pending.intent };
}
