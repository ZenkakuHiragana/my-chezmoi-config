import assert from 'node:assert/strict';
import {harness, load, tui, renderLayoutFrame, plain, system, user, tool} from './support.mjs';
export default async function () {
await load('panels/inv.ts'); await load('panels/status.ts');
const {PANELS}=await load('panels/registry.ts');
const {compactNumber}=await load('panels/common.ts');
const tools=Array.from({length:12},(_,i)=>tool(`tool${i}`,'description'));
const skills=Array.from({length:12},(_,i)=>({name:`skill${i}`,description:'description',filePath:`nonexistent-${i}`}));
const h=await harness({messages:[system('<section>\nhello world\n</section>',tools),user('hello')],allTools:tools,skills});
h.panelEnv.focused=()=>true;
const ids=['context','promptparts','toollist','skilllist'];
const panels=Object.fromEntries(ids.map(id=>[id,PANELS.get(id)(h.panelEnv)]));
function frame(panel,width,split,height=30) {
 const component=split?new tui.HStack([{component:panel.component,basis:width,grow:0,shrink:0,minSize:0},{component:{render:w=>['N'.repeat(w)],invalidate(){}},basis:8,grow:0,shrink:0,minSize:0}]):panel.component;
 const total=width+(split?8:0); const lines=renderLayoutFrame(component,total,height,()=>{}).lines;
 for(const l of lines) assert.ok(tui.visibleWidth(l)<=total,`overflow ${width}/${split}`);
 return lines.map(plain);
}
for (const width of [16,30,60,100]) for (const split of [false,true]) {
 for (const [model,method] of [['gpt-4o','o200k_base'],['other','chars/4'],['gpt-4o','o200k_base']]) {
  h.ctx.model.id=model; await h.emit('model_select');
  for (const id of ids) {
   const panel=panels[id]; panel.scroll.scrollToStart(); panel.scroll.markScrollbarActivity();
   const lines=frame(panel,width,split), text=lines.join('\n');
   assert.ok(text.includes('TEXT TOKENS'),`${id} label ${width}`);
   assert.ok(text.includes(method),`${id} method ${method} ${width}: ${text}`);
   assert.match(text,/[┃│]/,`${id} scrollbar`);
   if(id==='context') {const heading=lines.findIndex(l=>l.includes('CURRENT/NEXT')||l.trim()==='ESTIMATE'); assert.ok(lines.findIndex(l=>l.includes('TEXT TOKENS'))>heading,'local method belongs below the local estimate heading'); assert.match(text,/PI ESTIMATE/);assert.match(text,/Window %/);assert.match(text,width>=40?/SYSTEM.*recorded/:/SYS · log/);}
   else {
    const sel=panel.list; const count=id==='promptparts'?2:12;
    for(const i of [0,count-1]) {
      const expectedOffset=(width<30?2:1)+(id==='skilllist'?1:0)+i;
      const offset=sel.offsets[i]; assert.equal(offset,expectedOffset,`${id} actual item row ${i}`);
      if(width>=30) {
       const label=id==='toollist'?tools[i].name:id==='skilllist'?skills[i].name:i===0?'WHOLE PROMPT':h.inventory.prompt(h.state).parts[0].label;
       assert.ok(lines[1+expectedOffset].includes(label),`${id} rendered item row ${i}`);
      }
      assert.equal(sel.itemAtLine(offset),i); assert.equal(sel.itemAtLine(0),-1);
      sel.pick(i); sel.activate();
      if(id==='toollist') assert.equal(h.inventory.picks(h.state).tool,tools[i].name);
      if(id==='skilllist') assert.equal(h.inventory.picks(h.state).skill,skills[i].name);
      if(id==='promptparts') assert.equal(h.inventory.picks(h.state).part,i===0?undefined:h.inventory.prompt(h.state).parts[0].label);
    }
    if(id==='skilllist') assert.match(text,/LIST\s+LOAD/);
    if(id==='toollist') assert.ok(text.includes(`≈${compactNumber(h.inventory.tools(h.state)[0].tokens)}`));
    if(id==='promptparts') assert.ok(text.includes(`≈${compactNumber(h.inventory.prompt(h.state).parts[0].tokens)}`));
   }
  }
 }
}
for(const width of [1,2,5,10,15]) for(const id of ids) frame(panels[id],width,false);
console.log('tokenizer panels assertions passed');
// Estimated (rather than Pi-reported) context usage retains the original denominator and source.
h.reported={tokens:null,contextWindow:1000,percent:null}; await h.emit('turn_end');
const data=h.context.contextData(h.state); data.contextParts=[{label:'SYSTEM',tokens:100},{label:'USER',tokens:100}]; data.version++;
for(const width of [16,30,60,100]) for(const split of [false,true]) {
 panels.context.scroll.scrollToStart(); const text=frame(panels.context,width,split).join('\n');
 assert.match(text,/ESTIMATE/); assert.doesNotMatch(text,/PI ESTIMATE/); assert.match(text,/≈200/); assert.match(text,/100 10%/); assert.doesNotMatch(text,/100 50%/); assert.match(text,/Window %/); assert.match(text,width>=40?/SYSTEM.*recorded/:/SYS · log/);
}

}
