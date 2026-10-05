import { ShieldCheck, AlertTriangle } from 'lucide-react';

const names = { supported:'Supported by cited excerpts', uncertain:'Uncertain', unsupported:'Unsupported', not_claim:'Non-factual text', not_checked:'Not checked' };
export function evidenceLabel(check) {
  return ({no_issues_found:'No issues found in checked excerpts',needs_review:'Evidence needs review',partial:'Evidence check incomplete',unavailable:'Evidence check unavailable',not_checked:'Not checked'})[check?.status] || 'Not checked';
}
function source(id) {
  const element=document.getElementById(`source-${id}`);
  if(element?.tagName==='DETAILS') element.open=true;
  element?.scrollIntoView({behavior:'smooth',block:'center'});
  element?.focus();
}
export default function EvidenceCheck({ check }) {
  if (!check?.claims) return <div className="evidence-check"><h2>Evidence check</h2><p>{check?.scope || 'This report predates the evidence-check feature. Start a new research run to check a newly generated report.'}</p></div>;
  return <section className="evidence-check"><h2><ShieldCheck size={22}/> {evidenceLabel(check)}</h2><p>{check.scope}</p>{check.error && <p role="status" className="error-message">{check.error}</p>}<div className="evidence-counts">{Object.entries(check.counts).map(([key,value])=><span key={key} className={`evidence-tag ${key}`}>{value} {names[key]}</span>)}</div><p>{check.checkedBlocks} of {check.totalBlocks} report passages assessed. Each passage may contain several claims; its verdict covers the whole passage.</p><div className="citation-results"><h3>Citation checks</h3><p>Invalid source numbers: {check.citations.invalidSourceIds.join(', ') || 'none'}</p><p>Unrecognized citation markers: {check.citations.malformed.join(', ') || 'none'}</p><p>Passages without numeric citations: {check.citations.uncitedBlockIds.join(', ') || 'none'}. Some may be non-factual text.</p></div>{check.claims.map(claim=><details className={`claim-check ${claim.verdict}`} key={claim.id} open={['unsupported','uncertain','not_checked'].includes(claim.verdict)}><summary><span>Passage {claim.id}</span><span className={`evidence-tag ${claim.verdict}`}>{names[claim.verdict]}</span></summary><blockquote>{claim.text}</blockquote><p>{claim.reason}</p>{claim.invalidSourceIds.length>0&&<p className="citation-warning"><AlertTriangle size={13}/> Invalid source IDs: {claim.invalidSourceIds.join(', ')}</p>}{claim.evidence.map((e,i)=><div className="evidence-quote" key={i}><button type="button" onClick={()=>source(e.sourceId)}>Source [{e.sourceId}]</button><q>{e.quote}</q><small>Quote matched to the retrieved excerpt.</small></div>)}</details>)}</section>;
}
