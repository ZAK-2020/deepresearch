export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;
export function vectorLiteral(vector) {
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS || vector.some(n => !Number.isFinite(n)) || !vector.some(n => n !== 0)) throw new Error('Invalid embedding vector.');
  return '[' + vector.join(',') + ']';
}
export async function initializeDocuments(pool, recover) {
  await pool.query(`CREATE TABLE IF NOT EXISTS documents (
    id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL,
    user_id uuid
  );
  CREATE TABLE IF NOT EXISTS document_chunks (
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL, page integer, content text NOT NULL,
    embedding vector(1536) NOT NULL, PRIMARY KEY (document_id, chunk_index)
  );`);
  await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id uuid');
  await pool.query('CREATE INDEX IF NOT EXISTS documents_user_created_idx ON documents (user_id, created_at DESC)');
  if (recover) await pool.query(`UPDATE documents SET data = data || '{"status":"failed","error":"Document processing was interrupted by a restart. Upload the file again."}'::jsonb WHERE data->>'status' = 'processing'`);
}
export function documentStore(pool, userId) {
  const owned = userId !== undefined;
  return {
    async listDocuments() { return (await pool.query(`SELECT data FROM documents ${owned ? 'WHERE user_id = $1' : ''} ORDER BY created_at DESC`, owned ? [userId] : [])).rows.map(r => r.data); },
    async getDocument(id) { return (await pool.query(`SELECT data FROM documents WHERE id = $1 ${owned ? 'AND user_id = $2' : ''}`, owned ? [id, userId] : [id])).rows[0]?.data; },
    async findDocument(hash) { return (await pool.query(`SELECT data FROM documents WHERE data->>'hash' = $1 AND data->>'status' = 'ready' AND data->>'embeddingModel' = $2 ${owned ? 'AND user_id = $3' : ''} LIMIT 1`, owned ? [hash, EMBEDDING_MODEL, userId] : [hash, EMBEDDING_MODEL])).rows[0]?.data; },
    async saveDocument(doc) { await pool.query('INSERT INTO documents (id, data, user_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data WHERE documents.user_id IS NOT DISTINCT FROM EXCLUDED.user_id', [doc.id, doc, owned ? userId : null]); },
    async completeDocument(doc, chunks, vectors) {
      if (chunks.length !== vectors.length || !chunks.length) throw new Error('Embedding count mismatch.');
      const embeddings = vectors.map(vectorLiteral);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (owned && !(await client.query('SELECT id FROM documents WHERE id = $1 AND user_id = $2 FOR UPDATE', [doc.id, userId])).rowCount) throw new Error('Document not found.');
        for (let i = 0; i < chunks.length; i++) await client.query('INSERT INTO document_chunks (document_id, chunk_index, page, content, embedding) VALUES ($1, $2, $3, $4, $5::vector)', [doc.id, i + 1, chunks[i].page, chunks[i].content, embeddings[i]]);
        await client.query(`UPDATE documents SET data = $2 WHERE id = $1 ${owned ? 'AND user_id = $3' : ''}`, owned ? [doc.id, doc, userId] : [doc.id, doc]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async documentPassages(id) { return (await pool.query(`SELECT c.chunk_index AS "chunkIndex", c.page, c.content FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE d.id = $1 ${owned ? 'AND d.user_id = $2' : ''} ORDER BY c.chunk_index`, owned ? [id, userId] : [id])).rows; },
    async retrieveDocuments(ids, vector, perDocument = 2) {
      const embedding = vectorLiteral(vector);
      // Exact cosine search is appropriate for this bounded local library.
      // Per-document limits ensure each explicitly selected file is represented.
      return (await pool.query(`SELECT d.id AS "documentId", d.data->>'name' AS title, c.* FROM documents d
        CROSS JOIN LATERAL (SELECT chunk_index AS "chunkIndex", page, content, 1 - (embedding <=> $2::vector) AS similarity
          FROM document_chunks WHERE document_id = d.id ORDER BY embedding <=> $2::vector LIMIT $3) c
        WHERE d.id = ANY($1::uuid[]) AND d.data->>'status' = 'ready' AND d.data->>'embeddingModel' = $4 ${owned ? 'AND d.user_id = $5' : ''}
        ORDER BY d.id, c.similarity DESC`, owned ? [ids, embedding, perDocument, EMBEDDING_MODEL, userId] : [ids, embedding, perDocument, EMBEDDING_MODEL])).rows;
    },
  };
}
