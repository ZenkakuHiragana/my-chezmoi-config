const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'chatgpt-local-backup-v0.4.0.user.js'), 'utf8');
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b));
const context = vm.createContext({console, TextEncoder, setProgress() {}, JSZip: {loadAsync: async f => f.zip}});
vm.runInContext(part('  function safeName(', '  function assetFrom(') +
  part('  function extFromMime(', '  function mdPath(') +
  part('  function folderName(', '  function backupManifest(') +
  part('  function projectIdFromConversationJson(', '  async function restoreCheckpointFromBackups(') +
  '\nglobalThis.api={folderName,uniqueName,ensureExt,inspectBackupFile};', context);
const {folderName, uniqueName, ensureExt, inspectBackupFile} = context.api;
const result = () => ({matched:new Set(), unknownProject:[], mismatched:[], manifestProjectMismatches:0, manifestOnly:0, invalid:0});
const entry = (name, data) => ({name, dir:false, async:async () => JSON.stringify(data)});
const zip = entries => ({name:'backup.zip', zip:{files:Object.fromEntries(entries.map(e => [e.name,e]))}});
const manifest = (ids, projectId) => ({schema:'chatgpt-local-backup/v1', conversationIds:ids, projectId});

test('long titles preserve distinct full UUIDs within limit', () => {
  for (const length of [98,109,200]) {
    const ids = ['aaaaaaaa-1111-1111-1111-123456789abc','bbbbbbbb-1111-1111-1111-123456789abc'];
    const names = ids.map(conversation_id => folderName({title:'x'.repeat(length), conversation_id}));
    assert.notEqual(names[0],names[1]);
    names.forEach((name,i) => { assert.ok(name.endsWith(ids[i])); assert.ok(name.length <= 110); });
  }
});
test('title trimming does not split an emoji surrogate pair', () => {
  const conversation_id = 'aaaaaaaa-1111-1111-1111-123456789abc';
  const name = folderName({title:'😀'.repeat(100), conversation_id});
  assert.ok(name.length <= 110);
  assert.ok(name.endsWith(conversation_id));
  assert.doesNotThrow(() => encodeURIComponent(name));
});
test('extension is resolved before uniqueness', () => {
  const used = new Set();
  const names = ['report','report.pdf'].map(n => uniqueName(ensureExt(n,{type:'application/pdf'},{}),used));
  assert.deepEqual(names,['report.pdf','report (2).pdf']);
});
test('manifest is metadata only; closest ancestor and explicit project win', async () => {
  const r=result();
  await inspectBackupFile(zip([
    entry('backup-manifest.json',manifest(['a','missing','b','c','d','e'],'p')),
    entry('sub/backup-manifest.json',manifest(['b','c'],null)),
    entry('other/backup-manifest.json',manifest(['d'],'p')),
    entry('a/conversation.json',{id:'a'}),
    entry('sub/b/conversation.json',{id:'b'}),
    entry('sub/c/conversation.json',{id:'c',gizmo_id:'foreign'}),
    entry('else/d/conversation.json',{id:'d'}),
    entry('e/conversation.json',{id:'e',gizmo_id:'foreign'}),
  ]),'p',r);
  assert.deepEqual([...r.matched],['a','d']);
  assert.deepEqual(r.unknownProject.map(x=>x.id),['b']);
  assert.deepEqual(r.mismatched.map(x=>x.id),['c','e']);
  assert.ok(!r.matched.has('missing'));
});
test('legacy ZIP and standalone manifest and conversation JSON', async () => {
  const r=result();
  await inspectBackupFile(zip([entry('old/conversation.json',{conversation_id:'old',gizmo_id:'p'}),entry('old2/conversation.json',{id:'unknown'})]),'p',r);
  await inspectBackupFile({name:'manifest.json',text:async()=>JSON.stringify(manifest(['ghost'],'p'))},'p',r);
  await inspectBackupFile({name:'conversation.json',text:async()=>JSON.stringify({id:'single',gizmo_id:'p'})},'p',r);
  assert.deepEqual([...r.matched],['old','single']);
  assert.equal(r.unknownProject[0].id,'unknown');
  assert.equal(r.manifestOnly,1);
});
test('standalone manifest restore displays zero without writing state', async () => {
  const alerts=[]; let writes=0;
  const c=vm.createContext({projectInfo:()=>({id:'p',name:'P'}), chooseBackupFiles:async()=>[{name:'manifest.json',text:async()=>JSON.stringify(manifest(['ghost'],'p'))}], resetProgress(){}, setProgress(){}, alert:s=>alerts.push(s), confirm(){throw Error('unexpected confirmation')}, addExportedIds(){writes++}, inspectBackupFile});
  vm.runInContext(part('  async function restoreCheckpointFromBackups(', '  async function markCurrentProjectAsAlreadyBackedUp(')+'\nglobalThis.restore=restoreCheckpointFromBackups;',c);
  await c.restore();
  assert.equal(writes,0); assert.match(alerts[0],/0件/); assert.match(alerts[0],/conversation\.json/);
});
test('putConversation retains both attachments and markdown paths', async () => {
  const files=new Map();
  const folder={folder(dir){return {file(name,blob){files.set(`${dir}/${name}`,blob)}}},file(name,data){files.set(name,data)}};
  const assets=[{key:'1',filename:'report',label:'report'}, {key:'2',filename:'report.pdf',label:'report.pdf'}];
  const c=vm.createContext({currentBranch:()=>[{message:{author:{role:'user'}}}],textOf:()=>'',collectAssets:()=>assets,downloadAsset:async a=>({type:'application/pdf',content:a.key}),uniqueName,ensureExt,mdLabel:s=>s,mdPath:s=>s,Date});
  vm.runInContext(part('  async function putConversation(', '  function folderName(')+'\nglobalThis.put=putConversation;',c);
  await c.put({title:'test',conversation_id:'id'},folder);
  assert.equal(files.get('files/report.pdf').content,'1');
  assert.equal(files.get('files/report (2).pdf').content,'2');
  assert.match(files.get('conversation.md'),/files\/report \(2\)\.pdf/);
});


test('folder names respect UTF-8 byte and UTF-16 limits without splitting characters', () => {
  const ids = ['aaaaaaaa-1111-1111-1111-123456789abc','bbbbbbbb-1111-1111-1111-123456789abc'];
  for (const title of ['日'.repeat(73), '😀'.repeat(100), '日😀'.repeat(80)]) {
    const names = ids.map(conversation_id => folderName({title, conversation_id}));
    assert.notEqual(names[0], names[1]);
    names.forEach((name, i) => {
      assert.ok(name.endsWith(ids[i]));
      assert.ok(name.length <= 110);
      assert.ok(Buffer.byteLength(name, 'utf8') <= 255);
      assert.doesNotThrow(() => encodeURIComponent(name));
    });
  }
});

test('long sanitized attachment retains inferred extension', () => {
  const filename = uniqueName(ensureExt('x'.repeat(110), {type:'application/pdf'}, {}), new Set());
  assert.equal(filename, 'x'.repeat(110) + '.pdf');
});

test('asset identity prefers IDs then URLs and preserves partial information', () => {
  const c = vm.createContext({});
  vm.runInContext(part('  function typeOf(', '  async function resolveDownload(') + '\nglobalThis.collect=collectAssets;', c);
  const collect = attachments => Array.from(c.collect({metadata:{attachments}}));
  const f = (file_id, name='report.pdf', extra={}) => ({file_id, name, ...extra});
  let assets = collect([f('file_aaaa'), f('file_bbbb'), f('file_aaaa')]);
  assert.deepEqual(assets.map(a => a.fileId), ['file_aaaa','file_bbbb']);
  assets = collect([f('file_aaaa','report.pdf',{url:'https://example/a'}), f('file_aaaa','report.pdf',{url:'https://example/b'})]);
  assert.equal(assets.length, 1);
  assets = collect([{type:'attachment',name:'x',url:'https://example/a'}, {type:'attachment',name:'x',url:'https://example/b'}]);
  assert.equal(assets.length, 2);
  assets = collect([{type:'attachment',name:'x',url:'https://example/a'}, {type:'attachment',name:'other',url:'https://example/a'}]);
  assert.equal(assets.length, 1);
  assets = collect([f('file_aaaa','x',{url:'https://example/a'}), f('file_bbbb','x',{url:'https://example/a'})]);
  assert.equal(assets.length, 2);
  assets = collect([f('file_aaaa'), {type:'attachment',name:'report.pdf',url:'https://example/b'}]);
  assert.equal(assets.length, 2);
  for (const attachments of [[{type:'attachment',name:'report.pdf'}, f('file_aaaa')], [f('file_aaaa'), {type:'attachment',name:'report.pdf'}]]) {
    assets = collect(attachments);
    assert.equal(assets.length, 1);
    assert.equal(assets[0].fileId, 'file_aaaa');
  }
});

test('typed aliases and promoted keys preserve attachment contents across messages', async () => {
  const downloaded = [];
  const ctx = vm.createContext({
    console, TextEncoder,
    currentBranch: conv => conv.messages.map(message => ({message})),
    textOf: () => '',
    downloadAsset: async asset => {
      downloaded.push(asset.fileId);
      return {type:'application/pdf',content:'CONTENT:'+asset.fileId};
    },
  });
  vm.runInContext(part('  function typeOf(', '  async function resolveDownload(') +
    part('  function extFromMime(', '  function folderName(') +
    '\nglobalThis.put=putConversation;',ctx);
  const message = attachments => ({author:{role:'user'},metadata:{attachments}});
  const run = async messages => {
    downloaded.length = 0;
    const files = new Map();
    const folder = {folder:dir=>({file:(name,blob)=>files.set(dir+'/'+name,blob.content)}),
                    file:(name,data)=>files.set(name,data)};
    await ctx.put({title:'test',conversation_id:'test',messages},folder);
    return files;
  };
  let files = await run([message([
    {file_id:'file_aaaa',name:'file_bbbb'},
    {file_id:'file_bbbb',name:'file_aaaa'},
  ])]);
  assert.deepEqual(downloaded,['file_aaaa','file_bbbb']);
  assert.equal(files.get('files/file_bbbb.pdf'),'CONTENT:file_aaaa');
  assert.equal(files.get('files/file_aaaa.pdf'),'CONTENT:file_bbbb');

  files = await run([
    message([{type:'attachment',name:'same.pdf'},{file_id:'file_aaaa',name:'same.pdf'}]),
    message([{type:'attachment',name:'same.pdf'},{file_id:'file_bbbb',name:'same.pdf'}]),
    message([{file_id:'file_aaaa',name:'different-name.pdf'}]),
  ]);
  assert.deepEqual(downloaded,['file_aaaa','file_bbbb']);
  assert.equal(files.get('files/same.pdf'),'CONTENT:file_aaaa');
  assert.equal(files.get('files/same (2).pdf'),'CONTENT:file_bbbb');
  assert.equal([...files.keys()].filter(k=>k.startsWith('files/')).length,2);

  files = await run([message([{file_id:'file_cccc',name:'x'.repeat(109)+'😀.pdf'}])]);
  assert.deepEqual(downloaded,['file_cccc']);
  assert.equal(files.get('files/'+'x'.repeat(109)+'.pdf'),'CONTENT:file_cccc');
  assert.ok(files.has('conversation.json'));
  assert.ok(!files.has('ASSET_ERRORS.txt'));
});

test('project and single export entries survive restore and independent ZIP reader', async () => {
  const {spawnSync} = require('node:child_process');
  const path = require('node:path');
  const projectId = 'g-p-' + 'a'.repeat(32);
  const ids = ['aaaaaaaa-1111-1111-1111-123456789abc','bbbbbbbb-1111-1111-1111-123456789abc'];
  const title = '日'.repeat(100);
  const conversations = Object.fromEntries(ids.map((id, i) => [id, {
    conversation_id:id, gizmo_id:projectId, title, current_node:'a',
    mapping:{u:{id:'u',parent:null,message:{id:`u-${i}`,author:{role:'user'},
      content:{parts:[`本文${i}`]}, metadata:{attachments:[
        {file_id:'file_aaaa',name:'report.pdf'},
        {file_id:'file_bbbb',name:'report.pdf'},
        {file_id:'file_aaaa',name:'report.pdf'},
      ]}}}, a:{id:'a',parent:'u',message:{id:`a-${i}`,author:{role:'assistant'},content:{parts:[`返答${i}`]}}}},
  }]));
  const saved = [], storage = new Map(), downloads = [];
  class FakeZip {
    constructor(entries = new Map(), prefix = '') { this.entries=entries; this.prefix=prefix; }
    folder(name) { return new FakeZip(this.entries, this.prefix + name + '/'); }
    file(name, data) { this.entries.set(this.prefix + name, typeof data === 'string' ? data : data.content); return this; }
    static async loadAsync(file) {
      return {files:Object.fromEntries([...file.entries].map(([name,data]) => [name,{name,dir:false,async:async()=>data}]))};
    }
  }
  const response = data => ({ok:true, json:async()=>data});
  const fakeFetch = async url => {
    if (url.startsWith('/api/auth/session')) return response({accessToken:'fake'});
    if (url.startsWith('/backend-api/gizmos/')) return response({items:ids.map(id=>({id,title}))});
    if (url.startsWith('/backend-api/conversation/')) return response(conversations[decodeURIComponent(url.split('/').pop())]);
    if (url.startsWith('/backend-api/files/')) {
      const id = url.split('/')[3];
      return response({download_url:`https://cdn.invalid/${id}`});
    }
    if (url.startsWith('https://cdn.invalid/')) {
      downloads.push(url);
      return {ok:true,blob:async()=>({type:'application/pdf',content:url.split('/').pop()})};
    }
    throw Error(`unexpected fetch ${url}`);
  };
  const ctx = vm.createContext({console, TextEncoder, URL, JSZip:FakeZip, fetch:fakeFetch, saved,
    location:{pathname:`/g/${projectId}-Project/c/${ids[0]}`,href:'https://chatgpt.com/',origin:'https://chatgpt.com'},
    document:{cookie:''}, setTimeout:fn=>{fn(); return 1},
    localStorage:{getItem:k=>storage.get(k) || null,setItem:(k,v)=>storage.set(k,v)},
    alert:s=>{throw Error(`unexpected alert ${s}`)},
  });
  const executable = source.replace(part('  async function saveZip(', '  // ---------------------------------------------------------------------------\n  // Export operations'),
    '  async function saveZip(zip, filename) { saved.push({zip, filename}); }\n\n')
    .replace(/  if \(document\.body\) \{[\s\S]*?\n  \}\n\}\)\(\);\s*$/, '  globalThis.exportsForTest = {exportProject, exportConversation, inspectBackupFile};\n})();');
  vm.runInContext(executable, ctx);
  await ctx.exportsForTest.exportProject();
  assert.equal(saved.length, 1);
  const project = saved[0].zip.entries;
  const manifestData = JSON.parse(project.get('backup-manifest.json'));
  assert.deepEqual(manifestData.conversationIds, ids);
  assert.equal(manifestData.scope, 'project');
  assert.equal(manifestData.projectId, projectId);
  assert.deepEqual(manifestData.failedConversationIds, []);
  const convPaths = [...project.keys()].filter(k=>k.endsWith('/conversation.json'));
  assert.equal(convPaths.length, 2);
  assert.equal(new Set(convPaths).size, 2);
  for (const id of ids) {
    const jsonPath = convPaths.find(k=>k.includes(id));
    assert.ok(jsonPath);
    const folder = jsonPath.slice(0, -'conversation.json'.length);
    const component = folder.slice('Project/'.length, -1);
    assert.ok(Buffer.byteLength(component, 'utf8') <= 255);
    assert.ok(component.length <= 110);
    assert.ok(component.endsWith(id));
    assert.equal(JSON.parse(project.get(jsonPath)).conversation_id, id);
    assert.equal(project.get(folder+'files/report.pdf'), 'file_aaaa');
    assert.equal(project.get(folder+'files/report (2).pdf'), 'file_bbbb');
    const md = project.get(folder+'conversation.md');
    assert.match(md, /本文[01]/);
    assert.match(md, /\]\(files\/report\.pdf\)/);
    assert.match(md, /\]\(files\/report%20\(2\)\.pdf\)/);
    assert.equal([...project.keys()].filter(k=>k.startsWith(folder+'files/')).length, 2);
    assert.ok(!project.has(folder+'ASSET_ERRORS.txt'));
  }
  assert.equal(downloads.length, 4);
  const restored = result();
  await ctx.exportsForTest.inspectBackupFile({name:'backup.zip',entries:project},projectId,restored);
  assert.deepEqual([...restored.matched].sort(), [...ids].sort());
  assert.equal(restored.invalid, 0);
  assert.deepEqual(JSON.parse(storage.values().next().value)[projectId].ids,ids);

  // Feed the actual fake-JSZip entries, without reconstructing the conversations,
  // to Python's standard ZIP writer and the independent production reader.
  const python = String.raw`
import json, os, pathlib, sys, tempfile, zipfile
sys.path.insert(0, sys.argv[1])
import chatgpt_export as reader
import import_chatgpt_meilisearch as importer
entries = json.load(sys.stdin)
root = pathlib.Path(os.environ['LOCALAPPDATA']) / 'Temp' / 'pi' if os.name == 'nt' else pathlib.Path('/tmp/pi')
root.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(dir=root) as work:
    archive = pathlib.Path(work) / 'export.zip'
    with zipfile.ZipFile(archive, 'w') as z:
        for name, data in entries.items():
            z.writestr(name, data)
    found = list(reader.selected_conversations([archive]))
    assert not any(isinstance(item, reader.ReadFailure) for item in found), found
    batches = list(importer.batches([archive]))
    assert not any(batch.error for batch in batches), batches
    messages = {conv['conversation_id']: [reader.message_text(n['message']) for n in reader.current_branch(conv) if n.get('message') and reader.visible(n['message'])] for _, conv in found}
    documents = {doc['conversation_id']: [doc['question'], doc['reply']] for batch in batches for doc in batch.documents}
    print(json.dumps({'messages': messages, 'documents': documents}, ensure_ascii=True))
`;
  const readArchive = entries => {
    const py = spawnSync('python', ['-B', '-c', python, path.resolve(__dirname)], {input:JSON.stringify(Object.fromEntries(entries)),encoding:'utf8'});
    assert.equal(py.status, 0, `python failed: ${py.error || py.stderr}`);
    return JSON.parse(py.stdout);
  };
  const expected = {[ids[0]]:['本文0','返答0'],[ids[1]]:['本文1','返答1']};
  assert.deepEqual(readArchive(project), {messages:expected,documents:expected});

  await ctx.exportsForTest.exportConversation();
  const single = saved[1].zip.entries;
  const singleManifest = JSON.parse(single.get('backup-manifest.json'));
  assert.equal(singleManifest.scope, 'conversation');
  assert.deepEqual(singleManifest.conversationIds, [ids[0]]);
  assert.equal([...single.keys()].filter(k=>k.endsWith('/conversation.json')).length, 1);
  assert.equal([...single.keys()].filter(k=>k.includes('/files/')).length, 2);
  const singleRestored = result();
  await ctx.exportsForTest.inspectBackupFile({name:'single.zip',entries:single},projectId,singleRestored);
  assert.deepEqual([...singleRestored.matched],[ids[0]]);
  assert.equal(singleRestored.invalid,0);
  const singleExpected = {[ids[0]]:['本文0','返答0']};
  assert.deepEqual(readArchive(single), {messages:singleExpected,documents:singleExpected});
});
