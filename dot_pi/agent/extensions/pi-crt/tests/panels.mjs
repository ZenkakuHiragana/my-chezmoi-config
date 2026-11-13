import assert from 'node:assert/strict';
import { harness, load, tui, theme, renderLayoutFrame, plain, system, user, tool, api } from './support.mjs';

export default async function panels() {
  await load('panels/inv.ts');
  await load('panels/status.ts');
  const { PANELS } = await load('panels/registry.ts');
  const { alignedRow, compactNumber } = await load('panels/common.ts');
  for (let width = 1; width <= 20; width++) {
    const line = alignedRow(theme.fg('accent', '長い名前') + ' first' + String.fromCharCode(10) + 'second', '≈12345', width);
    assert.ok(tui.visibleWidth(line) <= width);
    if (width >= 6) assert.ok(plain(line).endsWith('≈12345'));
  }
  const description = theme.fg('accent', '長い説明 ') + 'words '.repeat(30) + '\nsecond\tline';
  const tools = Array.from({length: 12}, (_, i) => tool(`tool${i}`, description));
  const skills = Array.from({length: 12}, (_, i) => ({name: `skill-${i}-${'長い名前'.repeat(12)}`, description, filePath: `nonexistent-${i}`}));
  const tag = 'very_long_prompt_section_label_'.repeat(4).replace(/_$/, '');
  const prompt = `<${tag}>\n${'content '.repeat(20)}\n</${tag}>`;
  const h = await harness({messages: [system(prompt, tools), user('hello')], allTools: tools, skills});
  const make = id => {
    const factory = PANELS.get(id);
    assert.ok(factory, `registered ${id}`);
    return factory(h.panelEnv);
  };
  // Each target panel gets exactly width columns in both compositions.
  function frame(panel, width, split, height = 8) {
    const component = split ? new tui.HStack([
      {component: panel.component, basis: width, grow: 0, shrink: 0, minSize: 0},
      {component: {render: w => ['N'.repeat(w)], invalidate() {}}, basis: 8, grow: 0, shrink: 0, minSize: 0},
    ]) : panel.component;
    const total = width + (split ? 8 : 0);
    const result = renderLayoutFrame(component, total, height, () => {});
    for (const line of result.lines) assert.ok(tui.visibleWidth(line) <= total, `frame overflow ${width}/${split}: ${JSON.stringify(plain(line))}`);
    return result.lines.map(plain);
  }
  const expected = {
    toollist: () => `≈${compactNumber(h.inventory.tools(h.state)[0].tokens)}`,
    promptparts: () => `≈${compactNumber(h.inventory.prompt(h.state).parts[0].tokens)}`,
    skilllist: () => {
      const item = h.inventory.skills(h.state).items[0];
      const req = item.listed === undefined ? '?' : item.listed ? `≈${compactNumber(item.tokens)}` : item.invocable === false ? 'user' : '0';
      const load = item.bodyTokens !== undefined ? `≈${compactNumber(item.bodyTokens)}` : item.bodyError ? '?' : '…';
      return [req, load];
    },
  };
  for (const id of Object.keys(expected)) {
    for (const split of [false, true]) {
      for (const width of [16, 30, 60, 100]) {
        const panel = make(id);
        panel.scroll.markScrollbarActivity();
        const lines = frame(panel, width, split);
        const index = 1 + panel.list.offsets[id === 'promptparts' ? 1 : 0]; // title + content offset
        const line = lines[index];
        const values = [expected[id]()].flat();
        for (const value of values) assert.ok(line.includes(value), `${id} ${width}/${split} loses ${value}: ${JSON.stringify(line)}`);
        assert.match(line, /[┃│]/, `${id} should have a visible scrollbar`);
        const selection = panel.list;
        const selectedIndex = id === 'promptparts' ? 1 : 0;
        const offset = selection.offsets[selectedIndex];
        assert.equal(selection.heights[selectedIndex], 1);
        assert.equal(selection.itemAtLine(offset), selectedIndex);
        selection.pick(selectedIndex); selection.activate();
        if (id === 'toollist') assert.equal(h.inventory.picks(h.state).tool, tools[0].name);
        if (id === 'skilllist') assert.equal(h.inventory.picks(h.state).skill, skills[0].name);
        if (id === 'promptparts') assert.equal(h.inventory.picks(h.state).part, h.inventory.prompt(h.state).parts[0].label);
      }
      for (let width = 1; width <= 15; width++) frame(make(id), width, split);
    }
  }

  // A part's window share is 100/1000, not 100/200. Mutate only this cached
  // reading so the actual registered status renderer sees a controlled fixture.
  const meter = await harness({messages: [system(), user('x')]});
  meter.reported = {tokens: null, contextWindow: 1000, percent: null};
  await meter.emit('turn_end');
  const data = meter.context.contextData(meter.state);
  data.contextParts = [{label: 'SYSTEM', tokens: 100}, {label: 'TOOL RESULTS', tokens: 100}];
  data.version++;
  for (const split of [false, true]) {
    for (const width of [16, 30, 60, 100]) {
      const panel = PANELS.get('context')(meter.panelEnv);
      panel.scroll.markScrollbarActivity();
      const lines = frame(panel, width, split, 10);
      const text = lines.join('\n');
      assert.match(text, /≈200/, 'null report is a marked estimate');
      assert.match(text, /100 10%/, 'part share is of the window');
      assert.doesNotMatch(text, /100 50%/, 'part share is not of the sum');
      assert.match(text, /[┃│]/, 'context scrollbar is visible');
      assert.match(text, /ESTIMATE/, 'estimated meaning survives narrow layout');
      assert.match(text, /Window %/, 'percentage denominator label survives narrow layout');
      assert.match(text, width >= 40 ? /SYSTEM.*recorded/ : /SYS · log/, 'system source survives narrow layout');
      if (width >= 60) {
        assert.match(text, /CURRENT\/NEXT · ESTIMATE/);
        assert.match(text, /Window %/);
      }
    }
    for (let width = 1; width <= 15; width++) frame(PANELS.get('context')(meter.panelEnv), width, split, 10);
  }
  meter.reported = {tokens: 123, contextWindow: 1000, percent: 12.3};
  await meter.emit('turn_end');
  let lines = frame(PANELS.get('context')(meter.panelEnv), 60, false, 10).join('\n');
  assert.match(lines, /PI ESTIMATE/);
  assert.match(lines, /123\/1.0k 12%/);
  // The actual Pi API can return a pure chars/4 estimate without any assistant usage.
  const msgs=[system('s'.repeat(400)),user('x'.repeat(400))];
  const entries=msgs.map((message,i)=>({id:'s'+i,type:'message',message}));
  const actual=api.AgentSession.prototype.getContextUsage.call({_limitsModel:()=>({contextWindow:1000}),sessionManager:{buildSessionProjection:()=>({messages:msgs,entries:entries.map(sourceEntry=>({sourceEntry,messages:[sourceEntry.message]}))}),getBranch:()=>entries}});
  assert.equal(actual.tokens,200);
  meter.reported=actual;await meter.emit('turn_end');
  lines=frame(PANELS.get('context')(meter.panelEnv),16,false,12).join(String.fromCharCode(10));
  assert.match(lines,/PI ESTIMATE/);assert.doesNotMatch(lines,/REPORTED/);
  meter.ctx.model={provider:'router',api:'pi-virtual',id:'route',contextWindow:0};
  meter.reported=undefined;await meter.emit('model_select');
  lines=frame(PANELS.get('context')(meter.panelEnv),30,false,12).join(String.fromCharCode(10));
  assert.match(lines,/USAGE UNKNOWN/);assert.doesNotMatch(lines,/no model/);
  meter.ctx.model = undefined;
  meter.reported = undefined;
  await meter.emit('model_select');
  lines = frame(PANELS.get('context')(meter.panelEnv), 60, false, 10).join('\n');
  assert.match(lines, /USAGE UNKNOWN/);

  const shortTool = tool('short', 'short description');
  const control = await harness({messages: [system('BASE', [shortTool])], allTools: [shortTool]});
  const controlPanel = PANELS.get('toollist')(control.panelEnv);
  const controlText = frame(controlPanel, 30, true).join('\n');
  assert.ok(controlText.includes(`≈${compactNumber(control.inventory.tools(control.state)[0].tokens)}`), 'short-description control');
  const cached = await harness({messages: [system('BASE', [shortTool]), user('hello')], allTools: [shortTool]});
  const cachedPrompt = PANELS.get('prompttext')(cached.panelEnv);
  const cachedTools = PANELS.get('toollist')(cached.panelEnv);
  assert.match(frame(cachedPrompt, 60, false).join(' '), /BASE/);
  frame(cachedTools, 60, false);
  cached.fallback = 'MODEL PROMPT';
  const changed = structuredClone(cached.entries.map(e => e.message));
  changed[0].toolsAdded[0].description = 'changed schema description';
  await cached.capture(changed);
  assert.match(frame(cachedPrompt, 60, false).join(' '), /MODEL PROMPT/);
  assert.match(frame(cachedTools, 60, false).join(' '), /changed schema description/);

  // The source label belongs to SYSTEM, not all current conversation categories.
  const mixed = await harness();
  const modified = structuredClone(mixed.entries.map(e => e.message));
  modified[1].content = 'x'.repeat(400);
  await mixed.capture(modified);
  mixed.append(system('NEXT'));
  await mixed.emit('turn_end');
  assert.equal(mixed.context.contextData(mixed.state).contextParts.find(p => p.label === 'USER').tokens, 100);
  const mixedText=frame(PANELS.get('context')(mixed.panelEnv),30,false,12).join(' ');
  assert.match(mixedText,/SYS · log/);
  const onlySystem = await harness();
  await onlySystem.capture([...onlySystem.entries.map(e => e.message), user('x'.repeat(400),9)]);
  await onlySystem.emit('session_shutdown');
  const restored = await harness();
  restored.sessionId=onlySystem.sessionId;await restored.emit('session_start');
  assert.equal(restored.context.contextData(restored.state).contextParts.find(p => p.label === 'USER').tokens, 2);
  const restoredText=frame(PANELS.get('context')(restored.panelEnv),30,false,12).join(' ');
  assert.match(restoredText,/SYS · hook/);

}
