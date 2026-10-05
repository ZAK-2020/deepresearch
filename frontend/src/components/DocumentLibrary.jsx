import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, LoaderCircle, Check, XCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';

async function request(path, options) {
  const response = await fetch('/api/documents' + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load documents.');
  return data;
}
export default function DocumentLibrary({ health, selected, onSelect, disabled }) {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const input = useRef(null);
  const mounted = useRef(true);
  const pendingSelection = useRef(null);
  const selectedRef = useRef(selected);
  const selectRef = useRef(onSelect);
  selectedRef.current = selected;
  selectRef.current = onSelect;
  useEffect(() => {
    mounted.current = true;
    if (health?.storage !== 'postgresql') return () => { mounted.current = false; };
    let active = true, timer;
    async function load() {
      try {
        const rows = await request('');
        if (!active) return;
        setDocuments(rows);
        const pending = rows.find(doc => doc.id === pendingSelection.current);
        if (pending?.status === 'ready') {
          if (selectedRef.current.length < 5 && !selectedRef.current.includes(pending.id)) selectRef.current([...selectedRef.current, pending.id]);
          pendingSelection.current = null;
        } else if (pending?.status === 'failed') pendingSelection.current = null;
      } catch (e) { if (active) setError(e.message); }
      finally { if (active) timer = setTimeout(load, 2000); }
    }
    load();
    return () => { active = false; mounted.current = false; clearTimeout(timer); };
  }, [health?.storage]);
  async function upload(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setNotice('');
    if (file.size > 5 * 1024 * 1024) { setError('Files must be 5 MB or smaller.'); return; }
    if (!/\.(pdf|txt|md)$/i.test(file.name)) { setError('Choose a PDF, TXT, or Markdown file.'); return; }
    setUploading(true);
    try {
      const form = new FormData(); form.append('file', file);
      const doc = await request('', { method: 'POST', body: form });
      if (!mounted.current) return;
      pendingSelection.current = doc.id;
      setDocuments(rows => [doc, ...rows.filter(row => row.id !== doc.id)]);
      setNotice(doc.status === 'ready' ? 'This file is already indexed and ready to select.' : 'File received. Extracting text and preparing it for search…');
    } catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setUploading(false); }
  }
  async function showPreview(id) {
    setPreviewBusy(true); setError('');
    try { const result = await request(`/${id}/passages`); if (mounted.current) setPreview(result); }
    catch (e) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setPreviewBusy(false); }
  }
  const processing = documents.some(doc => doc.status === 'processing');
  return <section className="document-library" aria-label="Research documents">
    <div className="document-heading"><div><h3><FileText size={16}/> Your documents <span>{selected.length}/5 selected</span></h3><p>Choose the files this research can use.</p></div><Button type="button" variant="outline" size="sm" disabled={disabled || !health?.documentsConfigured || uploading || processing} onClick={() => input.current?.click()}>{uploading || processing ? <LoaderCircle size={14} className="spin"/> : <Upload size={14}/>} {uploading ? 'Uploading…' : processing ? 'Indexing…' : 'Upload file'}</Button><input ref={input} type="file" accept=".pdf,.txt,.md" onChange={upload} className="sr-only" aria-label="Upload research document" disabled={disabled || !health?.documentsConfigured || uploading || processing}/></div>
    <p className="document-help">PDF, TXT, or Markdown · up to 5 MB and 100 PDF pages. Extracted text is sent to OpenAI for indexing and analysis; API charges apply.</p>
    {!health?.documentsConfigured && <p className="document-help">PostgreSQL and an OpenAI API key are required for document research.</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {notice && <p role="status" className="document-help">{notice}</p>}
    {!!documents.length && <div className="document-list">{documents.map(doc => <div key={doc.id} className={`document-row ${selected.includes(doc.id) ? 'selected' : ''}`}><label><input type="checkbox" checked={selected.includes(doc.id)} disabled={disabled || doc.status !== 'ready' || (!selected.includes(doc.id) && selected.length >= 5)} onChange={e => onSelect(e.target.checked ? [...selected, doc.id] : selected.filter(id => id !== doc.id))}/><FileText size={17}/><span><strong>{doc.name}</strong><small>{doc.status === 'ready' ? `${doc.chunkCount} searchable passages${doc.pageCount ? ` · ${doc.pageCount} pages` : ''}` : doc.status === 'failed' ? doc.error : 'Extracting and indexing…'}</small></span></label><span className="document-status">{doc.status === 'processing' ? <LoaderCircle size={14} className="spin"/> : doc.status === 'ready' ? <Check size={14}/> : <XCircle size={14}/>}</span>{doc.status === 'ready' && <button type="button" className="document-preview-button" disabled={previewBusy} onClick={() => showPreview(doc.id)}>Preview</button>}</div>)}</div>}
    {!documents.length && <p className="document-empty">Add source material to give your research more context. Scanned PDFs need OCR before upload.</p>}
    {preview && <div className="document-preview"><div className="document-heading"><h3>{preview.document.name}</h3><Button type="button" variant="ghost" size="sm" onClick={() => setPreview(null)}>Close preview</Button></div><div className="passage-list">{preview.passages.map(p => <details key={p.chunkIndex}><summary>Passage {p.chunkIndex}{p.page ? ` · Page ${p.page}` : ''}<ChevronDown size={13}/></summary><p>{p.content}</p></details>)}</div></div>}
  </section>;
}

export function ResearchSource({ source }) {
  if (source.type === 'document') return <details id={`source-${source.id}`} className="document-source"><summary><span className="source-number">{source.id}</span><div><h3>{source.title}</h3><small>{source.page ? `Page ${source.page} · ` : ''}Passage {source.chunkIndex} · Uploaded document</small></div><ChevronDown size={14}/></summary><p>{source.content}</p><small>Retrieved passage · relevance requires human review</small></details>;
  return <a id={`source-${source.id}`} className="source-link" href={source.url} target="_blank" rel="noopener noreferrer"><span className="source-number">{source.id}</span><div><h3>{source.title}</h3><small>{new URL(source.url).hostname}</small></div><ChevronDown size={14}/></a>;
}
