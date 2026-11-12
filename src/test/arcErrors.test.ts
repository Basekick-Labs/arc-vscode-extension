/**
 * Arc's refusals, and what the extension does with each one.
 *
 * These are the extension's first unit tests. They run under `node:test`
 * against the compiled output, so nothing here may touch the `vscode` module —
 * the classifier and the Arc HTTP client are both free of it on purpose.
 *
 * Every body below is one Arc actually sends (main and 26.09.4; the source
 * location is noted where it is not obvious). The 403s all share a status code
 * and differ only in message, which is exactly why they are easy to collapse
 * and worth pinning: reporting a scoped token as a bad token, a missing admin
 * permission as a missing read permission, or a broken permission store as a
 * scoped token, sends the user somewhere that cannot fix the problem.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import MockAdapter from 'axios-mock-adapter';

import { ArcClient } from '../api/arcClient';
import { ArcAccessError, arcErrorMessage, classifyArcError, isScopedRefusal } from '../utils/arcErrors';
import { ArcConnection } from '../types';

// --- The bodies -------------------------------------------------------------

const NO_TOKEN = { success: false, error: 'Authentication required' };
const BAD_TOKEN = { success: false, error: 'Invalid or expired token' };

// Coarse refusals: the token carries no read permission at all.
const NO_READ = { success: false, error: "token does not have 'read' permission" };
const OSS_NO_READ = { success: false, error: 'Permission denied: read required' };

// The handler gates on the query path, which is what this extension uses.
// SHOW DATABASES for a scoped token: Arc 26.09 and earlier (newer Arc lists).
const SCOPED_LIST = { success: false, error: 'access denied: no read permission to list databases' };
const SCOPED_DB = { success: false, error: "access denied: no read permission for database 'metrics'" };
// SELECT on a measurement the token's role does not cover (query.go "%s.%s").
const SCOPED_ONE_MEASUREMENT = { success: false, error: 'access denied: no read permission for metrics.mem' };
const SCOPED_MEASUREMENT = { success: false, error: 'access denied: no read permission for metrics.*' };
// Unscoped /api/v1/measurements for a scoped token on 26.09.4.
const SCOPED_WILDCARD = { success: false, error: 'access denied: no read permission for *.*' };

// The resource-scoped read middleware, used by the database listing routes.
const SCOPED_MIDDLEWARE = { success: false, error: "no permission for read on database 'metrics'" };
const SCOPED_MIDDLEWARE_EMPTY = { success: false, error: "no permission for read on database ''" };

// Arc could not load the token's grants and refused rather than guess. Arc
// main answers 503 at the query door (auth/middleware.go); the 403 shape is
// kept for older servers.
const STORE_UNAVAILABLE = { success: false, error: 'Permission store unavailable; retry later', reason: 'hub_unavailable' };
const UNAVAILABLE = { success: false, error: 'permission data unavailable' };

// Refusals that are NOT about reading: shown as Arc wrote them.
const ADMIN_REQUIRED = { success: false, error: 'Permission denied: admin required' };
const WRITE_REQUIRED = { success: false, error: 'Permission denied: write required' };
const NO_WRITE_FOR_MEASUREMENT = { success: false, error: 'access denied: no write permission for metrics.cpu' };
const DELETE_DISABLED = { success: false, error: 'Delete operations are disabled. Set delete.enabled=true in arc.toml to enable.' };
const INSUFFICIENT = { success: false, error: 'Insufficient permissions' };

const LICENSE = { success: false, error: "RBAC requires an enterprise license with the 'rbac' feature enabled" };
const NOT_FOUND = { error: "Database 'ghost' not found" };
const NO_ROUTE = { error: 'Cannot GET /api/v1/nope' };

const SHOW_DATABASES_OK = { success: true, columns: ['database'], data: [['metrics'], ['logs']] };
const SHOW_TABLES_OK = { success: true, columns: ['database', 'table_name'], data: [['metrics', 'cpu']] };

// --- Harness ----------------------------------------------------------------

const connection: ArcConnection = {
  id: 'test',
  name: 'test',
  protocol: 'http',
  host: 'localhost',
  port: 8000
} as ArcConnection;

function client(): { arc: ArcClient; mock: MockAdapter } {
  const arc = new ArcClient(connection, 'tok');
  // Reach the instance's own axios client so the adapter intercepts the same
  // interceptors (and therefore the same Authorization header) the extension
  // uses in production.
  const mock = new MockAdapter((arc as unknown as { client: never }).client);
  return { arc, mock };
}

// --- classifyArcError -------------------------------------------------------

describe('classifyArcError', () => {
  const cases: Array<{ name: string; status: number; body: { error?: string; reason?: string }; kind: string; database?: string; measurement?: string }> = [
    { name: '401 with no token', status: 401, body: NO_TOKEN, kind: 'auth' },
    { name: '401 with a bad token', status: 401, body: BAD_TOKEN, kind: 'auth' },

    { name: 'SHOW DATABASES refused for a scoped token', status: 403, body: SCOPED_LIST, kind: 'scoped' },
    { name: 'SHOW TABLES FROM db refused', status: 403, body: SCOPED_DB, kind: 'scoped', database: 'metrics' },
    { name: 'measurement listing refused', status: 403, body: SCOPED_MEASUREMENT, kind: 'scoped', database: 'metrics' },
    { name: 'one measurement refused, database still readable', status: 403, body: SCOPED_ONE_MEASUREMENT, kind: 'scoped', database: 'metrics', measurement: 'mem' },
    { name: 'wildcard is not a database to suggest', status: 403, body: SCOPED_WILDCARD, kind: 'scoped' },
    { name: 'listing middleware, named database', status: 403, body: SCOPED_MIDDLEWARE, kind: 'scoped', database: 'metrics' },
    { name: 'listing middleware, no database sent', status: 403, body: SCOPED_MIDDLEWARE_EMPTY, kind: 'scoped' },

    { name: 'token has no read permission', status: 403, body: NO_READ, kind: 'forbidden' },
    { name: 'server without per-database reads', status: 403, body: OSS_NO_READ, kind: 'forbidden' },
    { name: 'permission store down (Arc main, 503)', status: 503, body: STORE_UNAVAILABLE, kind: 'unavailable' },
    { name: 'grants could not be loaded (older 403)', status: 403, body: UNAVAILABLE, kind: 'unavailable' },
    { name: 'licence-gated feature', status: 403, body: LICENSE, kind: 'license' },

    { name: 'admin required is not a read problem', status: 403, body: ADMIN_REQUIRED, kind: 'denied' },
    { name: 'write required is not a read problem', status: 403, body: WRITE_REQUIRED, kind: 'denied' },
    { name: 'a write gate on a measurement is not a read problem', status: 403, body: NO_WRITE_FOR_MEASUREMENT, kind: 'denied' },
    { name: 'deletion disabled on the server', status: 403, body: DELETE_DISABLED, kind: 'denied' },
    { name: 'insufficient permissions', status: 403, body: INSUFFICIENT, kind: 'denied' },
    { name: 'an ordinary 503 is a server error', status: 503, body: { error: 'Service unavailable' }, kind: 'server' },

    { name: '404', status: 404, body: NOT_FOUND, kind: 'not_found' },
    { name: '500', status: 500, body: { error: 'boom' }, kind: 'server' }
  ];

  for (const c of cases) {
    it(c.name, () => {
      const info = classifyArcError(c.status, c.body.error, undefined, c.body.reason);
      assert.equal(info.kind, c.kind);
      assert.equal(info.status, c.status);
      assert.equal(info.database, c.database);
      assert.equal(info.measurement, c.measurement);
    });
  }

  it('reports no status as a network or server problem, never a refusal', () => {
    assert.equal(classifyArcError(undefined, undefined, 'ECONNREFUSED').kind, 'network');
    assert.equal(classifyArcError(undefined, undefined).kind, 'server');
  });

  it('does not treat a missing message as a scoping or read state', () => {
    assert.equal(classifyArcError(403, undefined).kind, 'denied');
    assert.equal(classifyArcError(403, '').kind, 'denied');
  });
});

// --- arcErrorMessage --------------------------------------------------------

describe('arcErrorMessage', () => {
  it('tells a scoped caller to set a database, and names it when Arc did', () => {
    const named = arcErrorMessage({ kind: 'scoped', status: 403, database: 'metrics' });
    assert.match(named, /no read access to database 'metrics'/);
    // A database named in a refusal comes from a query or a measurement
    // listing, where the connection's database does not change the answer.
    assert.doesNotMatch(named, /Set Connection Database/);

    const unnamed = arcErrorMessage({ kind: 'scoped', status: 403 });
    assert.match(unnamed, /restricted to specific databases/i);
    assert.match(unnamed, /Arc: Set Connection Database/);
  });

  it('names the measurement, not the database, when only a measurement is refused', () => {
    const message = arcErrorMessage({ kind: 'scoped', status: 403, database: 'metrics', measurement: 'mem' });
    assert.match(message, /measurement 'metrics\.mem'/);
    assert.match(message, /Other measurements in 'metrics' may still be readable/);
    assert.doesNotMatch(message, /no read access to database/);
  });

  it('shows a non-read refusal exactly as Arc wrote it', () => {
    for (const body of [ADMIN_REQUIRED, WRITE_REQUIRED, DELETE_DISABLED, NO_WRITE_FOR_MEASUREMENT]) {
      assert.equal(arcErrorMessage(classifyArcError(403, body.error)), body.error);
    }
  });

  it('keeps the four refusals distinct and never quotes a bare status', () => {
    const messages = (['auth', 'scoped', 'forbidden', 'unavailable'] as const).map(kind =>
      arcErrorMessage({ kind, status: kind === 'auth' ? 401 : 403 })
    );
    assert.equal(new Set(messages).size, messages.length);
    for (const message of messages) {
      assert.doesNotMatch(message, /\b40[13]\b/);
    }
  });

  it('does not send a token problem or a server fault after a database', () => {
    assert.doesNotMatch(arcErrorMessage({ kind: 'forbidden', status: 403 }), /database/i);
    assert.doesNotMatch(arcErrorMessage({ kind: 'unavailable', status: 403 }), /database/i);
    assert.match(arcErrorMessage({ kind: 'unavailable', status: 403 }), /server-side fault/i);
  });
});

// --- ArcClient.getDatabases -------------------------------------------------

describe('ArcClient.getDatabases', () => {
  it('returns the databases on success', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(200, SHOW_DATABASES_OK);
    assert.deepEqual(await arc.getDatabases(), ['metrics', 'logs']);
  });

  const refusals: Array<{ name: string; status: number; body: object; kind: string }> = [
    { name: 'a scoped token', status: 403, body: SCOPED_LIST, kind: 'scoped' },
    { name: 'a token with no read permission', status: 403, body: OSS_NO_READ, kind: 'forbidden' },
    { name: 'an unreadable permission store', status: 503, body: STORE_UNAVAILABLE, kind: 'unavailable' },
    { name: 'a rejected token', status: 401, body: BAD_TOKEN, kind: 'auth' }
  ];

  for (const r of refusals) {
    it(`throws rather than inventing a database for ${r.name}`, async () => {
      // The old code answered ANY axios failure with ['default'], so a
      // refusal put a database in the tree that the token might not be able
      // to read, and nothing ever said the token was refused.
      const { arc, mock } = client();
      mock.onPost('/api/v1/query').reply(r.status, r.body);

      await assert.rejects(
        () => arc.getDatabases(),
        (error: unknown) => {
          assert.ok(error instanceof ArcAccessError, `expected ArcAccessError, got ${error}`);
          assert.equal(error.info.kind, r.kind);
          assert.equal(isScopedRefusal(error), r.kind === 'scoped');
          return true;
        }
      );
    });
  }

  it('reports an unreachable server instead of inventing a database', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').networkError();
    await assert.rejects(() => arc.getDatabases(), (error: unknown) => !(error instanceof ArcAccessError));
  });

  it('reports a server fault with Arc\'s message instead of inventing a database', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(500, { success: false, error: 'boom' });
    await assert.rejects(() => arc.getDatabases(), /boom/);
  });

  it('returns an empty list, not a made-up one, when Arc lists nothing', async () => {
    // Newer Arc answers a scoped token whose databases hold no data this way.
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(200, { success: true, columns: ['database'], data: [] });
    assert.deepEqual(await arc.getDatabases(), []);
  });
});

// --- ArcClient.getMeasurements ----------------------------------------------

describe('ArcClient.getMeasurements', () => {
  it('returns the measurements on success', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(200, SHOW_TABLES_OK);
    assert.deepEqual(await arc.getMeasurements('metrics'), [{ name: 'cpu' }]);
  });

  it('does not retry a refusal against /api/v1/measurements', async () => {
    // That endpoint applies the same per-database check and answers
    // identically, so the fallback would only double the requests and the
    // audit entries for a decision Arc has already made.
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(403, SCOPED_DB);
    const fallback = mock.onGet('/api/v1/measurements').reply(403, SCOPED_MEASUREMENT);

    await assert.rejects(
      () => arc.getMeasurements('metrics'),
      (error: unknown) => {
        assert.ok(error instanceof ArcAccessError);
        assert.equal(error.info.kind, 'scoped');
        assert.equal(error.info.database, 'metrics');
        return true;
      }
    );

    const triedFallback = fallback.history.get.some(r => r.url === '/api/v1/measurements');
    assert.equal(triedFallback, false, '/api/v1/measurements must not be tried after a refusal');
  });

  it('still falls back to /api/v1/measurements when the query itself fails', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(500, { error: 'boom' });
    // The shape Arc sends (main and 26.09.4).
    mock.onGet('/api/v1/measurements').reply(200, {
      count: 2,
      measurements: [
        { database: 'metrics', measurement: 'cpu' },
        { database: 'metrics', measurement: 'mem' }
      ]
    });

    assert.deepEqual(await arc.getMeasurements('metrics'), [{ name: 'cpu' }, { name: 'mem' }]);
  });

  it('asks the fallback for the default database when none is given, like SHOW TABLES', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(500, { error: 'boom' });
    const fallback = mock.onGet('/api/v1/measurements').reply(200, {
      measurements: [{ database: 'default', measurement: 'cpu' }]
    });

    assert.deepEqual(await arc.getMeasurements(), [{ name: 'cpu' }]);
    assert.equal(fallback.history.get[0].params?.database, 'default');
  });

  it('surfaces a refusal raised only by the fallback', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(500, { error: 'boom' });
    mock.onGet('/api/v1/measurements').reply(403, SCOPED_MEASUREMENT);

    await assert.rejects(
      () => arc.getMeasurements('metrics'),
      (error: unknown) => error instanceof ArcAccessError && error.info.kind === 'scoped'
    );
  });
});

// --- Error messages from every other call -----------------------------------

describe('ArcClient error messages', () => {
  it('shows Arc\'s own message for a non-read refusal', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/auth/tokens').reply(403, ADMIN_REQUIRED);
    await assert.rejects(() => arc.createToken({ name: 'x' }), { message: 'Permission denied: admin required' });
  });

  it('keeps Arc\'s explanation of a 400 instead of the HTTP status', async () => {
    const body = { error: 'partial write: 1 points dropped: 1 in "raw" column "Time": a tag or field named "time" in any letter case (time is the timestamp);' };
    const { arc, mock } = client();
    mock.onPost('/api/v1/write/msgpack').reply(400, body);
    await assert.rejects(
      // Use a valid tag so #21's client guard does not preempt this
      // captured server-error fixture; this test exercises error passthrough.
      () => arc.writeData('raw', [{ tags: { sensor: 'x' }, fields: { v: 1 }, timestamp: 1 }]),
      { message: body.error }
    );
  });

  it('rejects reserved timestamp tags and fields before any request', async () => {
    const { arc, mock } = client();
    for (const name of ['time', 'Time', 'TIME']) {
      for (const location of ['tags', 'fields']) {
        await assert.rejects(
          () => arc.writeData('raw', [{ [location]: { [name]: 'x' }, timestamp: 1 }]),
          { message: `Column "${name}" is reserved for timestamps and cannot be used as a tag or field` }
        );
      }
    }
    assert.equal(mock.history.post.length, 0);
  });

  it('keeps a handler\'s 404 message, and explains a missing route', async () => {
    const { arc, mock } = client();
    mock.onGet('/api/v1/metrics').reply(404, NOT_FOUND);
    await assert.rejects(() => arc.getMetrics(), { message: "Database 'ghost' not found" });

    mock.onGet('/api/v1/metrics').reply(404, NO_ROUTE);
    await assert.rejects(() => arc.getMetrics(), /Endpoint not found/);
  });

  it('never puts the token in an error or a log line', async () => {
    const token = 'secret-token-value-123';
    const arc = new ArcClient(connection, token);
    const mock = new MockAdapter((arc as unknown as { client: never }).client);
    mock.onGet('/health').reply(500, { error: 'boom' });
    mock.onPost('/api/v1/query').reply(500, { error: 'boom' });
    mock.onGet('/api/v1/measurements').reply(500, { error: 'boom' });

    const logged: string[] = [];
    const util = await import('node:util');
    const originals = { log: console.log, warn: console.warn, error: console.error };
    for (const level of ['log', 'warn', 'error'] as const) {
      console[level] = (...args: unknown[]) => { logged.push(util.inspect(args, { depth: 8 })); };
    }
    const errors: unknown[] = [];
    try {
      await arc.healthCheck().catch(e => errors.push(e));
      await arc.getMeasurements('metrics').catch(e => errors.push(e));
      await arc.getDatabases().catch(e => errors.push(e));
    } finally {
      Object.assign(console, originals);
    }

    assert.equal(errors.length, 3);
    for (const error of errors) {
      assert.doesNotMatch(util.inspect(error, { depth: 8 }), new RegExp(token));
    }
    assert.ok(logged.length > 0);
    for (const line of logged) {
      assert.doesNotMatch(line, new RegExp(token));
    }
  });
});
