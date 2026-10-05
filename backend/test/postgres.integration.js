import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { postgresStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { DEMO_QUESTION } from '../src/providers.js';

test('PostgreSQL retains completed research across API restarts and recovers interrupted runs', { skip: !process.env.DATABASE_URL }, async () => {
  // Isolate this test in its own database, never deleting workspace research.
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = 'research_test_' + randomUUID().replaceAll('-', '');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/' + db;
  let store, listener;
  async function closeServer() {
    if (listener) { await new Promise(resolve => listener.close(resolve)); listener = undefined; }
    if (store) { await store.close(); store = undefined; }
  }
  async function start() {
    store = await postgresStore(url.href);
    listener = createApp({ store: { ...store, auth: undefined }, env: {}, demoDelay: 0 }).listen(0, '127.0.0.1');
    await new Promise(resolve => listener.on('listening', resolve));
    return `http://127.0.0.1:${listener.address().port}`;
  }
  await admin.query(`CREATE DATABASE ${db}`);
  try {
    let origin = await start();
    const created = await fetch(origin + '/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: DEMO_QUESTION, mode: 'demo' }) }).then(r => r.json());
    let complete;
    for (let i = 0; i < 100; i++) {
      complete = await store.get(created.id);
      if (complete.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(complete.status, 'complete');
    assert.equal(complete.sources.length, 2);
    complete.verification = {status:'needs_review',counts:{unsupported:1},claims:[{id:1,verdict:'unsupported',reason:'Persistence test evidence.'}]};
    await store.save(complete);
    const document = {id:randomUUID(),name:'Persistence notes.txt',status:'processing',embeddingModel:'text-embedding-3-small'};
    const other = {...document,id:randomUUID(),name:'Unselected notes.txt'};
    const vector = [1,...Array(1535).fill(0)];
    await store.saveDocument(document);
    await assert.rejects(store.completeDocument({...document,status:'ready'},[{content:'Invalid embedding must not persist',page:null}],[[1,2]]));
    assert.equal((await store.documentPassages(document.id)).length,0);
    await store.completeDocument({...document,status:'ready',chunkCount:1},[{content:'The pilot retention period is seven days.',page:2}],[vector]);
    await store.saveDocument(other);
    await store.completeDocument({...other,status:'ready'},[{content:'Unselected content must not be retrieved.',page:null}],[vector]);
    const pendingDocument = {...document,id:randomUUID()};
    await store.saveDocument(pendingDocument);
    const interrupted = { ...complete, id: randomUUID(), status: 'running', report: '', steps: [{id:'plan',status:'complete'},{id:'search',status:'running'}] };
    await store.save(interrupted);
    await closeServer();
    origin = await start();
    const passages=await store.retrieveDocuments([document.id],vector);
    assert.equal(passages.length,1);
    assert.equal(passages[0].documentId,document.id);
    assert.equal(passages[0].page,2);
    assert.match(passages[0].content,/seven days/);
    assert.ok(passages[0].similarity>0.99);
    assert.equal((await store.getDocument(pendingDocument.id)).status,'failed');
    assert.equal((await store.documentPassages(document.id)).length,1);
    const restored = await fetch(origin + '/api/research/' + complete.id).then(r => r.json());
    assert.deepEqual(restored, complete);
    const failed = await store.get(interrupted.id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.steps[0].status, 'complete');
    assert.equal(failed.steps[1].status, 'failed');
    assert.match(failed.error, /restart/);
    assert.equal((await store.list()).length, 2);
    assert.equal(await store.get("'; DROP TABLE research_runs;--"), undefined);
    assert.equal((await fetch(origin + '/api/health').then(r => r.json())).storage, 'postgresql');
  } finally {
    await closeServer();
    await admin.query(`DROP DATABASE ${db}`);
    await admin.end();
  }
});
