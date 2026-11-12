import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import MockAdapter from 'axios-mock-adapter';

import { ArcClient } from '../api/arcClient';
import { ArcAccessError } from '../utils/arcErrors';
import { validateDatabaseName } from '../utils/databaseNames';
import type { ArcConnection } from '../types';

const connection: ArcConnection = {
  id: 'test',
  name: 'test',
  protocol: 'http',
  host: 'localhost',
  port: 8000
};

function client(): { arc: ArcClient; mock: MockAdapter } {
  const arc = new ArcClient(connection, 'admin-token');
  const mock = new MockAdapter((arc as unknown as { client: never }).client);
  return { arc, mock };
}

describe('database name validation', () => {
  it('accepts Arc database identifiers', () => {
    assert.equal(validateDatabaseName('metrics'), undefined);
    assert.equal(validateDatabaseName('factory-prod_2'), undefined);
  });

  it('rejects invalid, overlong, and reserved names', () => {
    assert.match(validateDatabaseName('2metrics') ?? '', /start with a letter/);
    assert.match(validateDatabaseName('metrics/db') ?? '', /start with a letter/);
    assert.match(validateDatabaseName('a'.repeat(65)) ?? '', /1–64 characters/);
    assert.match(validateDatabaseName('system') ?? '', /reserved/);
    assert.match(validateDatabaseName('INTERNAL') ?? '', /reserved/);
  });
});

describe('ArcClient database endpoints', () => {
  it('lists databases through SHOW DATABASES and filters invalid names', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply((config) => {
      assert.deepEqual(JSON.parse(config.data), { sql: 'SHOW DATABASES;' });
      return [200, { columns: ['database'], data: [['metrics'], ['factory-prod'], ['../bad'], [42]] }];
    });
    assert.deepEqual(await arc.getDatabases(), ['metrics', 'factory-prod']);
  });

  it('does not invent a default database after a network failure', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').networkError();
    await assert.rejects(() => arc.getDatabases(), /Network Error|connect/i);
  });

  it('does not invent a default database when the permission store is unavailable', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(503, { error: 'Permission store unavailable; retry later' });
    await assert.rejects(() => arc.getDatabases());
  });

  it('lists measurements with and without a selected database using SHOW TABLES', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').replyOnce((config) => {
      assert.deepEqual(JSON.parse(config.data), { sql: 'SHOW TABLES FROM factory-prod;' });
      return [200, { columns: ['database', 'table_name'], data: [['factory-prod', 'cpu'], ['factory-prod', 'temperature']] }];
    });
    mock.onPost('/api/v1/query').reply((config) => {
      assert.deepEqual(JSON.parse(config.data), { sql: 'SHOW TABLES;' });
      return [200, { columns: ['table_name'], data: [['m_ctrl']] }];
    });
    assert.deepEqual(await arc.getMeasurements('factory-prod'), [{ name: 'cpu' }, { name: 'temperature' }]);
    assert.deepEqual(await arc.getMeasurements(), [{ name: 'm_ctrl' }]);
  });

  it('preserves per-database measurement refusals', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/query').reply(403, { error: "no permission for read on database 'metrics'" });
    await assert.rejects(() => arc.getMeasurements('metrics'), (error: unknown) => error instanceof ArcAccessError);
  });

  it('creates databases with the first-class POST endpoint', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/databases').reply((config) => {
      assert.deepEqual(JSON.parse(config.data), { name: 'factory-prod' });
      return [201, { name: 'factory-prod', measurement_count: 0 }];
    });
    await arc.createDatabase('factory-prod');
  });

  it('deletes databases only with the explicit confirmation query', async () => {
    const { arc, mock } = client();
    mock.onDelete('/api/v1/databases/factory-prod').reply((config) => {
      assert.equal(config.params?.confirm, 'true');
      return [200, { success: true }];
    });
    await arc.deleteDatabase('factory-prod');
  });

  it('does not send create requests for invalid or reserved names', async () => {
    const { arc, mock } = client();
    await assert.rejects(() => arc.createDatabase('system'), /reserved/);
    await assert.rejects(() => arc.createDatabase('bad/name'), /start with a letter/);
    assert.equal(mock.history.post.length, 0);
  });

  it('uses Arc's exact admin-required response and separates the sentences', async () => {
    const { arc, mock } = client();
    mock.onPost('/api/v1/databases').reply(403, { error: 'Permission denied: admin required' });
    await assert.rejects(() => arc.createDatabase('metrics'), /Permission denied: admin required\. This operation requires an admin token\./);
  });

  it('does not misreport disabled deletion as an RBAC problem', async () => {
    const { arc, mock } = client();
    mock.onDelete('/api/v1/databases/metrics').reply(403, {
      error: 'Delete operations are disabled. Set delete.enabled=true in arc.toml to enable.'
    });
    await assert.rejects(() => arc.deleteDatabase('metrics'), /Delete operations are disabled\. Set delete\.enabled=true/);
  });

  it('surfaces Arc's actual non-primary writer response', async () => {
    const { arc, mock } = client();
    mock.onDelete('/api/v1/databases/metrics').reply(503, {
      error: 'database delete rejected: node role "reader" is not primary writer; route to the primary writer'
    });
    await assert.rejects(() => arc.deleteDatabase('metrics'), /node role "reader" is not primary writer; route to the primary writer/);
  });
});
