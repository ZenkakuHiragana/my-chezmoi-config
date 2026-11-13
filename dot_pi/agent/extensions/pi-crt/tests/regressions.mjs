import assert from 'node:assert/strict';
import {harness,system,user,assistant,tool,load} from './support.mjs';
const part=(d,label)=>d.contextParts.find(p=>p.label===label)?.tokens??0;
const t=tool();
const h=await harness({messages:[system('BASE',[t]),user('A')],allTools:[t]});
await h.emit('before_agent_start',{systemPromptOptions:{skills:[],hiddenTools:['call']}});await h.emit('agent_start');await h.capture();
const A=[...h.entries];
h.entries=[{id:'b0',message:system('B',[t])},{id:'b1',message:user('B')}];await h.emit('session_tree');
assert.equal(h.inventory.tools(h.state)[0].active,true,'B must not inherit hidden A');
await h.emit('before_agent_start',{systemPromptOptions:{skills:[],hiddenTools:[]}});await h.emit('agent_start');await h.emit('agent_end');
h.entries=A;await h.emit('session_tree');assert.equal(h.inventory.tools(h.state)[0].active,false,'uncaptured B run must not overwrite A evidence');
const unknown=tool('injected','x'.repeat(100));
const u=await harness({messages:[system('BASE',[t,unknown]),user('hello')],allTools:[t]});
assert.equal(u.inventory.tools(u.state).length,2);
assert.equal(u.inventory.tools(u.state).find(t=>t.name==='injected').exposure,'declared');
assert.equal(part(u.context.contextData(u.state),'TOOLS'),u.inventory.tools(u.state).filter(t=>t.active).reduce((sum,t)=>sum+t.tokens,0));

const requestOnly={role:'custom',customType:'request-only',content:'added',display:false,timestamp:9};
const lifecycle=await harness();lifecycle.fallback='FORCE';await lifecycle.capture([...lifecycle.entries.map(e=>e.message),requestOnly]);
assert.ok(part(lifecycle.context.contextData(lifecycle.state),'OTHER')>0);
await lifecycle.emit('session_shutdown');
const resumed=await harness();resumed.sessionId=lifecycle.sessionId;await resumed.emit('session_start');
assert.equal(resumed.inventory.prompt(resumed.state).text,'FORCE');
assert.equal(part(resumed.context.contextData(resumed.state),'OTHER'),0,'only system evidence survives shutdown');

const pending=await harness();pending.fallback='OLD';await pending.emit('context_with_system',{messages:pending.entries.map(e=>e.message)});pending.fallback='NEW';await pending.emit('context_with_system',{messages:pending.entries.map(e=>e.message)});
assert.equal(pending.inventory.prompt(pending.state).text,'NEW');
await new Promise(r=>setImmediate(r));assert.equal(pending.inventory.prompt(pending.state).text,'NEW');
const cancelled=await harness();cancelled.fallback='CANCELLED';await cancelled.emit('context_with_system',{messages:[...cancelled.entries.map(e=>e.message),requestOnly]});cancelled.fallback='BASE';await cancelled.emit('session_compact');await new Promise(r=>setImmediate(r));
assert.equal(cancelled.inventory.prompt(cancelled.state).text,'BASE');assert.equal(part(cancelled.context.contextData(cancelled.state),'OTHER'),0);
const dying=await harness();dying.fallback='DO NOT SAVE';await dying.emit('context_with_system',{messages:dying.entries.map(e=>e.message)});await dying.emit('session_shutdown');await new Promise(r=>setImmediate(r));
const after=await harness();after.sessionId=dying.sessionId;await after.emit('session_start');assert.equal(after.inventory.prompt(after.state).text,'BASE');

const {captureRequest}=await load('state/request-context.ts');
const image={role:'user',content:[{type:'image',data:'RAW IMAGE',mimeType:'image/png'}],timestamp:9};
const signed=assistant('signed',{content:[{type:'text',text:'txt',textSignature:'RAW TEXT SIGNATURE'},{type:'thinking',thinking:'think',thinkingSignature:'RAW THINKING SIGNATURE'},{type:'toolCall',name:'call',id:'id',arguments:{},thoughtSignature:'RAW TOOL SIGNATURE'}]});
const snap=captureRequest(after.ctx.sessionManager.buildSessionProjection(),[...after.entries.map(e=>e.message),image,signed],'BASE',after.ctx.sessionManager.getLeafId());
const raw=JSON.stringify(snap);
for(const forbidden of ['RAW IMAGE','RAW TEXT SIGNATURE','RAW THINKING SIGNATURE','RAW TOOL SIGNATURE'])assert.ok(!raw.includes(forbidden),forbidden);
console.log('round1 regression assertions passed');

// The scheduled path publishes without a consumer read, and deferred failures are contained.
const scheduled=await harness();scheduled.fallback='SCHEDULED';
await scheduled.emit('context_with_system',{messages:scheduled.entries.map(e=>e.message)});
const beforeBuild=scheduled.invalidations;
await new Promise(r=>setImmediate(r));
assert.ok(scheduled.invalidations>beforeBuild,'deferred build publishes and invalidates');
assert.equal(scheduled.inventory.prompt(scheduled.state).text,'SCHEDULED');
const cyclic={};cyclic.self=cyclic;
await scheduled.emit('context_with_system',{messages:[...scheduled.entries.map(e=>e.message),assistant('',{content:[{type:'toolCall',id:'bad',name:'call',arguments:cyclic}]})]});
scheduled.fallback='BASE';await new Promise(r=>setImmediate(r));
assert.equal(scheduled.inventory.prompt(scheduled.state).text,'BASE');
assert.ok(scheduled.context.contextData(scheduled.state).captureWarning);
const noUI=await harness();noUI.ctx.hasUI=false;noUI.fallback='UNOBSERVED';
await noUI.emit('context_with_system',{messages:[...noUI.entries.map(e=>e.message),requestOnly]});
assert.equal(noUI.context.contextData(noUI.state).origin,'recorded');
assert.equal(part(noUI.context.contextData(noUI.state),'OTHER'),0);
console.log('deferred capture and no-UI assertions passed');

// A run starting at a shared ancestor must not override capture A on return.
const shared=await harness({messages:[system('BASE',[t]),user('A')],allTools:[t]});
await shared.emit('before_agent_start',{systemPromptOptions:{hiddenTools:['call']}});await shared.emit('agent_start');await shared.capture();
const branchA=[...shared.entries];
shared.entries=branchA.slice(0,1);await shared.emit('session_tree');
await shared.emit('before_agent_start',{systemPromptOptions:{hiddenTools:[]}});await shared.emit('agent_start');
shared.entries=[...shared.entries,{id:'unique-b-user',message:user('B')}];await shared.emit('agent_end');
shared.entries=branchA;await shared.emit('session_tree');
assert.equal(shared.inventory.tools(shared.state)[0].active,false);
shared.append(system('NEW SYSTEM',[t]));await shared.emit('turn_end');
assert.equal(shared.inventory.tools(shared.state)[0].active,true,'stale capture hidden must expire with its system');

// Pending capture owns hidden evidence independently of active-run teardown.
const endPending=await harness({messages:[system('BASE',[t]),user('hello')],allTools:[t]});
await endPending.emit('before_agent_start',{systemPromptOptions:{hiddenTools:['call']}});await endPending.emit('agent_start');
await endPending.emit('context_with_system',{messages:endPending.entries.map(e=>e.message)});await endPending.emit('agent_end');
assert.equal(endPending.inventory.tools(endPending.state)[0].active,false);
console.log('shared ancestor and system freshness assertions passed');

// Pi force is applied after context hooks: text/sections lose to force, tool edits remain.
const {api}=await import('./support.mjs');
const hookSystem=system('context edit',[tool('call','changed definition')]);hookSystem.sections={extra:'section edit'};
const actualProjection={agent:{transformContext:async()=>[hookSystem]},_runSystemPromptOptions:{forceSystemPrompt:'FORCED'}};
api.AgentSession.prototype._installAgentForcedPromptProjection.call(actualProjection);
const providerMessages=await actualProjection.agent.transformContext([]);
assert.equal(providerMessages[0].content,'FORCED');assert.equal(providerMessages[0].sections,undefined);
assert.equal(providerMessages[0].toolsAdded[0].description,'changed definition');
console.log('actual Pi forced projection assertions passed');

// The settled before_agent_start object carries an explicit force flag, even for equal/empty text.
for (const forcedText of ['BASE','']) {
  const known=await harness();const options={hiddenTools:[]};
  await known.emit('before_agent_start',{systemPromptOptions:options});
  options.forceSystemPrompt=forcedText; // A later handler/core return updates the same options object.
  await known.emit('agent_start');known.fallback=forcedText;
  const request=structuredClone(known.entries.map(e=>e.message));request[0].content='HOOK EDIT';
  await known.capture(request);assert.equal(known.inventory.prompt(known.state).text,forcedText);
}
const noForce=await harness({messages:[system('LEGACY'),user('hello')]});
await noForce.emit('before_agent_start',{systemPromptOptions:{hiddenTools:[]}});await noForce.emit('agent_start');noForce.fallback='NEW BUILT';
const noForceRequest=structuredClone(noForce.entries.map(e=>e.message));noForceRequest[0].content='HOOK EDIT';
await noForce.capture(noForceRequest);assert.equal(noForce.inventory.prompt(noForce.state).text,'HOOK EDIT');
const retry=await harness({messages:[system('BASE',[t]),user('hello')],allTools:[t]});
const retryOptions={hiddenTools:['call']};
await retry.emit('before_agent_start',{systemPromptOptions:retryOptions});await retry.emit('agent_start');await retry.capture();
await retry.emit('agent_end');await retry.emit('agent_start');await retry.capture();
assert.equal(retry.inventory.tools(retry.state)[0].active,false,'continuation keeps known run options');
// The initial options object can also change after agent_start; sample it again at capture.
retryOptions.hiddenTools=[];await retry.capture();assert.equal(retry.inventory.tools(retry.state)[0].active,true);
const settled=await harness();
await settled.emit('before_agent_start',{systemPromptOptions:{forceSystemPrompt:'BASE',hiddenTools:[]}});await settled.emit('agent_start');
await settled.emit('agent_end');await settled.emit('agent_settled');
const afterSettled=structuredClone(settled.entries.map(e=>e.message));afterSettled[0].content='AFTER SETTLED';
await settled.capture(afterSettled);assert.equal(settled.inventory.prompt(settled.state).text,'AFTER SETTLED');
const rawTool={role:'toolResult',toolCallId:'id',toolName:'call',content:[{type:'image',data:'RAW DETAILS IMAGE',mimeType:'image/png'}],details:{copy:'RAW DETAILS IMAGE'},isError:false,timestamp:1};
const redacted=captureRequest(after.ctx.sessionManager.buildSessionProjection(),[...after.entries.map(e=>e.message),rawTool],'BASE',after.ctx.sessionManager.getLeafId());
assert.ok(!JSON.stringify(redacted).includes('RAW DETAILS IMAGE'));
const retainedTool=redacted.conversation.find(e=>e.type==='added'&&e.contribution.parts.some(p=>p.label==='TOOL RESULTS')).contribution;
assert.equal(retainedTool.parts.reduce((n,p)=>n+p.tokens.chars4,0),api.estimateTokens(rawTool));
console.log('known force, continuation and metadata assertions passed');
