import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { postgresStore } from '../src/store.js';
import { createApp } from '../src/app.js';

test('email verification, sessions, reset and ownership isolate two accounts', { skip: !process.env.DATABASE_URL }, async () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const database = 'auth_test_' + randomUUID().replaceAll('-', '');
  const connection = new URL(process.env.DATABASE_URL);
  connection.pathname = '/' + database;
  let store, listener;
  await admin.query(`CREATE DATABASE ${database}`);
  try {
    store = await postgresStore(connection.href);
    const mail = [];
    listener = createApp({ store, env: { APP_URL: 'http://localhost:3001', NODE_ENV: 'test' }, demoDelay: 0,
      sendMail: async (to, subject, path, value) => mail.push({ to, subject, path, value }),
    }).listen(0, '127.0.0.1');
    await new Promise(resolve => listener.on('listening', resolve));
    const base = `http://127.0.0.1:${listener.address().port}`;
    const call = async (path, body, cookie) => {
      const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    assert.equal((await call('/api/research')).status, 401);
    const register = (username, email) => call('/api/auth/register', { username, email, password: 'correct-horse-battery', confirmPassword: 'correct-horse-battery' });
    assert.equal((await register('alice', 'alice@example.com')).status, 201);
    assert.equal((await call('/api/auth/login', { email: 'alice@example.com', password: 'correct-horse-battery' })).status, 403);
    assert.equal((await call('/api/auth/verify', { token: mail[0].value })).status, 200);
    assert.equal((await call('/api/auth/verify', { token: mail[0].value })).status, 400);
    const alice = await call('/api/auth/login', { email: 'alice@example.com', password: 'correct-horse-battery' });
    assert.equal(alice.status, 200);
    assert.ok(alice.cookie.includes('deepresearch_session='));
    assert.equal((await register('bob', 'bob@example.com')).status, 201);
    assert.equal((await call('/api/auth/verify', { token: mail[1].value })).status, 200);
    const bob = await call('/api/auth/login', { email: 'bob@example.com', password: 'correct-horse-battery' });
    assert.equal(bob.status, 200);
    const aliceStore = store.forUser(alice.data.user.id);
    const run = { id: randomUUID(), createdAt: new Date().toISOString(), status: 'complete', report: 'Alice only' };
    await aliceStore.save(run);
    const document = { id: randomUUID(), name: 'Alice notes', status: 'ready', embeddingModel: 'text-embedding-3-small' };
    await aliceStore.saveDocument(document);
    assert.equal((await call(`/api/research/${run.id}`, null, alice.cookie)).status, 200);
    assert.equal((await call(`/api/research/${run.id}`, null, bob.cookie)).status, 404);
    assert.equal((await call(`/api/documents/${document.id}/passages`, null, bob.cookie)).status, 404);
    assert.deepEqual((await call('/api/research', null, bob.cookie)).data, []);
    assert.deepEqual((await call('/api/documents', null, bob.cookie)).data, []);
    const demo = await call('/api/auth/demo', {});
    assert.equal(demo.status, 200);
    assert.equal((await call('/api/research', { question: 'Tell me what happened today', mode: 'live' }, demo.cookie)).status, 403);
    assert.equal((await call('/api/documents', null, demo.cookie)).status, 403);
    assert.equal((await call('/api/auth/forgot-password', { email: 'alice@example.com' })).status, 200);
    assert.equal((await call('/api/auth/reset-password', { token: mail[2].value, password: 'new-long-password-123', confirmPassword: 'new-long-password-123' })).status, 200);
    assert.equal((await call('/api/auth/me', null, alice.cookie)).status, 401);
    assert.equal((await call('/api/auth/login', { email: 'alice@example.com', password: 'new-long-password-123' })).status, 200);
  } finally {
    if (listener) await new Promise(resolve => listener.close(resolve));
    if (store) await store.close();
    await admin.query(`DROP DATABASE ${database}`);
    await admin.end();
  }
});
