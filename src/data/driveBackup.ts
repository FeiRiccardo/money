import type { DriveFile } from '../domain/types';

export type { DriveFile };

/** The name of the one backup file kept in the hidden app folder. */
export const DRIVE_FILE_NAME = 'money-backup.zip';


/** The token ran out (the user has to reconnect), or Drive or the network failed. */
export type DriveProblem = { kind: 'expired' } | { kind: 'failed' };

export type SaveResult = { kind: 'saved'; file: DriveFile } | { kind: 'conflict'; remote: DriveFile } | DriveProblem;

export type LoadResult = { kind: 'loaded'; file: DriveFile; bytes: Uint8Array } | { kind: 'empty' } | DriveProblem;

export interface DriveBackup {
  /**
   * Saves the backup, unless Drive holds a copy `known` does not describe: one another device saved, or one
   * this device has never seen. Then nothing is written and that copy is returned as a conflict. Passing that
   * copy back as `known` overwrites it.
   */
  save(bytes: Uint8Array, known: DriveFile | null): Promise<SaveResult>;
  load(): Promise<LoadResult>;
}

const API = 'https://www.googleapis.com';

class Problem extends Error {
  constructor(readonly problem: DriveProblem) {
    super(problem.kind);
  }
}

export function createDriveBackup(token: string, fetchFn: typeof fetch = fetch): DriveBackup {
  async function call(url: string, init: RequestInit = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetchFn(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new Problem({ kind: 'failed' });
    }
    if (response.status === 401) throw new Problem({ kind: 'expired' });
    if (!response.ok) throw new Problem({ kind: 'failed' });
    return response;
  }

  async function current(): Promise<DriveFile | null> {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name = '${DRIVE_FILE_NAME}' and trashed = false`,
      fields: 'files(id,modifiedTime)',
      orderBy: 'modifiedTime desc',
    });
    const body = (await (await call(`${API}/drive/v3/files?${params}`)).json()) as { files?: DriveFile[] };
    return body.files?.[0] ?? null;
  }

  /** Drive's resumable upload: open a session (create or replace), then send the bytes in one request. */
  async function upload(bytes: Uint8Array, existing: DriveFile | null): Promise<DriveFile> {
    const target = existing
      ? `${API}/upload/drive/v3/files/${existing.id}?uploadType=resumable&fields=id,modifiedTime`
      : `${API}/upload/drive/v3/files?uploadType=resumable&fields=id,modifiedTime`;
    const metadata = existing ? {} : { name: DRIVE_FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/zip' };
    const opened = await call(target, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(metadata),
    });
    const session = opened.headers.get('location');
    if (!session) throw new Problem({ kind: 'failed' });
    const sent = await call(session, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: new Blob([bytes as BlobPart]) });
    const file = (await sent.json()) as Partial<DriveFile>;
    if (!file.id || !file.modifiedTime) throw new Problem({ kind: 'failed' });
    return { id: file.id, modifiedTime: file.modifiedTime };
  }

  async function guarded<T>(work: () => Promise<T>): Promise<T | DriveProblem> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Problem) return error.problem;
      return { kind: 'failed' };
    }
  }

  return {
    save(bytes, known) {
      return guarded(async (): Promise<SaveResult> => {
        const remote = await current();
        const seen = remote !== null && known !== null && remote.id === known.id && remote.modifiedTime === known.modifiedTime;
        if (remote && !seen) return { kind: 'conflict', remote };
        return { kind: 'saved', file: await upload(bytes, remote) };
      });
    },

    load() {
      return guarded(async (): Promise<LoadResult> => {
        const file = await current();
        if (!file) return { kind: 'empty' };
        const response = await call(`${API}/drive/v3/files/${file.id}?alt=media`);
        return { kind: 'loaded', file, bytes: new Uint8Array(await response.arrayBuffer()) };
      });
    },
  };
}
