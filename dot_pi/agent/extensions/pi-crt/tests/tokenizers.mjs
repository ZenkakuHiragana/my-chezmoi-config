import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {harness,system,user,assistant,load,api} from './support.mjs';

// Expected BPE values are fixed official-Python fixtures, not this implementation's output.
const oracle=JSON.parse(readFileSync(new URL('./fixtures/tokenizers.json',import.meta.url),'utf8'));
const f=oracle.texts;
const G={provider:'p',api:'a',id:'gpt-6.1-sol',contextWindow:1000};
const C={provider:'p',api:'a',id:'claude-test',contextWindow:1000};
const select=async(h,model)=>{h.ctx.model={...model};await h.emit('model_select');};
const parts=h=>Object.fromEntries(h.context.contextData(h.state).contextParts.map(p=>[p.label,p.tokens]));

export default async function () {
 const {TEXT_COUNTERS,chars4,counterForModel,countText,counted}=await load('state/tokenizers.ts');
 const {messageContribution,ContextMeter,nextRequestModel}=await load('state/context.ts');
 assert.ok(Object.isFrozen(TEXT_COUNTERS));assert.ok(TEXT_COUNTERS.every(Object.isFrozen));
 for(const id of ['gpt-6.1-sol','gpt-5-codex','chatgpt-4o','o3','o4-mini','openai/gpt-6.1-sol','vendor/o3']) assert.equal(counterForModel({...G,id}).id,'o200k_base');
 for(const id of ['claude-test','deepseek-v4.1-flash','glm-4.5','unknown']) assert.equal(counterForModel({...G,id}).id,'chars4');
 assert.equal(counterForModel(undefined).id,'chars4');
 for(const x of Object.values(f)) for(const counter of TEXT_COUNTERS) assert.equal(counted(countText(x.text),counter),x[counter.id]);
 assert.equal(counterForModel(G).count('ab'),1); // BPE is not additive over arbitrary slices.
 const multi=user('');multi.content=[{type:'text',text:'a'},{type:'text',text:'b'}];
 assert.equal(new ContextMeter().measure([multi],'',[],G).find(p=>p.label==='USER').tokens,1);
 const image={role:'toolResult',toolName:'lookup',toolCallId:'call',isError:false,timestamp:1,content:[{type:'text',text:'hello'},{type:'image',data:'PRIVATE_IMAGE_BYTES',mimeType:'image/png'},{type:'text',text:' world'}]};
 const imageOnly={...image,content:[image.content[1]]},imageTokens=api.estimateTokens(imageOnly);
 const imageContribution=messageContribution(image);
 assert.equal(imageContribution.parts[0].tokens.chars4,imageTokens+3);
 assert.equal(imageContribution.parts[0].tokens.o200k_base,imageTokens+2);
 assert.ok(!JSON.stringify(imageContribution).includes('PRIVATE_IMAGE_BYTES'));
 for(const m of [{role:'bashExecution',command:'echo hi',output:'日本語',excludeFromContext:false,exitCode:0,cancelled:false,truncated:false,timestamp:1},{role:'compactionSummary',summary:'日本語の要約',tokensBefore:100,timestamp:1}]) {
  const converted=api.convertToLlm([m])[0],value=messageContribution(m).parts[0].tokens;
  assert.equal(value.chars4,api.estimateTokens(converted));
  const text=typeof converted.content==='string'?converted.content:converted.content.filter(b=>b.type==='text').map(b=>b.text).join('');
  assert.equal(value.o200k_base,countText(text).o200k_base);
 }

 const temp=join(tmpdir(),'pi');await mkdir(temp,{recursive:true});const dir=await mkdtemp(join(temp,'crt-tokenizers-'));
 try {
  const path=join(dir,'SKILL.md');await writeFile(path,f.skillRaw.text,'utf8');
  const skill={name:'alpha',description:'日本語の説明',filePath:path};
  const thought=assistant('',{provider:G.provider,api:G.api,model:G.id,content:[{type:'thinking',thinking:f.thinking.text}],usage:{reasoning:9}});
  // Capture under each initial backend. Request removes DELETE and changes the old user.
  for(const initial of [G,C]) {
   const h=await harness({messages:[system(f.prompt.text,[oracle.tool]),user(f.initial.text),assistant('DELETE')],allTools:[oracle.tool]});h.fallback=f.prompt.text;
   await select(h,initial);
   await h.emit('before_agent_start',{systemPromptOptions:{skills:[skill]}});await h.emit('agent_start');
   let item;const deadline=Date.now()+5000;
   while(Date.now()<deadline){item=h.inventory.skills(h.state).items[0];if(item?.bodyTokens!==undefined||item?.bodyError)break;await new Promise(r=>setTimeout(r,5));}
   assert.ok(item&&item.bodyTokens!==undefined&&!item.bodyError,'skill raw body loaded');
   // Deleting the file before switches prevents successful rereads being the source of values.
   await rm(path);
   await h.capture([system(f.prompt.text,[oracle.tool]),user(f.edited.text),thought]);
   h.append(assistant(f.reply.text,{provider:G.provider,api:G.api,model:G.id}));await h.emit('turn_end');
   for(const selected of [initial,initial===G?C:G,initial]) {
    await select(h,selected);const data=h.context.contextData(h.state),k=data.counter.id,p=parts(h),prompt=h.inventory.prompt(h.state);
    assert.equal(k,selected.id===G.id?'o200k_base':'chars4');
    assert.equal(p.USER,f.edited[k]);assert.equal(p.ASSISTANT,f.reply[k]);
    assert.equal(p.THINKING??0,selected.id===G.id?9:0);
    assert.equal(p.SYSTEM,f.prompt[k]);assert.equal(prompt.tokens,p.SYSTEM);assert.equal(prompt.counterId,k);
    assert.equal(prompt.parts.reduce((n,p)=>n+p.tokens,0)+prompt.rest,prompt.tokens);assert.ok(prompt.parts.every(p=>p.tokens>=0));
    assert.equal(p.TOOLS,f.tool[k]);assert.equal(h.inventory.tools(h.state).filter(t=>t.active).reduce((n,t)=>n+t.tokens,0),p.TOOLS);
    const current=h.inventory.skills(h.state).items[0];assert.equal(current.tokens,f.skillBlock[k]);assert.equal(current.bodyTokens,f.skillRaw[k]);assert.equal(current.bodyError,undefined);
    if(k==='chars4') assert.equal(chars4.count(current.body),18); // A preview recount would be wrong (raw=17).
    const version=data.version;for(let i=0;i<5;i++){assert.equal(h.context.contextData(h.state).version,version);assert.equal(h.inventory.prompt(h.state),prompt);}
   }
   for(const mismatch of [{...G,provider:'other'},{...G,api:'other'},{...G,id:'gpt-other'}]) {await select(h,mismatch);assert.equal(parts(h).THINKING??0,0);}
   await select(h,G);assert.equal(parts(h).THINKING,9);
   await h.emit('session_shutdown');
   if(initial===G) await writeFile(path,f.skillRaw.text,'utf8');
  }
 } finally {await rm(dir,{recursive:true,force:true});}

 const virtual={provider:'v',api:'pi-virtual',id:'gpt-automatic',contextWindow:1000};
 assert.equal(counterForModel(nextRequestModel(virtual,[])).id,'chars4');
 const success=assistant('',{provider:G.provider,api:G.api,model:G.id}),failed=assistant('',{model:C.id,stopReason:'error'});
 assert.equal(counterForModel(nextRequestModel(virtual,[success,failed])).id,'o200k_base');
 const routed=await harness();await select(routed,virtual);await routed.capture();assert.equal(routed.context.contextData(routed.state).counter.id,'chars4');
 routed.append(success);routed.append(failed);await routed.emit('turn_end');assert.equal(routed.context.contextData(routed.state).counter.id,'o200k_base');await routed.emit('session_shutdown');
 console.log('tokenizer fixtures, captured model switches, shared inventory and raw skill LOAD assertions passed');
}
