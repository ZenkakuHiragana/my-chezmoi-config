import assert from 'node:assert/strict';
import {load,harness,user,assistant,system,api} from './support.mjs';
export default async function () {
  const {ContextMeter}=await load('state/context.ts');
  const meter=new ContextMeter(), model={provider:'p',api:'a',id:'m'};
  const thought=(text,reasoning=0)=>assistant('',{content:[{type:'thinking',thinking:text}],usage:{reasoning}});
  const parts=(messages,next=model)=>meter.measure(messages,'',[],next);
  assert.deepEqual(parts([thought('a'),thought('b')]),[{label:'THINKING',tokens:2}]);
  assert.deepEqual(parts([thought('a',.5)]),[{label:'THINKING',tokens:1}]);
  assert.deepEqual(parts([thought('a',1.5)]),[{label:'THINKING',tokens:1.5}]);
  assert.deepEqual(parts([user('a'),user('b')]),[{label:'USER',tokens:2}]);
  assert.deepEqual(parts([user(''),assistant('1234'),user('1234')]).map(p=>p.label),['USER','ASSISTANT']);
  const calls=assistant('',{content:Array.from({length:4},(_,i)=>({type:'toolCall',id:String(i),name:'x',arguments:{}}))});
  assert.deepEqual(parts([calls]),[{label:'TOOL CALLS',tokens:4}]);
  // A source can project multiple messages. Preserve first-unpatched-slot semantics.
  const h=await harness();
  const s=system(), a=user('aaa'), b=user('bbbbb');
  const projection={messages:[s,a,b],entries:[{sourceEntry:{id:'system'},messages:[s]},{sourceEntry:{id:'multi'},messages:[a,b]}]};
  h.ctx.sessionManager={getSessionId:()=>h.sessionId,getLeafId:()=> 'multi',getBranch:()=>[{id:'system'},{id:'multi'}],buildSessionProjection:()=>projection};
  await h.capture([s,user('X'),user('YY')]);
  assert.equal(h.context.contextData(h.state).contextParts.find(p=>p.label==='USER').tokens,2);
  // Actual Pi compaction projects both system and summary from the same source.
  const session=api.SessionManager.inMemory();session.appendMessage(system('BASE'));session.appendMessage(user('old'));
  session.appendCompaction('summary',undefined,100);
  const c=await harness();c.ctx.sessionManager=session;
  const request=session.buildSessionProjection().messages.map(m=>m.role==='compactionSummary'?{...m,summary:'changed summary'}:m);
  await c.capture(request);
  const summary=request.find(m=>m.role==='compactionSummary');
  const expected=api.estimateTokens(api.convertToLlm([summary])[0]);
  assert.equal(c.context.contextData(c.state).contextParts.find(p=>p.label==='COMPACTED').tokens,expected);
  console.log('rounding, ordering and projection-slot assertions passed');
}
