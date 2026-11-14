import assert from 'node:assert/strict';
import {harness,load,tui,renderLayoutFrame,plain} from './support.mjs';
export default async function () {
 await load('panels/status.ts'); const {PANELS}=await load('panels/registry.ts');
 const h=await harness();h.reported={tokens:null,contextWindow:1000000,percent:null};await h.emit('turn_end');
 const data=h.context.contextData(h.state),panel=PANELS.get('context')(h.panelEnv);
 const set=(sizes=[120000,118000,30000])=>{data.contextParts=sizes.map((tokens,i)=>({label:['TOOL RESULTS','ASSISTANT','SYSTEM'][i]??'OTHER',tokens}));data.version++;};
 function frame(width=60,split=false) {
  const component=split?new tui.HStack([{component:panel.component,basis:width,grow:0,shrink:0,minSize:0},{component:{render:w=>['N'.repeat(w)],invalidate(){}},basis:8,grow:0,shrink:0,minSize:0}]):panel.component;
  const lines=renderLayoutFrame(component,width+(split?8:0),30,()=>{}).lines;
  for(const line of lines)assert.ok(tui.visibleWidth(line)<=width+(split?8:0));
  return lines.map(plain);
 }
 function units(line) {const b=line.match(/[█▏▎▍▌▋▊▉]+/)?.[0]??'';return [...b].reduce((n,c)=>n+(c==='█'?8:'▏▎▍▌▋▊▉'.indexOf(c)+1),0);}
 set();
 for(const split of [false,true])for(const width of [16,30,60,100]) {
  const lines=frame(width,split),text=lines.join('\n');
  assert.doesNotMatch(text,/ESTIMATE|CURRENT\/NEXT|TEXT TOKENS|Window %|context hook/);
  const top=lines.find(l=>l.includes('≈268k/1.0M 27%'));assert.ok(top,'top sum and capacity remain unchanged');if(width>=30)assert.ok(units(top)>0,'bar shares the numeric row when it fits');
  assert.match(text,/of 1\.0M/);
  const method=lines.find(l=>l.includes('chars/4'));assert.ok(method);
  const head=lines.find(l=>l.includes('≈tok'));
  if(width<=30)assert.doesNotMatch(head,/\.\.|…/,'absent axis padding is not elided information');
  const section=lines.findIndex(l=>l.includes('BREAKDOWN'));const methodIndex=lines.indexOf(method);assert.ok(section>=0 && section<=methodIndex,'tokenizer belongs inside breakdown');
  if(width>=60) {
   assert.match(head,/0\s+200k\s+≈tok\s+of 1\.0M/);
   const first=lines.find(l=>l.includes('TOOL RESULTS')),second=lines.find(l=>l.includes('ASSISTANT')),third=lines.find(l=>l.includes('SYSTEM'));
   assert.equal(units(first),96);assert.equal(units(second),94);assert.equal(units(third),24);
   assert.match(first,/120k\s+12%/);assert.match(second,/118k\s+12%/);
   assert.equal(first.indexOf('120k'),head.indexOf('≈tok'),'count header aligns with values');
   assert.equal(first.indexOf('12%')+3,head.indexOf('of 1.0M')+7,'capacity-percent right edge aligns');
  } else if(head) assert.doesNotMatch(head,/0\s+200k/,'no axis without room for bars');
  if(width===16) for(const [name,value]of[['TOOL RESULTS','120k'],['ASSISTANT','118k'],['SYSTEM','30k']]) {const row=lines.findIndex(l=>l.includes(name));assert.ok(row>=0,'narrow role remains identifiable');assert.ok(lines[row+1].includes(value),'numeric row immediately follows its role');}
 }
 for(let width=1;width<=100;width++)frame(width);
 for(const [max,scale]of [[120000,'200k'],[121000,'200k'],[200000,'200k'],[200001,'500k'],[1,'1'],[2,'2'],[3,'5'],[5,'5'],[6,'10'],[999,'1.0k'],[1000,'1.0k']]) {
  set([max]);const header=frame().find(l=>l.includes('≈tok'));assert.ok(header.match(/0\s+(\S+)\s+≈tok/)?.[1]===scale,`${max} nice threshold`);
 }
 h.reported={tokens:123,contextWindow:1000,percent:12.3};await h.emit('turn_end');h.context.contextData(h.state);set([100,100]);
 let text=frame().join('\n');assert.match(text,/123\/1.0k 12%/);assert.doesNotMatch(text,/≈123|≈200/);assert.match(text,/100\s+10%/);
 data.captureWarning='Request capture unavailable';data.version++;assert.match(frame().join('\n'),/Request capture unavailable/);data.captureWarning=undefined;
 h.reported=undefined;await h.emit('turn_end');h.context.contextData(h.state);set();text=frame().join('\n');assert.match(text,/USAGE UNKNOWN/);assert.match(text,/of \?/);assert.match(text,/120k\s+--/);
 set([]);assert.match(frame().join('\n'),/no estimated parts/);
 await h.emit('session_shutdown');console.log('context inline usage, headers and autoscale assertions passed');
}
