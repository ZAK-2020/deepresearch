import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { demoProvider, DEMO_QUESTION, safeUrl } from '../src/providers.js';
import { createResearchGraph, stages } from '../src/graph.js';
import { memoryStore } from '../src/store.js';

async function server(t, options = {}) {
  const listener = createApp({ env: {}, demoDelay: 0, ...options }).listen(0, '127.0.0.1');
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
test('graph executes in order and forwards evidence into report writing', async () => {
  const transitions = [];
  const provider = demoProvider(0);
  const write = provider.write;
  provider.write = async state => { assert.equal(state.sources.length, 2); assert.ok(state.review); return write(state); };
  const result = await createResearchGraph(provider, (stage, status) => transitions.push(`${stage}:${status}`)).invoke({ question: DEMO_QUESTION });
  assert.deepEqual(transitions, stages.flatMap(stage => [`${stage}:running`, `${stage}:complete`]));
  assert.match(result.report, /Sample report/);
});
test('API completes the fixed demo, stores history, and returns source links', async t => {
  const request = await server(t);
  const created = await request('/api/research', { question: 'A completely different question', mode: 'demo' });
  assert.equal(created.status, 202);
  assert.equal(created.data.question, DEMO_QUESTION);
  const run = await waitForRun(request, created.data.id);
  assert.equal(run.status, 'complete');
  assert.ok(run.steps.every(step => step.status === 'complete'));
  assert.match(run.report, /No|demo/i);
  assert.equal(run.sources.length, 2);
  const history = await request('/api/research');
  assert.equal(history.data.length, 1);
  assert.equal(history.data[0].report, undefined);
});
test('validation rejects malformed, oversized, missing-key and cross-origin runs', async t => {
  const request = await server(t);
  for (const question of ['', 'tiny', 'x'.repeat(2001)]) assert.equal((await request('/api/research', { question, mode: 'demo' })).status, 400);
  assert.equal((await request('/api/research', { question: DEMO_QUESTION, mode: 'invalid' })).status, 400);
  assert.equal((await request('/api/research', { question: DEMO_QUESTION, mode: 'live' })).status, 503);
  assert.equal((await request('/api/research', { question: DEMO_QUESTION, mode: 'demo' }, { Origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await request('/api/research', { question: 'tiny', mode: 'demo' }, { Origin: 'https://deepresearchbackend-production.up.railway.app' })).status, 400);
  assert.equal((await request('/api/research/missing')).status, 404);
  assert.equal((await request('/api/health')).data.liveConfigured, false);
});
test('a provider failure stops the graph and preserves completed progress without leaking errors', async t => {
  const request = await server(t, { providerFactory: () => ({ ...demoProvider(0), search: async () => { throw new Error('secret-provider-token'); } }) });
  const created = await request('/api/research', { question: DEMO_QUESTION, mode: 'demo' });
  const run = await waitForRun(request, created.data.id);
  assert.equal(run.status, 'failed');
  assert.equal(run.steps[0].status, 'complete');
  assert.equal(run.steps[1].status, 'failed');
  assert.equal(run.steps[2].status, 'pending');
  assert.ok(!JSON.stringify(run).includes('secret-provider-token'));
});
test('caps concurrent runs to prevent accidental duplicate workloads', async t => {
  const request = await server(t, { demoDelay: 30 });
  const first = await request('/api/research', { question: DEMO_QUESTION, mode: 'demo' });
  const second = await request('/api/research', { question: DEMO_QUESTION, mode: 'demo' });
  assert.equal((await request('/api/research', { question: DEMO_QUESTION, mode: 'demo' })).status, 429);
  await Promise.all([waitForRun(request, first.data.id), waitForRun(request, second.data.id)]);
});
test('source URL validation excludes executable and malformed links', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null);
  assert.equal(safeUrl('data:text/html,test'), null);
  assert.equal(safeUrl('not a url'), null);
  assert.equal(safeUrl('https://example.com/report'), 'https://example.com/report');
});

test('failed initial persistence rejects the run and releases the concurrency slot', async t => {
  const store = memoryStore();
  let fail = true;
  const save = store.save;
  store.save = async run => { if (fail) throw new Error('database unavailable'); return save(run); };
  const request = await server(t, { store });
  for (let i = 0; i < 3; i++) assert.equal((await request('/api/research', { question: DEMO_QUESTION, mode: 'demo' })).status, 503);
  fail = false;
  const created = await request('/api/research', { question: DEMO_QUESTION, mode: 'demo' });
  assert.equal(created.status, 202);
  assert.equal((await waitForRun(request, created.data.id)).status, 'complete');
});
