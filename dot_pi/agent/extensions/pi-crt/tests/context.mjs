import assert from 'node:assert/strict';
import { harness, system, user, assistant, tool, ai, api } from './support.mjs';
const part=(data,label)=>data.contextParts.find(p=>p.label===label)?.tokens??0;
const h=await harness();
await h.capture(); h.append(assistant('12345678')); await h.emit('turn_end');
assert.equal(part(h.context.contextData(h.state),'ASSISTANT'),2,'include final response in current estimate');
const forced=await harness({messages:[system('BASE',[tool()]),user('hello')],allTools:[tool()]});
forced.fallback='BASE\n\nMODEL SPECIFIC';
const changed=structuredClone(forced.entries.map(e=>e.message)); changed[0].toolsAdded[0].description='new definition';
await forced.capture(changed); forced.fallback='BASE'; forced.append(assistant('done')); await forced.emit('agent_end');
assert.equal(forced.context.contextData(forced.state).prompt,'BASE\n\nMODEL SPECIFIC');
assert.equal(forced.inventory.prompt(forced.state).text,'BASE\n\nMODEL SPECIFIC');
assert.equal(forced.inventory.tools(forced.state)[0].description,'new definition','force retains tool delta');
const oldVersion=forced.inventory.version(forced.state);
forced.fallback='BASE\n\nNEW MODEL PROMPT'; await forced.capture(changed);
assert.ok(forced.inventory.version(forced.state)>oldVersion,'key path syncs before producer');
assert.equal(forced.inventory.prompt(forced.state).text,forced.ctx.getSystemPrompt());
const delta=await harness({messages:[system('BASE'),user('hello')]});
const request=structuredClone(delta.entries.map(e=>e.message)); request[0].content='CHANGED'; request[0].sections={x:'extra'};
await delta.capture(request); assert.equal(delta.context.contextData(delta.state).prompt,'CHANGED\n\nextra');
request[0].content='mutated later'; assert.equal(delta.context.contextData(delta.state).prompt,'CHANGED\n\nextra','owned capture');
delta.append(system('NEXT')); await delta.emit('turn_end');
assert.equal(delta.context.contextData(delta.state).prompt,ai.getCurrentSystemPrompt(delta.entries.map(e=>e.message)),'freshness expires delta');
const conv=await harness({messages:[system(),user('old'),assistant('old answer')]});
await conv.capture([conv.entries[0].message,user('replacement'),{role:'custom',customType:'injection',content:'extra',display:false,timestamp:9}]);
conv.append(assistant('new answer')); await conv.emit('turn_end');
const data=conv.context.contextData(conv.state);
assert.equal(part(data,'USER'),3); assert.ok(part(data,'ASSISTANT')>0); assert.ok(part(data,'OTHER')>0);
const { load } = await import('./support.mjs');
const {ContextMeter,textTokens,toolTokens}=await load('state/context.ts');
const meter=new ContextMeter();
const msg=assistant('',{content:[{type:'thinking',thinking:'12345678'}],usage:{reasoning:9}});
const measure=(message,model={provider:'p',api:'a',id:'m'})=>meter.measure([message],'',[],model);
assert.equal(part({contextParts:measure(msg)},'THINKING'),9);
assert.equal(part({contextParts:measure({...msg,model:'other'})},'THINKING'),0);
assert.equal(part({contextParts:measure(msg,undefined)},'THINKING'),9);
const call=assistant('',{content:[{type:'toolCall',id:'same',name:'call',arguments:{text:'x'}}]});
const before=part({contextParts:measure(call)},'TOOL CALLS');
call.content[0].arguments.text='x'.repeat(400);
assert.ok(part({contextParts:measure(call)},'TOOL CALLS')>before,'argument size changes estimate');
assert.equal(toolTokens(tool()),textTokens('call: description\n'+JSON.stringify(tool().parameters)));
const bash={role:'bashExecution',command:'echo hi',output:'hi',excludeFromContext:false,timestamp:3,exitCode:0,cancelled:false,truncated:false};
assert.equal(part({contextParts:measure(bash)},'BASH'),api.estimateTokens(api.convertToLlm([bash])[0]));
assert.equal(part({contextParts:measure({...bash,excludeFromContext:true})},'BASH'),0);
console.log('context assertions passed');

// Unknown and routed model identities follow the same rules as pi-context-view.
const {nextRequestModel}=await load('state/context.ts');
assert.equal(nextRequestModel({provider:'v',api:'pi-virtual',id:'route'},[]),undefined);
assert.deepEqual(nextRequestModel({provider:'v',api:'pi-virtual',id:'route'},[msg,assistant('bad',{model:'bad',stopReason:'error'})]),{provider:'p',api:'a',id:'m'});
assert.equal(part({contextParts:meter.measure([msg],'',[],undefined)},'THINKING'),9);
for (const identity of [{provider:'other',api:'a',id:'m'},{provider:'p',api:'other',id:'m'},{provider:'p',api:'a',id:'other'}]) {
  assert.equal(part({contextParts:meter.measure([msg],'',[],identity)},'THINKING'),0);
}

// Hidden declarations are settled after all before_agent_start handlers.
const hiddenTool=tool();
const hidden=await harness({messages:[system('BASE',[hiddenTool]),user('hello')],allTools:[hiddenTool]});
const options={skills:[],hiddenTools:[]};
await hidden.emit('before_agent_start',{systemPromptOptions:options});
options.hiddenTools.push('call');
await hidden.emit('agent_start'); await hidden.capture();
assert.equal(part(hidden.context.contextData(hidden.state),'TOOLS'),0);
assert.equal(hidden.inventory.tools(hidden.state)[0].active,false);

// Leaf-key caching never walks/measures the same recorded branch on an idle redraw.
let projections=0;
const original=h.ctx.sessionManager.buildSessionProjection;
h.ctx.sessionManager.buildSessionProjection=()=>{projections++;return original();};
h.context.contextData(h.state); h.context.contextData(h.state);
assert.equal(projections,0);

// Live built fallback inputs may change without a session entry or lifecycle event.
const liveTool=tool();
const built=await harness({messages:[user('hello')],allTools:[liveTool]});
const builtBefore=part(built.context.contextData(built.state),'TOOLS');
liveTool.parameters.properties.value.description='x'.repeat(400);
built.fallback='BUILT NEW';
const builtAfter=built.context.contextData(built.state);
assert.equal(builtAfter.prompt,'BUILT NEW');
assert.ok(part(builtAfter,'TOOLS')>builtBefore);
assert.equal(built.inventory.tools(built.state)[0].tokens,toolTokens(liveTool));

// Remembered evidence is valid on its capture branch, not on unrelated history.
const tree=await harness(); tree.fallback='FORCED';
await tree.capture([...tree.entries.map(e=>e.message),{role:'custom',customType:'added',content:'request only',display:false,timestamp:9}]);
tree.fallback='BASE'; tree.append(assistant('done'));
const saved=[...tree.entries];
await tree.emit('session_tree'); assert.equal(tree.inventory.prompt(tree.state).text,'FORCED');
tree.entries=saved.slice(0,1); await tree.emit('session_tree');
assert.equal(tree.context.contextData(tree.state).origin,'recorded');
assert.equal(tree.inventory.prompt(tree.state).text,'BASE');
tree.entries=saved; await tree.emit('session_tree'); assert.equal(tree.inventory.prompt(tree.state).text,'FORCED');
const resume=await harness({messages:saved.map(e=>e.message)});
resume.sessionId=tree.sessionId; await resume.emit('session_start');
assert.equal(resume.inventory.prompt(resume.state).text,'FORCED');
tree.append({role:'compactionSummary',summary:'summary',tokensBefore:100,timestamp:10}); await tree.emit('session_compact');
assert.equal(tree.context.contextData(tree.state).origin,'recorded');
assert.equal(part(tree.context.contextData(tree.state),'OTHER'),0,'no request-only additions after compaction');
assert.ok(part(tree.context.contextData(tree.state),'COMPACTED')>0);

// A failed new capture must not preserve a prior observed forced prompt.
const failure=await harness(); failure.fallback='OLD FORCE'; await failure.capture(); failure.fallback='BASE';
await failure.capture([...failure.entries.map(e=>e.message),{role:'custom',customType:'uncloneable',content:'safe',display:false,timestamp:9,details:{fn:()=>{}}}]);
assert.equal(failure.inventory.prompt(failure.state).text,'BASE');
assert.equal(failure.context.contextData(failure.state).origin,'recorded');
assert.ok(failure.context.contextData(failure.state).captureWarning);
await failure.capture(); assert.equal(failure.context.contextData(failure.state).captureWarning,undefined);
await failure.emit('session_shutdown'); assert.equal(failure.context.contextUsage(failure.state),undefined);
console.log('lifecycle and fallback assertions passed');
