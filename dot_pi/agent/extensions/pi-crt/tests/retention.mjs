import assert from 'node:assert/strict';
import {load,harness,system,user,assistant,api} from './support.mjs';
export default async function () {
  const {captureRequest}=await load('state/request-context.ts');
  const h=await harness();
  const secret='PAYLOAD_NOT_TO_RETAIN';
  const messages=[system(),user(secret),assistant('',{content:[{type:'text',text:secret,textSignature:secret},{type:'thinking',thinking:secret,thinkingSignature:secret},{type:'toolCall',id:'call',name:'lookup',arguments:{text:secret},thoughtSignature:secret}]}),
    {role:'toolResult',toolCallId:'call',toolName:'lookup',content:[{type:'image',data:secret,mimeType:'image/png'}],details:{copy:secret},timestamp:4,isError:false}];
  const snapshot=captureRequest(h.ctx.sessionManager.buildSessionProjection(),messages,'BASE',h.ctx.sessionManager.getLeafId());
  assert.ok(!JSON.stringify(snapshot.conversation).includes(secret));
  for (const edit of snapshot.conversation) {
    assert.ok(!('message' in edit));
    assert.deepEqual(Object.keys(edit).sort(),edit.type==='deleted'?['entryId','type']:edit.type==='added'?['contribution','type']:['contribution','entryId','type']);
    if (edit.type==='deleted') continue;
    const c=edit.contribution;
    assert.deepEqual(Object.keys(c).sort(),c.thinking?['parts','thinking']:['parts']);
    for (const p of c.parts) {assert.deepEqual(Object.keys(p).sort(),['label','tokens']);assert.equal(typeof p.label,'string');assert.ok(Object.keys(p.tokens).sort().join(',')==='chars4,ctok_v3,ctok_v4.7,ctok_v4.8,o200k_base'&&Object.values(p.tokens).every(Number.isFinite));}
    if(c.thinking){assert.deepEqual(Object.keys(c.thinking).sort(),['model','tokens']);assert.deepEqual(c.thinking.model,{provider:'p',api:'a',id:'m'});assert.ok(Object.keys(c.thinking.tokens).sort().join(',')==='chars4,ctok_v3,ctok_v4.7,ctok_v4.8,o200k_base'&&Object.values(c.thinking.tokens).every(Number.isFinite));}
  }
  const toolContribution=snapshot.conversation.find(e=>e.contribution?.parts.some(p=>p.label==='TOOL RESULTS')).contribution;
  assert.equal(toolContribution.parts.reduce((n,p)=>n+p.tokens.chars4,0),api.estimateTokens(messages[3]));
  console.log('numeric-only retained conversation assertions passed');
}
