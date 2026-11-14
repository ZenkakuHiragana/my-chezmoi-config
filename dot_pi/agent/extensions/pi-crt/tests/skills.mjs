import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { harness, load, tui, renderLayoutFrame, plain, system, user } from './support.mjs';

export default async function skills() {
  const temp = join(tmpdir(), 'pi');
  await mkdir(temp, {recursive:true});
  const dir = await mkdtemp(join(temp, 'crt-skills-'));
  try {
    const filePath = join(dir, 'SKILL.md');
    const body = '---\nname: example\ndescription: A real skill\n---\n\nRead this UTF-8 text: café.\n';
    await writeFile(filePath, body, 'utf8');
    const name = 'example-1234567890-' + 'long-name-'.repeat(8);
    const skillSet = [
      {name, description:'A real skill', filePath},
      {name:'unlisted', description:'not in prompt', filePath},
      {name:'user-only', description:'disabled', filePath, disableModelInvocation:true},
      ...Array.from({length:8}, (_, i) => ({name:`other-${i}`, description:'other', filePath})),
    ];
    const block = `  <skill>\n    <name>${name}</name>\n    <description>A real skill</description>\n    <location>${filePath}</location>\n  </skill>`;
    const section = `<skills>\n${block}\n</skills>`;
    const prompt = `Instructions for the assistant.\n\n${section}`;
    // Pi's estimate for text is ceil(UTF-16 code units / 4), not bytes.
    const estimate = text => Math.ceil(text.length / 4);
    const listCount = estimate(block), loadCount = estimate(body);
    assert.ok(listCount > 0 && loadCount > 0);
    const h = await harness({messages:[system(prompt), user('hello')], skills:skillSet});
    await h.emit('before_agent_start', {systemPromptOptions:{skills:skillSet}});
    await h.emit('agent_start');
    const deadline = Date.now() + 5000;
    while (h.inventory.skills(h.state).items.some(item => item.body === undefined && item.bodyError === undefined)) {
      assert.ok(Date.now() < deadline, 'timed out waiting for skill file reads');
      await delay(10);
    }
    let items = h.inventory.skills(h.state).items;
    assert.ok(items.every(item => item.body === 'Read this UTF-8 text: café.' && item.bodyTokens === loadCount && !item.bodyError));
    assert.equal(items[0].listed, true);
    assert.equal(items[0].tokens, listCount);
    assert.equal(items[1].listed, false);
    assert.equal(items[1].tokens, 0);
    assert.equal(items[2].invocable, false);
    assert.equal(items[2].listed, false);
    const measured = h.inventory.prompt(h.state);
    assert.equal(measured.tokens, estimate(prompt));
    assert.ok(measured.parts.every(part => part.tokens > 0));
    assert.equal(measured.parts.reduce((sum, part) => sum + part.tokens, measured.rest), measured.tokens);

    await load('panels/inv.ts');
    const { PANELS } = await load('panels/registry.ts');
    const make = () => PANELS.get('skilllist')(h.panelEnv);
    function frame(panel, width, split) {
      const component = split ? new tui.HStack([
        {component:panel.component, basis:width, grow:0, shrink:0, minSize:0},
        {component:{render:w => ['N'.repeat(w)], invalidate() {}}, basis:8, grow:0, shrink:0, minSize:0},
      ]) : panel.component;
      return renderLayoutFrame(component, width + (split ? 8 : 0), 8, () => {}).lines.map(plain);
    }
    function right(line, width, expected) {
      // Scrollbar occupies the final panel column; compare the entire fixed right suffix.
      assert.ok(line.slice(0, width - 1).endsWith(expected), JSON.stringify(line));
    }
    for (const split of [false,true]) for (const width of [16,30,60,100]) {
      const panel = make();
      let lines = frame(panel,width,split);
      right(lines[1 + panel.list.offsets[0]], width, `≈${listCount}  ${(`≈${loadCount}`).padStart(4)}`);
      right(lines[1 + panel.list.offsets[1]], width, `0  ${(`≈${loadCount}`).padStart(4)}`);
      right(lines[1 + panel.list.offsets[2]], width, `user  ${(`≈${loadCount}`).padStart(4)}`);
      panel.scroll.scrollToEnd();
      lines = frame(panel,width,split);
      assert.ok(panel.scroll.scrollTop > 0, 'panel actually scrolled');
      right(lines[lines.length - 1], width, `0  ${(`≈${loadCount}`).padStart(4)}`);
    }
    // Reuse the same panel and request projection across prompt changes.
    const cached = make();
    right(frame(cached,30,false)[1 + cached.list.offsets[0]], 30, `≈${listCount}  ${(`≈${loadCount}`).padStart(4)}`);
    await h.capture([system('Instructions without skill list.'), user('hello')]);
    items = h.inventory.skills(h.state).items;
    assert.equal(items[0].listed, false);
    assert.equal(items[0].tokens, 0);
    right(frame(cached,30,false)[1 + cached.list.offsets[0]], 30, `0  ${(`≈${loadCount}`).padStart(4)}`);
    await h.capture([system(prompt), user('hello')]);
    assert.equal(h.inventory.skills(h.state).items[0].tokens, listCount);
    right(frame(cached,30,false)[1 + cached.list.offsets[0]], 30, `≈${listCount}  ${(`≈${loadCount}`).padStart(4)}`);
    console.log('skills list/load and layout assertions passed');
  } finally {
    await rm(dir, {recursive:true, force:true});
  }
}
