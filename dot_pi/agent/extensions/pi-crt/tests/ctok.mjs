import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {load} from './support.mjs';

const fixture=name=>new URL('./fixtures/ctok/'+name,import.meta.url);
const corpus=name=>gunzipSync(readFileSync(fixture(name+'.jsonl.gz'))).toString('utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line));

export default async function () {
 const {ctokContentTokens,ctokFamily,ctokMessageOverhead}=await load('state/ctok.ts');
 const frames=JSON.parse(readFileSync(fixture('frames.json'),'utf8'));
 // The vendored vocabularies are ctok's release files, unchanged.
 for(const [file,sha] of Object.entries(frames.vocabulary)) assert.equal(createHash('sha256').update(readFileSync(new URL('../vendor/ctok/'+file,import.meta.url))).digest('hex'),sha,file);
 const routes=[[2,1,undefined],[2,99,undefined],[3,0,'v3'],[3,5,'v3'],[4,6,'v3'],[4,7,'v4.7'],[4,8,'v4.8'],[4,10,'v4.8'],[5,0,'v4.8'],[5,5,'v4.8']];
 for(const [major,minor,family] of routes) assert.equal(ctokFamily(major,minor),family,major+'.'+minor);
 const message=(text,family)=>ctokContentTokens(text,family)+ctokMessageOverhead(family);
 // Expected counts are ctok's own (Python) for the frame-sensitive strings.
 for(const row of frames.frames) for(const family of ['v3','v4.7','v4.8']) assert.equal(message(row.text,family),row[family],family+' '+JSON.stringify(row.text));
 // Recorded count_tokens responses, which ctok reproduces exactly: MultiPL-E (held out) and the held-out Rosetta Code sample.
 // Opus 4.8 has no recording; v4.8 is held to ctok's own counts for the same documents.
 for(const [name,key,size] of [['multipl_e','lang',22],['rosetta_holdout','id',250]]) {
  const counts=JSON.parse(readFileSync(fixture(name+'_counts.json'),'utf8')),rows=corpus(name);
  assert.equal(rows.length,size,name);
  for(const [family,expected,model] of [['v3',counts.v3,'claude-opus-4-5'],['v4.7',counts['v4.7'],'claude-opus-4-7'],['v4.8',{model:'ctok',counts:frames['v4.8_corpus'][name]},'ctok']]) {
   assert.equal(expected.model,model,name+' '+family);
   assert.deepEqual(Object.keys(expected.counts).sort(),rows.map(row=>row[key]).sort(),name+' '+family+' documents');
   for(const row of rows) assert.equal(message(row.text,family),expected.counts[row[key]],name+' '+family+' '+row[key]);
  }
 }
 // Long inputs: the MultiPL-E documents joined, and long runs of newlines and of combining marks, which
 // tool output or a skill body can carry and countText counts with every family. Done naively, each run
 // alone takes tens of seconds; the bound is far above the linear cost to keep slow machines passing.
 const joined=corpus('multipl_e').map(row=>row.text).join('\n');
 for(const family of ['v3','v4.7','v4.8']) assert.equal(message(joined,family),frames.multipl_e_joined[family],'joined '+family);
 const started=performance.now();
 for(const g of frames.generated) for(const family of ['v3','v4.7','v4.8']) assert.equal(message(g.prefix+g.unit.repeat(g.repeat)+g.suffix,family),g[family],family+' '+JSON.stringify(g.unit)+' x'+g.repeat);
 assert.ok(performance.now()-started<20000,'long runs are counted without quadratic work');
 console.log('ctok vocabulary, routing, frame and recorded count_tokens assertions passed');
}
