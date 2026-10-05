import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { memoryStore } from '../src/store.js';
import { demoProvider, researchContext } from '../src/providers.js';
import { chunkPages, extractDocument, withDocumentRetrieval, MAX_FILE_BYTES } from '../src/documents.js';
import { createResearchGraph, researchStages } from '../src/graph.js';
import { vectorLiteral } from '../src/document-store.js';

const content = 'Project Juniper uses a seven-day retention period. The pilot owner is Mira Chen. All exports require review.';
const vector = () => [1, ...Array(1535).fill(0)];
const embeddings = { embedDocuments: async texts => texts.map(vector), embedQuery: async () => vector() };
function repository() {
  const docs = new Map(), chunks = new Map();
  return { ...memoryStore(), kind: 'postgresql',
    async listDocuments() { return [...docs.values()]; },
    async getDocument(id) { return docs.get(id); },
    async findDocument(hash) { return [...docs.values()].find(d => d.hash === hash && d.status === 'ready'); },
    async saveDocument(doc) { docs.set(doc.id, structuredClone(doc)); },
    async completeDocument(doc, passages) { docs.set(doc.id, structuredClone(doc)); chunks.set(doc.id, passages.map((p, i) => ({ ...p, chunkIndex: i + 1 }))); },
    async documentPassages(id) { return chunks.get(id) || []; },
    async retrieveDocuments(ids) { return ids.flatMap(id => (chunks.get(id) || []).map(p => ({...p, documentId:id, title:docs.get(id).name, similarity:0.8}))); },
  };
}
async function serve(t, options = {}) {
  const store = repository();
  const listener = createApp({ store, env: {OPENAI_API_KEY:'test-only'}, embeddings, providerFactory: () => demoProvider(0), ...options }).listen(0, '127.0.0.1');
  await new Promise(resolve => listener.on('listening', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const origin = `http://127.0.0.1:${listener.address().port}`;
  const upload = async (name, text = content) => {
    const form = new FormData(); form.append('file', new Blob([text]), name);
    const response = await fetch(origin + '/api/documents', { method:'POST', body:form });
    return { status:response.status, data:await response.json() };
  };
  return {store, origin, upload};
}
async function waitFor(read, predicate) {
  for (let i = 0; i < 200; i++) { const value = await read(); if (predicate(value)) return value; await new Promise(r => setTimeout(r,10)); }
  throw new Error('Timed out waiting for processing');
}
function pdf(text) {
  const stream = `BT /F1 12 Tf 40 700 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(output)); output += `${i+1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10,'0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
test('extracts UTF-8 text and PDF text with page provenance', async () => {
  assert.deepEqual(await extractDocument({originalname:'notes.md',buffer:Buffer.from(content)}), [{page:null,text:content}]);
  const pages = await extractDocument({originalname:'notes.pdf',buffer:pdf(content)});
  assert.equal(pages[0].page,1); assert.match(pages[0].text,/Juniper/);
});
test('rejects binary, empty, oversized, unsupported and unreadable documents', async () => {
  for (const [originalname, buffer] of [['image.png',Buffer.from(content)],['empty.txt',Buffer.alloc(0)],['binary.txt',Buffer.from('\0'+content)],['fake.pdf',Buffer.from(content)],['bad.txt',Buffer.from([255,254])],['large.txt',Buffer.alloc(MAX_FILE_BYTES+1)]]) await assert.rejects(extractDocument({originalname,buffer}));
  await assert.rejects(extractDocument({originalname:'blank.pdf',buffer:pdf('')}),/OCR/);
});
test('chunking overlaps text without dropping content and retains page numbers', () => {
  const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(200);
  const chunks = chunkPages([{page:3,text}]);
  assert.equal(chunks.length,4);
  assert.ok(chunks.every(c=>c.page===3&&c.content.length<=1800));
  assert.equal(chunks.map((c,i)=>i?c.content.slice(200):c.content).join(''),text);
  assert.throws(()=>vectorLiteral(Array(1536).fill(0)));
  assert.throws(()=>vectorLiteral([1,2]));
});
test('uploads, indexes, previews and deduplicates files; selected documents feed the research graph', async t => {
  const {origin,upload,store}=await serve(t);
  const created = await upload('notes.txt'); assert.equal(created.status,202);
  const doc = await waitFor(()=>store.getDocument(created.data.id),d=>d.status!=='processing');
  assert.equal(doc.status,'ready'); assert.equal(doc.chunkCount,1);
  const preview=await fetch(origin+`/api/documents/${doc.id}/passages`).then(r=>r.json());
  assert.equal(preview.passages[0].content,content);
  const duplicate=await upload('same-notes.txt'); assert.equal(duplicate.status,200); assert.equal(duplicate.data.id,doc.id);
  const response=await fetch(origin+'/api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'What is the retention policy for Juniper?',mode:'live',includeWeb:false,documentIds:[doc.id]})});
  assert.equal(response.status,202); const run=await response.json();
  const final=await waitFor(()=>store.get(run.id),r=>r.status!=='running');
  assert.equal(final.status,'complete'); assert.ok(!final.steps.some(s=>s.id==='search'));
  assert.equal(final.sources[0].type,'document'); assert.equal(final.sources[0].content,content);
  assert.equal(final.sources[0].id,1);
});
test('upload and selection errors are explicit and provider secrets stay private', async t => {
  const {origin,upload,store}=await serve(t,{embeddings:{...embeddings,embedDocuments:async()=>{throw new Error('private-key-do-not-expose');}}});
  assert.equal((await upload('notes.exe')).status,415);
  assert.equal((await upload('huge.txt',Buffer.alloc(MAX_FILE_BYTES+1))).status,413);
  const created=await upload('notes.txt'); assert.equal(created.status,202);
  const doc=await waitFor(()=>store.getDocument(created.data.id),d=>d.status!=='processing');
  assert.equal(doc.status,'failed'); assert.ok(!doc.error.includes('private-key'));
  for(const body of [{includeWeb:false,documentIds:[]},{includeWeb:false,documentIds:[doc.id]},{includeWeb:false,documentIds:[randomUUID()]},{includeWeb:false,documentIds:['invalid']}]) {
    const response=await fetch(origin+'/api/research',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:'What are the document findings?',mode:'live',...body})});
    assert.equal(response.status,400);
  }
});
test('mixed retrieval appends selected document evidence after web sources', async () => {
  const id=randomUUID(); const provider=withDocumentRetrieval(demoProvider(0),{retrieveDocuments:async(ids)=>{assert.deepEqual(ids,[id]);return[{documentId:id,title:'Notes',content,page:2,chunkIndex:1}];}},embeddings);
  const state=await createResearchGraph(provider,()=>{},researchStages({documentIds:[id]})).invoke({question:'What are the research findings?',documentIds:[id],includeWeb:true});
  assert.equal(state.sources.length,3);assert.equal(state.sources[2].id,3);assert.equal(state.sources[2].documentId,id);
  const context=researchContext(state);
  assert.ok(!JSON.stringify(context).includes(id));
  assert.equal(context.sources[2].id,3);
});
