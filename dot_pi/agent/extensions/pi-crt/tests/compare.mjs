import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
if (!process.argv[2]) throw new Error('Usage: node tests/compare.mjs BASELINE_EXTENSION_DIRECTORY');
const live=await import(new URL('./support.mjs',import.meta.url));
const old=await import(pathToFileURL(resolve(process.argv[2],'tests/support.mjs')));
const model={provider:'p',api:'a',id:'m',contextWindow:1000};
const observed=h=>{
 const d=h.context.contextData(h.state), p=h.inventory.prompt(h.state);
 // Counter provenance is new metadata; numeric and selection behavior still compare exactly.
 const {counterId: _counterId, ...legacyPrompt}=p??{};
 return {parts:d.contextParts,prompt:d.prompt,tools:d.tools,origin:d.origin,usage:d.reportedUsage,warning:d.captureWarning,
  promptView:p?legacyPrompt:undefined,picks:h.inventory.picks(h.state),toolsView:h.inventory.tools(h.state)};
};
let checks=0;
async function compareScenario(execute){
 const histories=[];
 for(const support of [old,live]) {
  const history=[];
  await execute(support,(h)=>history.push(structuredClone(observed(h))));
  histories.push(history);
 }
 assert.deepEqual(histories[1],histories[0]);checks+=histories[0].length;
}
for(const length of [0,1,3,4,5,8,13]) for(const mode of ['replace','delete','add','reorder']) {
 await compareScenario(async(s,check)=>{
  const {harness,system,user,assistant,tool}=s;
  const def=tool('call','definition');
  const base=[system('BASE',[def]),user('x'.repeat(length),7),assistant('anchor'),user('x'.repeat(length),7)];
  const h=await harness({messages:base,allTools:[def]});check(h);
  const change=user('y'.repeat(length+5),7);
  const request=mode==='replace'?[base[0],change,...base.slice(2)]:mode==='delete'?[base[0],...base.slice(2)]:mode==='add'?[...base,change]:[base[0],base[3],base[2],base[1]];
  await h.capture(request);check(h);
  h.append(assistant('reply',{content:[{type:'text',text:'reply'},{type:'thinking',thinking:'a'},{type:'toolCall',id:'same',name:'call',arguments:{q:'text'}}],usage:{reasoning:9}}));await h.emit('turn_end');check(h);
  h.ctx.model={...model,id:'other'};await h.emit('model_select');check(h);
  h.ctx.model=model;await h.emit('model_select');check(h);
  h.entries=h.entries.slice(0,1);await h.emit('session_tree');check(h);
 });
}
await compareScenario(async(s,check)=>{
 const {harness,system,user,assistant}=s;
 const h=await harness({messages:[system('P\n<rules>\nrule\n</rules>'),user('u')]});
 h.fallback='F';await h.emit('before_agent_start',{systemPromptOptions:{forceSystemPrompt:'F',hiddenTools:[]}});await h.emit('agent_start');
 await h.capture();check(h);h.inventory.pickPart(h.state,'PREAMBLE');check(h);
 await h.emit('agent_end');await h.emit('agent_start');await h.capture();check(h);
 h.append(system('NEW'));await h.emit('turn_end');check(h);
 await h.emit('session_compact');check(h);
 await h.emit('context_with_system',{messages:[system('PENDING'),user('u')]});await h.emit('session_shutdown');await new Promise(r=>setImmediate(r));
 const resumed=await harness();resumed.sessionId=h.sessionId;await resumed.emit('session_start');check(resumed);
});
for (const operation of ['added','modified']) {
 await compareScenario(async(s,check)=>{
  const {harness,system,user,assistant}=s;
  const oldThought=assistant('',{content:[{type:'thinking',thinking:'a'}],usage:{reasoning:0}});
  const newThought=assistant('',{content:[{type:'thinking',thinking:'12345678'}],usage:{reasoning:9}});
  const h=await harness({messages:[system(),user('hello'),...(operation==='modified'?[oldThought]:[])]});
  await h.capture([system(),user('hello'),newThought]);check(h);
  for(const other of [{provider:'p',api:'a',id:'m2'},{provider:'other',api:'a',id:'m'},{provider:'p',api:'other',id:'m'}]) {
   h.ctx.model={...other,contextWindow:1000};await h.emit('model_select');check(h);
   h.ctx.model=model;await h.emit('model_select');check(h);
  }
 });
}
await compareScenario(async(s,check)=>{
 const {harness,system,user,assistant}=s;const h=await harness();
 const thought=assistant('',{content:[{type:'thinking',thinking:'12345678'}],usage:{reasoning:9}});
 h.ctx.model={...model,id:'m2'};await h.capture([...h.entries.map(e=>e.message),thought]);check(h);
 h.ctx.model=model;await h.emit('model_select');check(h);
 h.ctx.model={...model,id:'m2'};await h.emit('model_select');check(h);
});
console.log(`old/new observable equivalence: ${checks} checkpoints`);
