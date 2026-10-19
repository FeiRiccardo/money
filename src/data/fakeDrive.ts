/**
 * Test double: an in-memory Google Drive that answers the few REST calls the Drive backup makes, the way
 * Drive does. Used by the unit tests (as `fetch`) and by the browser tests (behind `page.route`).
 */

export interface FakeRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

export interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

interface StoredFile {
  id: string;
  name: string;
  parents: string[];
  bytes: Uint8Array;
  modifiedTime: string;
}

const encoder = new TextEncoder();
const json = (status: number, value: unknown, headers: Record<string, string> = {}): FakeResponse => ({
  status,
  headers: { 'content-type': 'application/json', ...headers },
  body: encoder.encode(JSON.stringify(value)),
});

export function createFakeDrive(options: { token: string }) {
  let token = options.token;
  let tick = 0;
  let nextId = 1;
  const files = new Map<string, StoredFile>();
  const sessions = new Map<string, { fileId: string | null; name: string; parents: string[] }>();
  const stamp = () => new Date(Date.UTC(2026, 0, 1) + ++tick * 1000).toISOString();
  const view = (f: StoredFile) => ({ id: f.id, modifiedTime: f.modifiedTime });

  function store(fileId: string | null, name: string, parents: string[], bytes: Uint8Array): StoredFile {
    const id = fileId ?? `file${nextId++}`;
    const file: StoredFile = { id, name, parents, bytes, modifiedTime: stamp() };
    files.set(id, file);
    return file;
  }

  function handle(request: FakeRequest): FakeResponse {
    const url = new URL(request.url);
    const session = url.origin === 'https://upload.fake' ? sessions.get(url.pathname) : undefined;
    if (session) {
      if (request.method !== 'PUT') return json(405, {});
      sessions.delete(url.pathname);
      return json(200, view(store(session.fileId, session.name, session.parents, request.body ?? new Uint8Array())));
    }
    if (url.origin !== 'https://www.googleapis.com') return json(404, {});
    if (request.headers['authorization'] !== `Bearer ${token}`) return json(401, { error: { code: 401 } });

    const path = url.pathname;
    if (request.method === 'GET' && path === '/drive/v3/files') {
      if (url.searchParams.get('spaces') !== 'appDataFolder') return json(400, {});
      const name = /name\s*=\s*'([^']+)'/.exec(url.searchParams.get('q') ?? '')?.[1];
      const found = [...files.values()]
        .filter((f) => f.parents.includes('appDataFolder') && (name === undefined || f.name === name))
        .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
      return json(200, { files: found.map(view) });
    }
    const fileMatch = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (request.method === 'GET' && fileMatch && url.searchParams.get('alt') === 'media') {
      const file = files.get(fileMatch[1]);
      return file ? { status: 200, headers: { 'content-type': 'application/zip' }, body: file.bytes } : json(404, {});
    }
    const uploadMatch = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(path);
    if (uploadMatch && url.searchParams.get('uploadType') === 'resumable') {
      const meta = JSON.parse(new TextDecoder().decode(request.body ?? encoder.encode('{}'))) as {
        name?: string;
        parents?: string[];
      };
      const existing = uploadMatch[1] ? files.get(uploadMatch[1]) : undefined;
      if (request.method === 'PATCH' && !existing) return json(404, {});
      if (request.method === 'POST' && uploadMatch[1]) return json(405, {});
      const sessionPath = `/session/${nextId++}`;
      sessions.set(sessionPath, {
        fileId: existing?.id ?? null,
        name: existing?.name ?? meta.name ?? 'Untitled',
        parents: existing?.parents ?? meta.parents ?? [],
      });
      return json(200, {}, { location: `https://upload.fake${sessionPath}` });
    }
    return json(404, {});
  }

  /** A `fetch` that talks to this fake Drive. */
  async function fakeFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    const raw = init.body;
    const body =
      raw == null ? null : typeof raw === 'string' ? encoder.encode(raw) : raw instanceof Uint8Array ? raw : new Uint8Array(await new Response(raw).arrayBuffer());
    const result = handle({ method: init.method ?? 'GET', url: String(input), headers, body });
    return new Response(result.status === 204 ? null : (result.body.slice().buffer as ArrayBuffer), {
      status: result.status,
      headers: result.headers,
    });
  }

  return {
    handle,
    fetch: fakeFetch,
    /** The files in the hidden app folder. */
    appFiles: () => [...files.values()].filter((f) => f.parents.includes('appDataFolder')),
    /** Another device saves its backup. */
    writeFromAnotherDevice(name: string, bytes: Uint8Array) {
      const current = [...files.values()].find((f) => f.name === name && f.parents.includes('appDataFolder'));
      return view(store(current?.id ?? null, name, ['appDataFolder'], bytes));
    },
    /** The user's token runs out. */
    expireToken() {
      token = `${token}-expired`;
    },
  };
}
