import { describe, expect, it } from 'vitest';
import { createDriveBackup } from './driveBackup';
import { createFakeDrive } from './fakeDrive';

const bytes = (...values: number[]) => new Uint8Array(values);

function setup() {
  const drive = createFakeDrive({ token: 'tok' });
  const backup = createDriveBackup('tok', drive.fetch);
  return { drive, backup };
}

describe('Drive backup', () => {
  it('saves the backup as one file in the hidden app folder and loads it back', async () => {
    const { drive, backup } = setup();
    const saved = await backup.save(bytes(1, 2, 3), null);
    expect(saved.kind).toBe('saved');
    expect(drive.appFiles().map((f) => f.name)).toEqual(['money-backup.zip']);

    const loaded = await backup.load();
    expect(loaded.kind === 'loaded' && [...loaded.bytes]).toEqual([1, 2, 3]);
    expect(loaded.kind === 'loaded' && saved.kind === 'saved' && loaded.file).toEqual(saved.kind === 'saved' && saved.file);
  });

  it('replaces its own earlier save, keeping one file', async () => {
    const { drive, backup } = setup();
    const first = await backup.save(bytes(1), null);
    const second = await backup.save(bytes(2), first.kind === 'saved' ? first.file : null);
    expect(second.kind).toBe('saved');
    expect(drive.appFiles().map((f) => [...f.bytes])).toEqual([[2]]);
  });

  it('does not overwrite a copy another device saved since', async () => {
    const { drive, backup } = setup();
    const first = await backup.save(bytes(1), null);
    const theirs = drive.writeFromAnotherDevice('money-backup.zip', bytes(9));

    const result = await backup.save(bytes(2), first.kind === 'saved' ? first.file : null);
    expect(result).toEqual({ kind: 'conflict', remote: theirs });
    expect(drive.appFiles().map((f) => [...f.bytes])).toEqual([[9]]);
  });

  it('does not overwrite a copy this device has never seen', async () => {
    const { drive, backup } = setup();
    const theirs = drive.writeFromAnotherDevice('money-backup.zip', bytes(9));
    expect(await backup.save(bytes(2), null)).toEqual({ kind: 'conflict', remote: theirs });
  });

  it('overwrites the other copy when told to replace it', async () => {
    const { drive, backup } = setup();
    const theirs = drive.writeFromAnotherDevice('money-backup.zip', bytes(9));
    expect((await backup.save(bytes(2), theirs)).kind).toBe('saved');
    expect(drive.appFiles().map((f) => [...f.bytes])).toEqual([[2]]);
  });

  it('tells which copy Drive holds, without downloading it', async () => {
    const { drive, backup } = setup();
    expect(await backup.latest()).toEqual({ kind: 'empty' });
    const theirs = drive.writeFromAnotherDevice('money-backup.zip', bytes(9));
    expect(await backup.latest()).toEqual({ kind: 'found', file: theirs });
  });

  it('finds nothing to restore in an empty Drive', async () => {
    expect(await setup().backup.load()).toEqual({ kind: 'empty' });
  });

  it('says when the token has run out, so the user can reconnect', async () => {
    const { drive, backup } = setup();
    drive.expireToken();
    expect(await backup.save(bytes(1), null)).toEqual({ kind: 'expired' });
    expect(await backup.load()).toEqual({ kind: 'expired' });
    expect(await backup.latest()).toEqual({ kind: 'expired' });
  });

  it('reports a network failure without throwing', async () => {
    const offline = createDriveBackup('tok', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await offline.save(bytes(1), null)).toEqual({ kind: 'failed' });
    expect(await offline.load()).toEqual({ kind: 'failed' });
  });
});
