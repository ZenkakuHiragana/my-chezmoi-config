import assert from 'node:assert/strict';
import { harness, system, user, assistant, tool, api } from './support.mjs';

// Independent oracle for these ASCII-only, text-only fixtures. Pi estimates each
// message separately as ceil(chars/4); assistant tool calls are a separate part.
const tokens = text => Math.ceil(text.length / 4);
const custom = (text, timestamp=7) => ({role:'custom', customType:'injection', content:text, display:false, timestamp});
const result = text => ({role:'toolResult', toolCallId:'call-1', toolName:'lookup', content:[{type:'text',text}], isError:false, timestamp:8});
const call = (name, args) => assistant('', {content:[{type:'toolCall',id:'call-1',name,arguments:args}]});
function expected(messages, prompt='BASE', tools=[]) {
  const totals = {SYSTEM:tokens(prompt), TOOLS:tools.reduce((n,t)=>n+tokens(`${t.name}: ${t.description}\n${JSON.stringify(t.parameters)}`),0)};
  const add=(key,n)=>{totals[key]=(totals[key]||0)+n;};
  for (const m of messages) {
    if (m.role==='system') continue;
    if (m.role==='assistant') {
      add('ASSISTANT',tokens(m.content.filter(b=>b.type==='text').map(b=>b.text).join('')));
      for (const b of m.content.filter(b=>b.type==='toolCall')) add('TOOL CALLS',tokens(b.name+JSON.stringify(b.arguments)));
    } else {
      const text=typeof m.content==='string'?m.content:m.content.map(b=>b.text).join('');
      add(m.role==='user'?'USER':m.role==='toolResult'?'TOOL RESULTS':'OTHER',tokens(text));
    }
  }
  return Object.fromEntries(Object.entries(totals).filter(([,n])=>n>0).sort(([a],[b])=>a.localeCompare(b)));
}
function check(h, messages, {prompt='BASE', tools=[], origin='observed', thinking=0}={}) {
  const d=h.context.contextData(h.state);
  const want=expected(messages,prompt,tools);
  if (thinking) want.THINKING=thinking;
  assert.deepEqual(Object.fromEntries(d.contextParts.map(p=>[p.label,p.tokens]).sort(([a],[b])=>a.localeCompare(b))),
    Object.fromEntries(Object.entries(want).sort(([a],[b])=>a.localeCompare(b))));
  assert.equal(d.prompt,prompt); assert.deepEqual(d.tools,tools); assert.equal(d.origin,origin);
  const invPrompt=h.inventory.prompt(h.state);
  assert.equal(invPrompt.text,prompt); assert.equal(invPrompt.tokens,tokens(prompt)); assert.equal(invPrompt.origin,origin);
  const declared=h.inventory.tools(h.state).filter(t=>t.active);
  assert.deepEqual(declared.map(t=>t.name).sort(),tools.map(t=>t.name).sort());
  for (const t of tools) {
    const row=declared.find(x=>x.name===t.name);
    assert.equal(row.tokens,tokens(`${t.name}: ${t.description}\n${JSON.stringify(t.parameters)}`));
    assert.equal(row.description,t.description); assert.equal(row.origin,origin);
  }
}

export default async function () {
  // Exact replacement/deletion/addition, followed by a new assistant turn. The
  // removed old answer contributes zero, rather than merely asserting > 0.
  const def=tool('lookup','look things up');
  const initial=[system('BASE',[def]),user('old'),assistant('old answer')];
  const h=await harness({messages:initial,allTools:[def]});
  const request=[initial[0],user('replacement'),custom('extra'),result('tool result')];
  await h.capture(request);
  check(h,request,{tools:[def]});
  const reply=assistant('new answer'); h.append(reply); await h.emit('turn_end');
  check(h,[...request,reply],{tools:[def]});

  // Bounded deterministic matrix: multiple sizes around char/4 boundaries,
  // each role is independently replaced, removed, or added around anchors.
  for (const size of [1,4,5,8,13]) {
    const x='x'.repeat(size), y='y'.repeat(size+4);
    const variants=[
      [user(x),user(y)], [assistant(x),assistant(y)], [result(x),result(y)], [custom(x),custom(y)],
      [call('lookup',{q:x}),call('lookup',{q:y})],
    ];
    for (const [oldMessage,newMessage] of variants) {
      for (const operation of ['replace','delete','add']) {
        const before=[system(),user('anchor-A'),oldMessage,assistant('anchor-B')];
        const after=operation==='replace'?[before[0],before[1],newMessage,before[3]]:
          operation==='delete'?[before[0],before[1],before[3]]:[...before,newMessage];
        const fixture=await harness({messages:before}); await fixture.capture(after);
        check(fixture,after);
        const tail=user('tail'); fixture.append(tail); await fixture.emit('turn_end');
        check(fixture,[...after,tail]);
      }
    }
  }

  // Reordered messages and equal payload+timestamp on distinct session IDs.
  // A later real Pi context_edit on the untouched duplicate distinguishes it
  // from the duplicate replaced by the capture; no snapshot layout is assumed.
  const session=api.SessionManager.inMemory();
  session.appendMessage(system());
  const duplicate=user('same payload',12);
  const first=session.appendMessage(duplicate);
  session.appendMessage(assistant('middle'));
  const second=session.appendMessage(structuredClone(duplicate));
  session.appendMessage(custom('anchor'));
  const actual=await harness(); actual.ctx.sessionManager=session;
  const base=session.buildSessionProjection().messages;
  await actual.capture([base[0],user('changed first',12),...base.slice(2)]);
  check(actual,[base[0],user('changed first',12),...base.slice(2)]);
  session.appendContextEdit(second,{content:'later independent edit'}); await actual.emit('turn_end');
  check(actual,[base[0],user('changed first',12),base[2],user('later independent edit',12),base[4]]);
  assert.notEqual(first,second);

  // With equal payloads, delete the first occurrence (anchors disambiguate),
  // then edit the surviving second one through Pi's real context projection.
  const deletion=api.SessionManager.inMemory();
  deletion.appendMessage(system());
  deletion.appendMessage(user('same payload',12));
  deletion.appendMessage(assistant('middle'));
  const survivor=deletion.appendMessage(user('same payload',12));
  deletion.appendMessage(custom('anchor'));
  const dh=await harness(); dh.ctx.sessionManager=deletion;
  const db=deletion.buildSessionProjection().messages;
  await dh.capture([db[0],...db.slice(2)]);
  check(dh,[db[0],...db.slice(2)]);
  deletion.appendContextEdit(survivor,{content:'survivor edited'}); await dh.emit('turn_end');
  check(dh,[db[0],db[2],user('survivor edited',12),db[4]]);

  // Request-only additions belong to the captured branch, not its sibling.
  const branches=api.SessionManager.inMemory();
  const root=branches.appendMessage(system());
  branches.appendMessage(user('branch A'));
  const bh=await harness(); bh.ctx.sessionManager=branches;
  const branchA=branches.buildSessionProjection().messages;
  const injection=custom('only branch A');
  await bh.capture([...branchA,injection]); check(bh,[...branchA,injection]);
  const leafA=branches.getLeafId();
  branches.branch(root); branches.appendMessage(user('branch B')); await bh.emit('session_tree');
  check(bh,[system(),user('branch B')],{origin:'recorded'});
  branches.branch(leafA); await bh.emit('session_tree'); check(bh,[...branchA,injection]);

  const reorder=await harness({messages:[system(),user('1111',3),assistant('22222222'),user('333333333333',3)]});
  const b=reorder.entries.map(e=>e.message);
  const reordered=[b[0],b[3],b[2],b[1]];
  await reorder.capture(reordered); check(reorder,reordered);
  reorder.append(custom('after reorder')); await reorder.emit('turn_end'); check(reorder,[...reordered,custom('after reorder')]);

  // Thinking is re-evaluated against the selected model, not frozen at capture.
  const thought=assistant('',{content:[{type:'thinking',thinking:'12345678'}],usage:{reasoning:9}});
  const models=await harness({messages:[system(),user('hello'),thought]});
  await models.capture(); check(models,[system(),user('hello')],{thinking:9});
  models.ctx.model={provider:'p',api:'a',id:'m2',contextWindow:1000}; await models.emit('model_select');
  check(models,[system(),user('hello')]);
  models.ctx.model={provider:'p',api:'a',id:'m',contextWindow:1000}; await models.emit('model_select');
  check(models,[system(),user('hello')],{thinking:9});
  // These thoughts are request-only additions/replacements, not unchanged history.
  // Exercise eligibility after storage on every model identity axis.
  for (const operation of ['added','modified']) {
    const oldThought=assistant('',{content:[{type:'thinking',thinking:'a'}],usage:{reasoning:0}});
    const captured=await harness({messages:[system(),user('hello'),...(operation==='modified'?[oldThought]:[])]});
    await captured.capture([system(),user('hello'),thought]);
    check(captured,[system(),user('hello')],{thinking:9});
    for (const mismatch of [{provider:'p',api:'a',id:'m2'},{provider:'other',api:'a',id:'m'},{provider:'p',api:'other',id:'m'}]) {
      captured.ctx.model={...mismatch,contextWindow:1000};await captured.emit('model_select');
      check(captured,[system(),user('hello')]);
      captured.ctx.model={provider:'p',api:'a',id:'m',contextWindow:1000};await captured.emit('model_select');
      check(captured,[system(),user('hello')],{thinking:9});
    }
  }
  const initiallyExcluded=await harness({messages:[system(),user('hello')]});
  initiallyExcluded.ctx.model={provider:'p',api:'a',id:'m2',contextWindow:1000};
  await initiallyExcluded.capture([...initiallyExcluded.entries.map(e=>e.message),thought]);
  check(initiallyExcluded,[system(),user('hello')]);
  initiallyExcluded.ctx.model={provider:'p',api:'a',id:'m',contextWindow:1000};await initiallyExcluded.emit('model_select');
  check(initiallyExcluded,[system(),user('hello')],{thinking:9});
  initiallyExcluded.ctx.model={provider:'p',api:'a',id:'m2',contextWindow:1000};await initiallyExcluded.emit('model_select');
  check(initiallyExcluded,[system(),user('hello')]);
  // A virtual model with no successful recorded response has unknown identity;
  // a request-only thought is still counted under that unknown identity.
  const virtual=await harness({messages:[system(),user('hello')]});
  virtual.ctx.model={provider:'v',api:'pi-virtual',id:'route',contextWindow:1000};
  await virtual.capture([...virtual.entries.map(e=>e.message),thought]);
  check(virtual,[system(),user('hello')],{thinking:9});
  virtual.ctx.model=undefined; await virtual.emit('model_select');
  check(virtual,[system(),user('hello')],{thinking:9});
  // Routing uses the most recent successful recorded physical model, ignoring
  // a newer failed response; the request-only M1 thought then does not count.
  const routed=await harness({messages:[system(),user('hello'),
    assistant('physical response',{model:'m2'}), assistant('',{model:'m',stopReason:'error'})]});
  routed.ctx.model={provider:'v',api:'pi-virtual',id:'route',contextWindow:1000};
  const routedBase=routed.entries.map(e=>e.message);
  await routed.capture([...routedBase,thought]);
  check(routed,routedBase);
  console.log('behavior assertions passed (75 matrix fixtures plus integration cases)');
}
