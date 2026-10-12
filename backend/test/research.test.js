import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { safeUrl } from '../src/providers.js';
import { createResearchGraph, researchStages } from '../src/graph.js';
import { memoryStore } from '../src/store.js';

const question = 'How do research teams evaluate source quality?';
const keys = { OPENAI_API_KEY: 'test-key', TAVILY_API_KEY: 'test-key' };
function provider(delay = 0) {
  const pause = () => new Promise(resolve => setTimeout(resolve, delay));
  return {
    async plan() { await pause(); return { plan: { queries: ['source quality'], focus: ['Evidence'] } }; },
    async search() { await pause(); return { sources: [{ id: 1, title: 'Source', url: 'https://example.com/source', content: 'Evidence.' }] }; },
    async analyze() { await pause(); return { analysis: 'Evidence analysis' }; },
    async review() { await pause(); return { review: 'Evidence review' }; },
    async write() { await pause(); return { report: '# Research report\n\nSupported statement [1].', reportBody: 'Supported statement [1].' }; },
    async verify() { await pause(); return { verification: { status: 'checked', scope: 'Source excerpts' } }; },
  };
}
async function server(t, options = {}) {
  const listener = createApp({ env: keys, providerFactory: () => provider(), ...options }).listen(0, '127.0.0.1');
  await new Promise(resolve => listener.on('listening', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const url = `http://127.0.0.1:${listener.address().port}`;
  return async (path, body, headers = {}) => {
    const response = await fetch(url + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) } : undefined);
    return { status: response.status, data: await response.json() };
  };
}
async function waitForRun(request, id) {
  for (let i = 0; i < 100; i++) {
    const { data } = await request(`/api/research/${id}`);
    if (data.status !== 'running') return data;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Research did not finish within test timeout');
}

test('graph executes all live stages in order', async () => {
  const transitions = [];
  const result = await createResearchGraph(provider(), (stage, status) => transitions.push(`${stage}:${status}`), researchStages()).invoke({ question });
  assert.deepEqual(transitions, researchStages().flatMap(stage => [`${stage}:running`, `${stage}:complete`]));
  assert.match(result.report, /Research report/);
});
test('open API completes real research and shares history without an account', async t => {
  const request = await server(t);
  const created = await request('/api/research', { question, depth: 'quick' });
  assert.equal(created.status, 202);
  assert.equal(created.data.mode, 'live');
  assert.equal(created.data.question, question);
  const run = await waitForRun(request, created.data.id);
  assert.equal(run.status, 'complete');
  assert.ok(run.steps.every(step => step.status === 'complete'));
  assert.ok(run.verification);
  assert.equal((await request('/api/research')).data.length, 1);
  assert.equal((await request('/api/auth/me')).status, 404);
});
test('validation rejects malformed questions, unsupported modes, missing keys and cross-origin runs', async t => {
  const request = await server(t);
  for (const invalid of ['', 'tiny', 'x'.repeat(2001)]) assert.equal((await request('/api/research', { question: invalid })).status, 400);
  assert.equal((await request('/api/research', { question, mode: 'demo' })).status, 400);
  assert.equal((await request('/api/research', { question }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request('/api/research/missing')).status, 404);
  const noKeys = await server(t, { env: {} });
  assert.equal((await noKeys('/api/research', { question })).status, 503);
  assert.equal((await noKeys('/api/health')).data.liveConfigured, false);
});
test('provider failure preserves progress without exposing secrets', async t => {
  const request = await server(t, { providerFactory: () => ({ ...provider(), search: async () => { throw new Error('secret-provider-token'); } }) });
  const created = await request('/api/research', { question });
  const run = await waitForRun(request, created.data.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.steps[0].status, 'complete');
  assert.equal(run.steps[1].status, 'failed');
  assert.ok(!JSON.stringify(run).includes('secret-provider-token'));
});
test('caps concurrent real runs', async t => {
  const request = await server(t, { providerFactory: () => provider(30) });
  const first = await request('/api/research', { question });
  const second = await request('/api/research', { question });
  assert.equal((await request('/api/research', { question })).status, 429);
  await Promise.all([waitForRun(request, first.data.id), waitForRun(request, second.data.id)]);
});
test('source URL validation excludes executable and malformed links', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,test'), null);
  assert.equal(safeUrl('not a url'), null);
  assert.equal(safeUrl('https://example.com/report'), 'https://example.com/report');
});
test('failed initial persistence releases the concurrency slot', async t => {
  const store = memoryStore();
  let fail = true;
  const save = store.save;
  store.save = async run => { if (fail) throw new Error('database unavailable'); return save(run); };
  const request = await server(t, { store });
  for (let i = 0; i < 3; i++) assert.equal((await request('/api/research', { question })).status, 503);
  fail = false;
  const created = await request('/api/research', { question });
  assert.equal(created.status, 202);
  assert.equal((await waitForRun(request, created.data.id)).status, 'complete');
});
