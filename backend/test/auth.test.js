import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { hashPassword, checkPassword } from '../src/auth-store.js';
import { createMailer } from '../src/auth.js';

test('Brevo sends verification links over HTTPS without exposing the API key', async () => {
  const sent = [];
  const send = createMailer({ APP_URL: 'https://research.example', BREVO_API_KEY: 'test-secret', BREVO_SENDER_EMAIL: 'owner@gmail.com', SMTP_HOST: 'smtp.gmail.com', SMTP_FROM: 'owner@gmail.com' }, async (url, options) => {
    sent.push({ url, options });
    return { ok: true };
  });
  await send('reader@example.com', 'Verify your DeepResearch account', '/verify', 'one-time-token');
  assert.equal(sent[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(sent[0].options.headers['api-key'], 'test-secret');
  const message = JSON.parse(sent[0].options.body);
  assert.equal(message.to[0].email, 'reader@example.com');
  assert.match(message.textContent, /https:\/\/research.example\/verify\?token=one-time-token/);
  const rejected = createMailer({ APP_URL: 'https://research.example', BREVO_API_KEY: 'bad-key', BREVO_SENDER_EMAIL: 'owner@gmail.com' }, async () => ({ ok: false, status: 401 }));
  await assert.rejects(rejected('reader@example.com', 'Verify your DeepResearch account', '/verify', 'token'), error => error.provider === 'Brevo' && error.status === 401);
  const forbidden = createMailer({ APP_URL: 'https://research.example', BREVO_API_KEY: 'test-secret', BREVO_SENDER_EMAIL: 'owner@gmail.com' }, async () => ({
    ok: false, status: 403, json: async () => ({ code: 'unauthorized', message: 'Sending disabled for owner@gmail.com using xkeysib-secret' }),
  }));
  await assert.rejects(forbidden('reader@example.com', 'Verify your DeepResearch account', '/verify', 'token'), error =>
    error.detail === 'unauthorized: Sending disabled for [redacted email] using [redacted key]');
});

test('password hashes are salted and verify only the matching password', async () => {
  const first = await hashPassword('correct-horse-battery');
  const second = await hashPassword('correct-horse-battery');
  assert.notEqual(first, second);
  assert.equal(await checkPassword('correct-horse-battery', first), true);
  assert.equal(await checkPassword('different-password', first), false);
});

test('account routes require verification and gate research by session and demo status', async t => {
  const users = new Map();
  const tokens = new Map();
  const sessions = new Map();
  const mail = [];
  const demo = { id: 'demo', username: 'demo', email: 'demo@deepresearch.invalid', verified: true, demo: true };
  const auth = {
    async createUser({ username, email, password }) {
      if (users.has(email)) return null;
      const user = { id: username, username, email, password_hash: await hashPassword(password), verified: false, demo: false };
      users.set(email, user); return user;
    },
    async deleteUnverifiedUser(id) { for (const [email, user] of users) if (user.id === id) users.delete(email); },
    async findUser(email) { return users.get(email); },
    async demoUser() { return demo; },
    async issueToken(id, purpose) { const value = `${id}-${purpose}`; tokens.set(value, id); return value; },
    async consumeToken(value) { const id = tokens.get(value); tokens.delete(value); return id; },
    async verifyUser(id) { for (const user of users.values()) if (user.id === id) user.verified = true; },
    async resetPassword(id, password) { for (const user of users.values()) if (user.id === id) user.password_hash = await hashPassword(password); sessions.clear(); },
    async createSession(id) { const value = `session-${id}`; sessions.set(value, id); return value; },
    async sessionUser(value) { const id = sessions.get(value); return id === 'demo' ? demo : [...users.values()].find(user => user.id === id) || null; },
    async deleteSession(value) { sessions.delete(value); },
  };
  const store = { auth, kind: 'postgresql', listDocuments: async () => [], health: async () => true,
    forUser: () => ({ list: async () => [], get: async () => undefined, listDocuments: async () => [], getDocument: async () => undefined }),
  };
  const listener = createApp({ store, env: { APP_URL: 'http://localhost:3001' }, sendMail: async (...args) => mail.push(args) }).listen(0, '127.0.0.1');
  await new Promise(resolve => listener.on('listening', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const base = `http://127.0.0.1:${listener.address().port}`;
  const call = async (path, body, cookie) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  assert.equal((await call('/api/research')).status, 401);
  assert.equal((await call('/api/auth/register', { username: 'alice', email: 'bad', password: 'correct-horse-battery', confirmPassword: 'correct-horse-battery' })).status, 400);
  assert.equal((await call('/api/auth/register', { username: 'alice', email: 'alice@example.com', password: 'correct-horse-battery', confirmPassword: 'correct-horse-battery' })).status, 201);
  assert.equal((await call('/api/auth/login', { email: 'alice@example.com', password: 'correct-horse-battery' })).status, 403);
  assert.equal((await call('/api/auth/verify', { token: mail[0][3] })).status, 200);
  const login = await call('/api/auth/login', { email: 'alice@example.com', password: 'correct-horse-battery' });
  assert.equal(login.status, 200);
  assert.equal((await call('/api/research', null, login.cookie)).status, 200);
  const sample = await call('/api/auth/demo', {});
  assert.equal((await call('/api/research', { question: 'A real live research question', mode: 'live' }, sample.cookie)).status, 403);
  assert.equal((await call('/api/documents', null, sample.cookie)).status, 403);
  assert.equal((await call('/api/auth/logout', {}, login.cookie)).status, 200);
  assert.equal((await call('/api/research', null, login.cookie)).status, 401);
});
