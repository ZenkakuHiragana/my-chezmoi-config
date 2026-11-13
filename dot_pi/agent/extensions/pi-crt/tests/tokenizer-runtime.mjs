import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {jiti,load,harness,system,user} from './support.mjs';

async function worker() {
 const lib=await jiti.import('gpt-tokenizer/encoding/o200k_base'),shared=lib.default??lib;
 shared.setMergeCacheSize(7);
 shared.countTokens('OTHEREXTENSIONqwertyPROBEexample');
 const sharedCore=shared.bytePairEncodingCoreProcessor,sharedSize=sharedCore.mergeCache.size,sharedEntries=structuredClone([...sharedCore.mergeCache]);
 const {GptEncoding}=await jiti.import('gpt-tokenizer/GptEncoding');
 const create=GptEncoding.getEncodingApi;const owned=[];let nativeCalls=0;
 GptEncoding.getEncodingApi=function(...args){const instance=create.apply(this,args);owned.push(instance);const count=instance.countTokens;instance.countTokens=(...args)=>{nativeCalls++;return count(...args);};return instance;};
 const counters=await load('state/tokenizers.ts');
 assert.equal(owned.length,1,'pi-crt owns an encoder instead of changing the shared default');
 assert.notEqual(owned[0],shared);const core=owned[0].bytePairEncodingCoreProcessor,dictSize=core.bytePairStringRankEncoder.size;
 assert.equal(core.mergeCacheSize,0);assert.equal(core.mergeCache,undefined);
 const secret='SECRETEXAMPLEqwertyFOOxyzabc';
 counters.countText(secret);const afterFirst=nativeCalls;
 counters.countText(secret);assert.equal(nativeCalls,afterFirst,'same input reuses a numeric result');
 counters.countText(secret.replace('q','z'));assert.equal(nativeCalls,afterFirst+1,'same-length input changes recompute');
 assert.equal(core.mergeCache,undefined);assert.equal(core.bytePairStringRankEncoder.size,dictSize,'no user strings added to the vocabulary/cache map');
 assert.equal(sharedCore.mergeCacheSize,7);assert.equal(sharedCore.mergeCache.size,sharedSize,'another extension encoder remains untouched');assert.deepEqual([...sharedCore.mergeCache],sharedEntries);
 const counter=counters.counterForModel({provider:'p',api:'a',id:'gpt-test'}),first='CACHEBOUND_FIRST_uniquevalue';
 counter.count(first);for(let i=0;i<1025;i++)counter.count('CACHEBOUND_uniquevalue_'+i);
 const beforeEvicted=nativeCalls;counter.count(first);assert.equal(nativeCalls,beforeEvicted+1,'bounded memo evicts old entries');
 const body="const result = JSON.stringify({name: 'value', count: 123});\n".repeat(710);
 const h=await harness({messages:[system(),...Array.from({length:80},(_,i)=>user(body+i))]});
 h.ctx.model={provider:'p',api:'a',id:'claude-test',contextWindow:1000000};
 const beforeFallback=nativeCalls;
 for(let i=0;i<3;i++){await h.emit('turn_end');h.context.contextData(h.state);}
 assert.equal(nativeCalls,beforeFallback,'canonical fallback history never calls the GPT tokenizer');
 h.ctx.model.id='gpt-test';await h.emit('model_select');h.context.contextData(h.state);const afterCold=nativeCalls;assert.ok(afterCold>beforeFallback);
 for(let i=0;i<3;i++){await h.emit('turn_end');h.context.contextData(h.state);}
 assert.equal(nativeCalls,afterCold,'invalidating the view does not re-tokenize unchanged GPT input');
 h.entries[1].message.content=body+'x';await h.emit('turn_end');h.context.contextData(h.state);assert.equal(nativeCalls,afterCold+1);
 await h.emit('session_shutdown');
 assert.equal(core.mergeCache,undefined);assert.equal(core.bytePairStringRankEncoder.size,dictSize);
 console.log('private cache, numeric memo, fallback cost and warm invalidation assertions passed');
}
if(process.argv.includes('--worker')) await worker();
export default async function () {
 const result=execFileSync(process.execPath,[fileURLToPath(import.meta.url),'--worker'],{encoding:'utf8',env:process.env});
 process.stdout.write(result);
}
