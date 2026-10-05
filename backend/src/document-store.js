export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
export function vectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || vector.some(n => !Number.isFinite(n)) || !vector.some(n => n !== 0)) throw new Error('Invalid embedding vector.');
  return '[' + vector.join(',') + ']';
}
export async function initializeDocuments(pool, recover) {
  await pool.query(`CREATE TABLE IF NOT EXISTS documents (
    id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS document_chunks (
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL, page integer, content text NOT NULL,
    embedding vector(1536) NOT NULL, PRIMARY KEY (document_id, chunk_index)
  );`);
  if (recover) await pool.query(`UPDATE documents SET data = data || '{"status":"failed","error":"Document processing was interrupted by a restart. Upload the file again."}'::jsonb WHERE data->>'status' = 'processing'`);
}
export function documentStore(pool) {
  return {
    async listDocuments() { return (await pool.query('SELECT data FROM documents ORDER BY created_at DESC')).rows.map(r => r.data); },
    async getDocument(id) { return (await pool.query('SELECT data FROM documents WHERE id = $1', [id])).rows[0]?.data; },
    async findDocument(hash) { return (await pool.query("SELECT data FROM documents WHERE data->>'hash' = $1 AND data->>'status' = 'ready' AND data->>'embeddingModel' = $2 LIMIT 1", [hash, EMBEDDING_MODEL])).rows[0]?.data; },
    async saveDocument(doc) { await pool.query('INSERT INTO documents (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [doc.id, doc]); },
    async completeDocument(doc, chunks, vectors) {
      if (chunks.length !== vectors.length || !chunks.length) throw new Error('Embedding count mismatch.');
      const embeddings = vectors.map(vectorLiteral);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < chunks.length; i++) await client.query('INSERT INTO document_chunks (document_id, chunk_index, page, content, embedding) VALUES ($1, $2, $3, $4, $5::vector)', [doc.id, i + 1, chunks[i].page, chunks[i].content, embeddings[i]]);
        await client.query('UPDATE documents SET data = $2 WHERE id = $1', [doc.id, doc]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async documentPassages(id) { return (await pool.query('SELECT chunk_index AS "chunkIndex", page, content FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index', [id])).rows; },
    async retrieveDocuments(ids, vector, perDocument = 2) {
      const embedding = vectorLiteral(vector);
      // Exact cosine search is appropriate for this bounded local library.
      // Per-document limits ensure each explicitly selected file is represented.
      return (await pool.query(`SELECT d.id AS "documentId", d.data->>'name' AS title, c.* FROM documents d
        CROSS JOIN LATERAL (SELECT chunk_index AS "chunkIndex", page, content, 1 - (embedding <=> $2::vector) AS similarity
          FROM document_chunks WHERE document_id = d.id ORDER BY embedding <=> $2::vector LIMIT $3) c
        WHERE d.id = ANY($1::uuid[]) AND d.data->>'status' = 'ready' AND d.data->>'embeddingModel' = $4
        ORDER BY d.id, c.similarity DESC`, [ids, embedding, perDocument, EMBEDDING_MODEL])).rows;
    },
  };
}
