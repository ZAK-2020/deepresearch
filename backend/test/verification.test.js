import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectCitations, verifyReport, verificationAppendix } from '../src/verification.js';
import { createApp } from '../src/app.js';
import { memoryStore } from '../src/store.js';

const sources=[{id:1,title:'Pilot notes',content:'Mira Chen owns the pilot. Exports are kept for seven days. The pilot is not approved.'}];
const supported = blockId => ({blockId,verdict:'supported',reason:'The cited excerpt states this directly.',evidence:[{sourceId:1,quote:'Exports are kept for seven days.'}]});
test('detects nonexistent sources, malformed markers, grouped citations and uncited passages',()=>{
  const result=inspectCitations('# Report\n\nExports last seven days [1, 9].\n\nAn uncited statement.\n\nA wrong reference [document-uuid].\n\n```js\n[99]\n```',sources);
  assert.deepEqual(result.invalidSourceIds,[9]);
  assert.deepEqual(result.malformed,['[document-uuid]']);
  assert.deepEqual(result.uncitedBlockIds,[2,3]);
  assert.equal(result.blocks.length,3);
});
test('supported verdict requires a quote matching the cited source',async()=>{
  const check=await verifyReport('Exports last seven days [1].',sources,async()=>({assessments:[supported(1)]}));
  assert.equal(check.status,'no_issues_found');assert.equal(check.counts.supported,1);
  assert.equal(check.claims[0].evidence.length,1);assert.equal(check.reportHash.length,64);
});
test('fabricated quotes, uncited evidence and invalid citations cannot get supported labels',async()=>{
  for(const [body,item] of [
    ['Exports last seven days [1].',{...supported(1),evidence:[{sourceId:1,quote:'Exports are kept for ninety days.'}]}],
    ['Exports last seven days.',supported(1)],
    ['Exports last seven days [9].',supported(1)],
    ['Exports last seven days [1].',{...supported(1),evidence:[{sourceId:99,quote:'Exports are kept for seven days.'}]}],
  ]){
    const check=await verifyReport(body,sources,async()=>({assessments:[item]}));
    assert.equal(check.status,'needs_review');assert.equal(check.claims[0].verdict,'uncertain');
  }
});
test('assessor receives only evidence actually cited by each block',async()=>{
  await verifyReport('Retention is seven days [1].\n\nThere is no citation.',[...sources,{id:2,content:'Do not include this unreferenced text.'}],async blocks=>{
    assert.deepEqual(blocks[0].evidence.map(s=>s.id),[1]);assert.deepEqual(blocks[1].evidence,[]);
    return{assessments:[supported(1),{blockId:2,verdict:'not_claim',reason:'Nonfactual statement.',evidence:[]}]};
  });
});
test('contradictions stay unsupported and exports retain warnings and evidence',async()=>{
  const check=await verifyReport('The pilot is approved [1].',sources,async()=>({assessments:[{blockId:1,verdict:'unsupported',reason:'The source explicitly says it is not approved.',evidence:[{sourceId:1,quote:'The pilot is not approved.'}]}]}));
  assert.equal(check.counts.unsupported,1);assert.equal(check.status,'needs_review');
  assert.match(verificationAppendix(check),/unsupported/);assert.match(verificationAppendix(check),/not approved/);
});
test('missing, duplicated, over-limit and failed assessments are never treated as passed',async()=>{
  const missing=await verifyReport('A claim [1].',sources,async()=>({assessments:[]}));
  assert.equal(missing.status,'partial');assert.equal(missing.counts.not_checked,1);
  const duplicate=await verifyReport('A claim [1].',sources,async()=>({assessments:[supported(1),supported(1)]}));
  assert.equal(duplicate.counts.not_checked,1);
  const failed=await verifyReport('A claim [9].',sources,async()=>{throw new Error('secret-provider-detail');});
  assert.equal(failed.status,'unavailable');assert.deepEqual(failed.citations.invalidSourceIds,[9]);
  assert.ok(!JSON.stringify(failed).includes('secret-provider-detail'));
  const limited=await verifyReport(Array.from({length:61},()=> 'Exports last seven days [1].').join('\n\n'),sources,async blocks=>{
    assert.equal(blocks.length,60);return{assessments:blocks.map(b=>supported(b.blockId))};
  });
  assert.equal(limited.status,'partial');assert.equal(limited.checkedBlocks,60);assert.equal(limited.totalBlocks,61);
});
test('export endpoint includes audit warnings and blocks draft exports',async t=>{
  const store=memoryStore();
  const verification=await verifyReport('A claim [99].',sources,async()=>({assessments:[]}));
  await store.save({id:'finished',status:'complete',report:'A claim [99].',verification});
  await store.save({id:'draft',status:'running',report:'A draft.'});
  const listener=createApp({env:{},store}).listen(0,'127.0.0.1');
  await new Promise(r=>listener.on('listening',r));t.after(()=>new Promise(r=>listener.close(r)));
  const origin=`http://127.0.0.1:${listener.address().port}`;
  const response=await fetch(origin+'/api/research/finished/export');assert.equal(response.status,200);
  assert.match(await response.text(),/Invalid source IDs: 99/);
  assert.equal((await fetch(origin+'/api/research/draft/export')).status,409);
});
