import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { harness, load, renderLayoutFrame, plain } from './support.mjs';

export default async function skillPreview() {
  const temp = join(tmpdir(), 'pi');
  await mkdir(temp, {recursive:true});
  const dir = await mkdtemp(join(temp, 'crt-preview-'));
  try {
    const fixtures = [
      {name:'valid', description:'説明は一度だけ', raw:'\ufeff---\r\nname: valid\r\ndescription: 説明は一度だけ\r\n---\r\n\r\n日本語の本文\r\n', body:'日本語の本文'},
      {name:'invalid', description:'broken yaml', raw:'---\nname: [broken\n---\ncontent survives\n', body:'---\nname: [broken\n---\ncontent survives\n'},
      {name:'plain', description:'plain text', raw:'no header\nkeep\ttabs\n', body:'no header\nkeep    tabs\n'},
      {name:'long', description:'long text', raw:'long body\n' + 'x'.repeat(256*1024), cut:true},
    ];
    fixtures.push(...[{"name": "bad-close", "description": "keep malformed framing", "raw": "---\nname: example\n---suffix\nvisible\n", "body": "---\nname: example\n---suffix\nvisible\n"}, {"name": "bad-open", "description": "keep malformed framing", "raw": "---suffix\nname: example\n---\nvisible\n", "body": "---suffix\nname: example\n---\nvisible\n"}, {"name": "no-close", "description": "keep malformed framing", "raw": "---\nname: example\ncontent: retained\n", "body": "---\nname: example\ncontent: retained\n"}, {"name": "early-prefix", "description": "keep malformed framing", "raw": "---\nname: example\n---suffix\nretained\n---\nvisible\n", "body": "---\nname: example\n---suffix\nretained\n---\nvisible\n"}]);
    for (const f of fixtures) { f.filePath=join(dir,f.name+'.md'); await writeFile(f.filePath,f.raw,'utf8'); }
    const h=await harness({skills:fixtures});
    const deadline=Date.now()+10000;
    while (h.inventory.skills(h.state).items.some(i=>i.body===undefined && i.bodyError===undefined)) {
      assert.ok(Date.now()<deadline,'timed out reading bodies'); await delay(10);
    }
    const {countText}=await load('state/tokenizers.ts');
    await load('panels/inv.ts');
    const {PANELS}=await load('panels/registry.ts');
    const panel=PANELS.get('skilltext')(h.panelEnv);
    const frame=()=>renderLayoutFrame(panel.component,100,25,()=>{}).lines.map(plain).join('\n');
    for (const f of fixtures) {
      const item=h.inventory.skills(h.state).items.find(i=>i.name===f.name);
      assert.equal(item.bodyError,undefined);
      if (f.body!==undefined) assert.equal(item.body,f.body);
      assert.equal(!!item.bodyCut,!!f.cut);
      h.inventory.pickSkill(h.state,f.name);
      panel.scroll.scrollToStart();
      const text=frame();
      if (f.name==='valid') {
        assert.equal(text.split(f.description).length-1,1);
        assert.ok(text.includes('日本語の本文'));
        assert.doesNotMatch(text,/name: valid|description:|---/);
      }
      if (f.name==='invalid') { assert.match(text,/name: \[broken/); assert.match(text,/content survives/); }
      if (f.name==='plain') { assert.match(text,/no header/); assert.match(text,/keep    tabs/); }
      if (f.name==='long') { panel.scroll.scrollToEnd(); assert.match(frame(),/the file is longer; the rest is not shown/); }
    }
    await rm(dir,{recursive:true,force:true});
    for (const id of ['gpt-4o','other','claude-opus-5-5','gpt-4o']) {
      h.ctx.model.id=id; await h.emit('model_select');
      for (const f of fixtures) {
        const original=Buffer.from(f.raw).subarray(0,256*1024).toString('utf8');
        const expected=countText(original)[id==='other'?'chars4':id==='gpt-4o'?'o200k_base':'ctok_v4.8'];
        const item=h.inventory.skills(h.state).items.find(i=>i.name===f.name);
        assert.equal(item.bodyTokens,expected,`${f.name} raw LOAD ${id}`);
      }
    }
    console.log('skill preview, fallback, raw LOAD and warning assertions passed');
  } finally { await rm(dir,{recursive:true,force:true}); }
}
