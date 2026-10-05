import { z } from 'zod';
import { createHash } from 'node:crypto';

export const assessmentSchema = z.object({ assessments: z.array(z.object({
  blockId: z.number().int(), verdict: z.enum(['supported', 'uncertain', 'unsupported', 'not_claim']),
  reason: z.string().min(1).max(700),
  evidence: z.array(z.object({ sourceId: z.number().int(), quote: z.string().min(1).max(400) })).max(4),
})).max(60) });
const normalize = text => text.normalize('NFKC').replace(/\s+/g, ' ').trim();

export function citationIds(text) {
  const ids = [], malformed = [];
  for (const match of text.matchAll(/\[([^\]\n]{1,180})\]/g)) {
    if (/^\s*\d+(?:\s*,\s*\d+)*\s*$/.test(match[1])) ids.push(...match[1].split(',').map(Number));
    else malformed.push(match[0]);
  }
  return { ids: [...new Set(ids)], malformed: [...new Set(malformed)] };
}
export function inspectCitations(body, sources) {
  const valid = new Set(sources.map(s => s.id));
  const blocks = []; let paragraph = []; let codeFence = false;
  function flush() {
    const text = paragraph.join(' ').trim(); paragraph = [];
    if (!text) return;
    const { ids, malformed } = citationIds(text);
    blocks.push({ id: blocks.length + 1, text, citedSourceIds: ids, invalidSourceIds: ids.filter(id => !valid.has(id)), malformed });
  }
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { flush(); codeFence = !codeFence; continue; }
    if (codeFence) continue;
    if (!line.trim() || /^\s*#{1,6}\s/.test(line) || /^\s*[-*_]{3,}\s*$/.test(line) || /^\s*\|?[\s:|-]+\|\s*$/.test(line)) { flush(); continue; }
    if (/^\s*(?:[-*+]\s|\d+\.\s|\|)/.test(line)) { flush(); paragraph.push(line); flush(); }
    else paragraph.push(line);
  }
  flush();
  // Check all non-code text, including headings, for nonexistent references.
  const all = citationIds(body.replace(/(```|~~~)[\s\S]*?\1/g, ''));
  return { blocks, invalidSourceIds: all.ids.filter(id => !valid.has(id)), malformed: all.malformed,
    citedSourceIds: all.ids.filter(id => valid.has(id)), uncitedBlockIds: blocks.filter(b => !b.citedSourceIds.length).map(b => b.id) };
}

export async function verifyReport(body, sources, assess) {
  const citations = inspectCitations(body, sources);
  const selected = citations.blocks.slice(0, 60);
  let result, error;
  try {
    result = assessmentSchema.parse(await assess(selected.map(block => ({
      blockId: block.id, text: block.text,
      evidence: sources.filter(s => block.citedSourceIds.includes(s.id)).map(({id, title, content}) => ({id, title, content})),
    }))));
  } catch { error = 'The model-assisted evidence check could not finish. Citation syntax checks are still available.'; }
  const claims = citations.blocks.map(block => {
    const matches = result?.assessments.filter(a => a.blockId === block.id) || [];
    const item = matches.length === 1 && block.id <= 60 ? matches[0] : null;
    let verdict = item?.verdict || 'not_checked';
    let reason = item?.reason || (block.id > 60 ? 'Beyond the 60-passage audit limit.' : 'No unique assessment was returned for this passage.');
    const evidence = (item?.evidence || []).filter(e => {
      const source = sources.find(s => s.id === e.sourceId);
      return block.citedSourceIds.includes(e.sourceId) && source && normalize(e.quote).length >= 12 && normalize(source.content).includes(normalize(e.quote));
    });
    if (verdict === 'supported' && (!evidence.length || block.invalidSourceIds.length || block.malformed.length)) {
      verdict = 'uncertain'; reason = 'Support could not be validated: a cited source or exact evidence quote is missing or invalid. ' + reason;
    }
    if (verdict === 'supported' && evidence.length !== item.evidence.length) { verdict = 'uncertain'; reason = 'Some evidence quotes could not be matched to the cited excerpts. ' + reason; }
    return { ...block, verdict, reason, evidence };
  });
  const counts = Object.fromEntries(['supported','uncertain','unsupported','not_claim','not_checked'].map(v => [v, claims.filter(c => c.verdict === v).length]));
  return {
    version: 1, checkedAt: new Date().toISOString(), reportHash: createHash('sha256').update(body).digest('hex'),
    status: error ? 'unavailable' : counts.not_checked ? 'partial' : counts.supported > 0 && !counts.uncertain && !counts.unsupported && !citations.invalidSourceIds.length && !citations.malformed.length ? 'no_issues_found' : 'needs_review',
    scope: 'Model-assisted comparison of report passages against cited excerpts only. No independent fact-check or full-page verification. Quotation matches validate provenance, not truth.',
    error, counts, totalBlocks: claims.length, checkedBlocks: claims.length - counts.not_checked,
    citations: { invalidSourceIds: citations.invalidSourceIds, malformed: citations.malformed, citedSourceIds: citations.citedSourceIds, uncitedBlockIds: citations.uncitedBlockIds }, claims,
  };
}

const plain = text => String(text).replace(/[\r\n]+/g, ' ').replace(/[<>`*_\[\]\\]/g, '');
export function verificationAppendix(verification) {
  if (!verification) return '';
  const lines = ['\n\n## Evidence check', `Status: ${verification.status.replaceAll('_', ' ')}.`, verification.scope];
  if (verification.error) lines.push(verification.error);
  if (verification.claims) {
    lines.push(`Coverage: ${verification.checkedBlocks}/${verification.totalBlocks} report passages assessed.`,
      `Invalid source IDs: ${verification.citations.invalidSourceIds.join(', ') || 'none'}.`,
      `Uncited passages: ${verification.citations.uncitedBlockIds.join(', ') || 'none'} (may include non-factual text).`);
    if (verification.citations.malformed.length) lines.push(`Unrecognized citation markers: ${verification.citations.malformed.map(plain).join(', ')}.`);
    for (const claim of verification.claims) {
      lines.push(`\n### Passage ${claim.id}: ${claim.verdict.replaceAll('_', ' ')}`, plain(claim.text), plain(claim.reason));
      for (const evidence of claim.evidence) lines.push(`Source ${evidence.sourceId}: "${plain(evidence.quote)}"`);
    }
  }
  return lines.join('\n\n');
}
