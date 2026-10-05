import { Router } from 'express';
import multer from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { OpenAIEmbeddings } from '@langchain/openai';
import { z } from 'zod';
import { EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from './document-store.js';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export class DocumentError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function createEmbeddings(env) {
  return new OpenAIEmbeddings({ apiKey: env.OPENAI_API_KEY, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS, batchSize: 32, timeout: 60000, maxRetries: 1 });
}
function extractPdf(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.js', import.meta.url), { workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new DocumentError('PDF extraction timed out. Try a smaller PDF.')); }, 30000);
    worker.once('message', result => { clearTimeout(timer); void worker.terminate(); result.error ? reject(new DocumentError(result.error)) : resolve(result.pages); });
    worker.once('error', () => { clearTimeout(timer); reject(new DocumentError('Could not extract this PDF. Try a smaller PDF with selectable text.')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new DocumentError('PDF extraction stopped. Try a smaller PDF.')); });
  });
}
export async function extractDocument(file) {
  const extension = extname(file.originalname).toLowerCase();
  if (!['.txt', '.md', '.pdf'].includes(extension)) throw new DocumentError('Supported formats: PDF, TXT, and Markdown (.md).', 415);
  if (!file.buffer.length) throw new DocumentError('The uploaded file is empty.');
  if (file.buffer.length > MAX_FILE_BYTES) throw new DocumentError('Files must be 5 MB or smaller.', 413);
  let pages;
  if (extension === '.pdf') {
    if (!file.buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new DocumentError('This file is not a valid PDF.');
    pages = await extractPdf(file.buffer);
  } else {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(file.buffer); } catch { throw new DocumentError('Save text files in UTF-8 encoding and try again.'); }
    if (/[\u0000-\u0008\u000e-\u001f]/.test(text)) throw new DocumentError('This file contains binary data. Upload plain UTF-8 text.');
    pages = [{ page: null, text }];
  }
  pages = pages.map(p => ({ ...p, text: p.text.replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim() }));
  const count = pages.reduce((sum, p) => sum + p.text.length, 0);
  if (count < 20) throw new DocumentError('Not enough readable text. Scanned PDFs need OCR before upload.');
  if (count > 200000) throw new DocumentError('Documents are limited to 200,000 extracted characters.');
  return pages;
}
export function chunkPages(pages, size = 1800, overlap = 200) {
  if (size <= overlap || overlap < 0) throw new Error('Invalid chunk settings.');
  const chunks = [];
  for (const { page, text } of pages) {
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + size, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf(' ', end);
        if (boundary > start + size / 2) end = boundary;
      }
      const content = text.slice(start, end).trim();
      if (content) chunks.push({ page, content });
      if (chunks.length > 160) throw new DocumentError('This document has too many passages. Split it into smaller files.');
      if (end === text.length) break;
      start = end - overlap;
    }
  }
  return chunks;
}
export function documentRouter({ store, env, embeddings, extract = extractDocument }) {
  const router = Router();
  let processing = false;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 0, parts: 1 } }).single('file');
  router.use((req, res, next) => {
    if (!store.listDocuments) return res.status(503).json({ error: 'Document storage requires PostgreSQL. Start the database and restart the API.' });
    next();
  });
  router.get('/', async (req, res) => res.json(await store.listDocuments()));
  router.get('/:id/passages', async (req, res) => {
    if (!z.uuid().safeParse(req.params.id).success) return res.status(404).json({ error: 'Document not found.' });
    const doc = await store.getDocument(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    res.json({ document: doc, passages: await store.documentPassages(doc.id) });
  });
  router.post('/', (req, res, next) => {
    if (!env.OPENAI_API_KEY) return res.status(503).json({ error: 'Configure OPENAI_API_KEY to index documents.' });
    if (processing) return res.status(429).json({ error: 'A document is already uploading or indexing. Wait for it to finish.' });
    processing = true;
    upload(req, res, error => {
      if (error) { processing = false; return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Files must be 5 MB or smaller.' : 'Upload one file using the file field.' }); }
      void (async () => {
        let document;
        try {
          if (!req.file) throw new DocumentError('Choose a file to upload.');
          const extension = extname(req.file.originalname).toLowerCase();
          if (!['.pdf', '.txt', '.md'].includes(extension)) throw new DocumentError('Supported formats: PDF, TXT, and Markdown (.md).', 415);
          const hash = createHash('sha256').update(req.file.buffer).digest('hex');
          const existing = await store.findDocument(hash);
          if (existing) { res.status(200).json(existing); return; }
          document = { id: randomUUID(), name: req.file.originalname.split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '').slice(0, 180), bytes: req.file.size, status: 'processing', createdAt: new Date().toISOString(), hash, embeddingModel: EMBEDDING_MODEL, chunkCount: 0 };
          await store.saveDocument(document);
          res.status(202).json(document);
          const pages = await extract(req.file);
          const chunks = chunkPages(pages);
          const vectors = await (embeddings || createEmbeddings(env)).embedDocuments(chunks.map(c => c.content));
          const ready = { ...document, status: 'ready', chunkCount: chunks.length, pageCount: extension === '.pdf' ? pages.length : null, finishedAt: new Date().toISOString() };
          await store.completeDocument(ready, chunks, vectors);
        } catch (error) {
          const message = error instanceof DocumentError ? error.message : 'Document indexing failed. Check the OpenAI key, quota, and database, then upload again.';
          if (document) {
            try { await store.saveDocument({ ...document, status: 'failed', error: message, finishedAt: new Date().toISOString() }); } catch { console.error('Could not save document failure status.'); }
          }
          if (!res.headersSent) res.status(error instanceof DocumentError ? error.status : 503).json({ error: message });
        } finally { processing = false; }
      })();
    });
  });
  return router;
}

export function withDocumentRetrieval(provider, store, embeddings) {
  return { ...provider,
    async documents(state) {
      const vector = await embeddings.embedQuery(state.question);
      const passages = await store.retrieveDocuments(state.documentIds, vector, state.depth === 'deep' ? 3 : 2);
      if (state.documentIds.some(id => !passages.some(p => p.documentId === id))) throw new Error('A selected document has no searchable passages.');
      const sources = [...(state.sources || [])];
      for (const passage of passages) sources.push({ ...passage, id: sources.length + 1, type: 'document' });
      return { sources };
    },
  };
}
