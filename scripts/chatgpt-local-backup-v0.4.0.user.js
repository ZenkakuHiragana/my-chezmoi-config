// ==UserScript==
// @name         ChatGPT Local Backup
// @namespace    local.chatgpt.backup
// @version      0.4.0
// @description  Export ChatGPT conversations/Projects as ZIP, with attachments, rate-limit handling, incremental backup state, and checkpoint restore from existing ZIPs.
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js#sha256=acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const API = {
    session: '/api/auth/session?unstable_client=true',
    conversation: id => `/backend-api/conversation/${encodeURIComponent(id)}`,
    projectConversations: (projectId, cursor) =>
      `/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations?cursor=${encodeURIComponent(cursor)}`,
    fileDownload: fileId => `/backend-api/files/${encodeURIComponent(fileId)}/download`,
  };

  // Only conversation IDs are stored here. No tokens, message bodies, titles,
  // attachments, or other conversation data are persisted in localStorage.
  const EXPORT_STATE_KEY = 'chatgpt-local-backup:exported-conversation-ids:v1';

  const BETWEEN_CONVERSATIONS_MS = 1500;
  const MAX_CONVERSATION_ATTEMPTS = 8;

  let accessToken = '';
  let running = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ---------------------------------------------------------------------------
  // Incremental-backup state
  // ---------------------------------------------------------------------------

  function readExportState() {
    try {
      const raw = localStorage.getItem(EXPORT_STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeExportState(state) {
    localStorage.setItem(EXPORT_STATE_KEY, JSON.stringify(state));
  }

  function exportedIdsForProject(projectId) {
    const state = readExportState();
    const ids = Array.isArray(state?.[projectId]?.ids)
      ? state[projectId].ids
      : [];
    return new Set(ids);
  }

  function addExportedIds(projectId, ids) {
    if (!projectId || !Array.isArray(ids) || ids.length === 0) return;

    const state = readExportState();
    const current = new Set(
      Array.isArray(state?.[projectId]?.ids)
        ? state[projectId].ids
        : []
    );

    ids.filter(Boolean).forEach(id => current.add(id));

    state[projectId] = {
      ids: [...current],
      updatedAt: new Date().toISOString(),
    };

    writeExportState(state);
  }

  function replaceExportedIds(projectId, ids) {
    if (!projectId) return;

    const state = readExportState();
    state[projectId] = {
      ids: [...new Set((ids || []).filter(Boolean))],
      updatedAt: new Date().toISOString(),
    };
    writeExportState(state);
  }

  function clearExportedIds(projectId) {
    const state = readExportState();
    delete state[projectId];
    writeExportState(state);
  }

  // ---------------------------------------------------------------------------
  // Session / identifiers
  // ---------------------------------------------------------------------------

  function getCookie(name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }

  async function token() {
    if (accessToken) return accessToken;

    const r = await fetch(API.session, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });

    if (!r.ok) {
      throw new Error(`session: HTTP ${r.status}`);
    }

    const j = await r.json();

    if (!j?.accessToken) {
      throw new Error('accessToken が取得できませんでした');
    }

    accessToken = j.accessToken;
    return accessToken;
  }

  async function headers() {
    const h = {
      Authorization: `Bearer ${await token()}`,
      Accept: 'application/json',
    };

    const did = getCookie('oai-did');
    const account = getCookie('_account');

    if (did) h['oai-device-id'] = did;
    if (account) h['ChatGPT-Account-Id'] = account;

    return h;
  }

  function conversationId() {
    return location.pathname.match(/\/c\/([0-9a-f-]{20,})/i)?.[1] || '';
  }

  function projectInfo() {
    const m = location.pathname.match(
      /\/g\/(g-p-[0-9a-f]{32})(?:-([^/]+))?/i
    );

    return m
      ? {
          id: m[1],
          name: m[2] || m[1],
        }
      : null;
  }

  // ---------------------------------------------------------------------------
  // API reads + rate-limit control
  // ---------------------------------------------------------------------------

  function parseRetryAfter(value) {
    if (!value) return 0;

    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const date = Date.parse(value);
    if (!Number.isNaN(date)) {
      return Math.max(0, date - Date.now());
    }

    return 0;
  }

  async function getConversation(id, maxAttempts = MAX_CONVERSATION_ATTEMPTS) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const r = await fetch(API.conversation(id), {
        credentials: 'same-origin',
        headers: await headers(),
      });

      if (r.ok) {
        const j = await r.json();
        j.__local_exported_at = new Date().toISOString();
        setProgress({ detail: '' });
        return j;
      }

      lastError = new Error(`conversation ${id}: HTTP ${r.status}`);

      if (r.status !== 429) {
        throw lastError;
      }

      let waitMs = parseRetryAfter(r.headers.get('Retry-After'));

      if (!waitMs) {
        waitMs =
          Math.min(60_000, 2_000 * Math.pow(2, attempt - 1)) +
          Math.random() * 1000;
      }

      const waitSeconds = Math.max(1, Math.ceil(waitMs / 1000));

      // Preserve [current/total] and the conversation title while showing the wait.
      setProgress({
        detail: `429: ${waitSeconds}秒待機 (${attempt}/${maxAttempts})`
      });

      console.warn(
        `[ChatGPT Local Backup] HTTP 429: conversation ${id}; retry in ${Math.round(waitMs)}ms`
      );

      await sleep(waitMs);

      setProgress({ detail: `再試行中 (${attempt + 1}/${maxAttempts})` });
    }

    throw lastError || new Error(`conversation ${id}: retry exhausted`);
  }

  async function listProjectConversations(projectId) {
    const out = new Map();
    let cursor = '0';

    do {
      const r = await fetch(
        API.projectConversations(projectId, cursor),
        {
          credentials: 'same-origin',
          headers: await headers(),
        }
      );

      if (!r.ok) {
        throw new Error(`project list: HTTP ${r.status}`);
      }

      const j = await r.json();

      for (const item of j?.items || []) {
        if (item?.id) out.set(item.id, item);
      }

      cursor = j?.cursor || '';

      if (cursor) {
        await sleep(750);
      }
    } while (cursor);

    return [...out.values()];
  }

  // ---------------------------------------------------------------------------
  // Current branch only
  // ---------------------------------------------------------------------------

  function mappingMap(mapping) {
    if (!mapping) return new Map();

    if (Array.isArray(mapping)) {
      return new Map(
        mapping
          .filter(Boolean)
          .map(n => [n.id, n])
      );
    }

    return new Map(
      Object.entries(mapping)
        .map(([id, n]) => [id, { id, ...n }])
    );
  }

  function currentBranch(conv) {
    const nodes = mappingMap(conv?.mapping);
    let id = conv?.current_node;

    if (!id || !nodes.has(id)) {
      const parents = new Set(
        [...nodes.values()]
          .map(n => n?.parent)
          .filter(Boolean)
      );

      const leaves = [...nodes.values()]
        .filter(n => !parents.has(n.id));

      leaves.sort(
        (a, b) =>
          Number(b?.message?.create_time || 0) -
          Number(a?.message?.create_time || 0)
      );

      id = leaves[0]?.id || '';
    }

    const path = [];
    const seen = new Set();

    while (id && nodes.has(id) && !seen.has(id)) {
      seen.add(id);
      const n = nodes.get(id);
      path.push(n);
      id = n?.parent || '';
    }

    path.reverse();

    return path.filter(n => {
      const m = n?.message;
      const role = m?.author?.role;

      const hidden =
        m?.metadata?.is_visually_hidden_from_conversation ||
        m?.metadata?.is_contextual_answers_system_message;

      return !hidden && (role === 'user' || role === 'assistant');
    });
  }

  function textOf(message) {
    const c = message?.content;
    if (!c) return '';

    const out = [];
    const parts = Array.isArray(c.parts) ? c.parts : [];

    for (const p of parts) {
      if (typeof p === 'string') {
        out.push(p);
      } else if (p && typeof p.text === 'string') {
        out.push(p.text);
      }
    }

    if (!parts.length && typeof c.text === 'string') {
      out.push(c.text);
    }

    return out.join('\n').trim();
  }

  // ---------------------------------------------------------------------------
  // Attachment / image discovery
  // ---------------------------------------------------------------------------

  function typeOf(x) {
    return String(
      x?.mime_type ||
      x?.content_type ||
      x?.type ||
      x?.file?.mime_type ||
      x?.file?.content_type ||
      ''
    ).toLowerCase();
  }

  function isImage(x) {
    const t = typeOf(x);

    return (
      t.startsWith('image/') ||
      t.includes('image_asset') ||
      Boolean(x?.image_asset || x?.image_asset_pointer)
    );
  }

  function normalizeFileId(v) {
    if (typeof v !== 'string') return '';

    let s = v
      .trim()
      .replace(/^sediment:\/\//, '')
      .replace(/^file:\/\//, '');

    const f = s.match(/file[_-][0-9a-f]+/i);
    if (f) return f[0].replace(/^file-/i, 'file_');

    const u = s.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );

    return u?.[0] || '';
  }

  function safeName(v, fallback = 'untitled') {
    let s = String(v || '')
      .replace(/[\x00-\x1f\x7f]/g, '')
      .replace(/[\/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();

    if (!s) s = fallback;

    return (
      s
        .slice(0, 110)
        .replace(/[\uD800-\uDBFF]$/g, '')
        .replace(/[. -]+$/g, '') ||
      fallback
    );
  }

  function assetKeys(a) {
    return [
      a.fileId && `id:${a.fileId}`,
      a.url && `url:${a.url}`,
      a.filename && `name:${a.filename}`,
    ].filter(Boolean);
  }

  function assetFrom(x) {
    if (!x || typeof x !== 'object') return null;

    const n =
      x.file && typeof x.file === 'object'
        ? x.file
        : {};

    const rawId =
      x.file_id ||
      n.file_id ||
      x.asset_pointer ||
      n.asset_pointer ||
      x.image_asset_pointer ||
      x.id ||
      n.id ||
      '';

    const fileId = normalizeFileId(rawId);

    const url =
      x.download_url ||
      n.download_url ||
      x.url ||
      n.url ||
      '';

    const name =
      x.name ||
      x.file_name ||
      x.filename ||
      x.title ||
      x.display_name ||
      n.name ||
      n.file_name ||
      n.filename ||
      n.title ||
      '';

    const image = isImage(x);

    if (!fileId && !url && !name) return null;

    const filename = safeName(
      name || fileId || (image ? 'image' : 'attachment'),
      image ? 'image' : 'attachment'
    );

    return {
      key: assetKeys({fileId, url, filename})[0],
      fileId,
      url,
      filename,
      label: name || filename,
      image,
      contentType: typeOf(x),
    };
  }

  function collectAssets(message) {
    const found = new Map();

    function add(a) {
      if (!a?.key) return;

      const aliases = assetKeys(a);

      let existing = aliases
        .map(k => found.get(k))
        .find(candidate => {
          if (!candidate) return false;
          if (candidate.fileId && a.fileId) return candidate.fileId === a.fileId;
          if (candidate.url && a.url) return candidate.url === a.url;
          if ((candidate.fileId || candidate.url) && (a.fileId || a.url)) return false;
          return true;
        });

      if (!existing) {
        existing = {
          ...a,
          aliases: new Set(),
        };
      }

      for (const k of aliases) {
        existing.aliases.add(k);
      }

      if (!existing.fileId && a.fileId) existing.fileId = a.fileId;
      if (!existing.url && a.url) existing.url = a.url;
      existing.key = assetKeys(existing)[0];

      existing.image = existing.image || a.image;

      for (const k of existing.aliases) {
        found.set(k, existing);
      }
    }

    function walk(v, depth = 0) {
      if (!v || depth > 6) return;

      if (Array.isArray(v)) {
        v.forEach(x => walk(x, depth + 1));
        return;
      }

      if (typeof v !== 'object') return;

      const t = typeOf(v);

      if (
        v.file_id ||
        v.asset_pointer ||
        v.image_asset_pointer ||
        v.file ||
        t.includes('file') ||
        t.includes('attachment') ||
        t.includes('image_asset') ||
        t.startsWith('image/')
      ) {
        add(assetFrom(v));
      }

      for (const k of [
        'file',
        'image_asset',
        'attachments',
        'parts',
        'items',
      ]) {
        if (v[k] != null) {
          walk(v[k], depth + 1);
        }
      }
    }

    // Important: content_references is deliberately excluded here.
    // Project sources and unrelated file references are not message attachments.
    walk(message?.metadata?.attachments);
    walk(message?.content?.parts);

    return [...new Set(found.values())];
  }

  async function resolveDownload(fileId) {
    const r = await fetch(
      API.fileDownload(fileId),
      {
        credentials: 'same-origin',
        headers: await headers(),
      }
    );

    if (!r.ok) {
      throw new Error(`file ${fileId}: HTTP ${r.status}`);
    }

    return (await r.json())?.download_url || '';
  }

  function sameOrigin(url) {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch {
      return false;
    }
  }

  async function downloadAsset(a) {
    let url = a.url;

    if (!url && a.fileId) {
      url = await resolveDownload(a.fileId);
    }

    if (!url) {
      throw new Error(`download URLなし: ${a.label}`);
    }

    const r = sameOrigin(url)
      ? await fetch(url, {
          credentials: 'same-origin',
        })
      : await fetch(url, {
          credentials: 'omit',
          mode: 'cors',
        });

    if (!r.ok) {
      throw new Error(`asset HTTP ${r.status}: ${a.label}`);
    }

    return r.blob();
  }

  function extFromMime(mime) {
    const t = String(mime || '').toLowerCase();

    const table = [
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif'],
      ['application/pdf', 'pdf'],
      ['application/json', 'json'],
      ['text/plain', 'txt'],
      ['text/markdown', 'md'],
      ['text/csv', 'csv'],
      ['application/zip', 'zip'],
      ['wordprocessingml', 'docx'],
      ['spreadsheetml', 'xlsx'],
      ['presentationml', 'pptx'],
    ];

    return table.find(([k]) => t.includes(k))?.[1] || '';
  }

  function ensureExt(name, blob, asset) {
    if (/\.[A-Za-z0-9]{1,12}$/.test(name)) return name;

    const ext =
      extFromMime(blob?.type) ||
      extFromMime(asset?.contentType) ||
      (asset?.image ? 'png' : '');

    return ext ? `${name}.${ext}` : name;
  }

  function uniqueName(name, used) {
    if (!used.has(name)) {
      used.add(name);
      return name;
    }

    const m = name.match(/^(.*?)(\.[^.]+)?$/);
    const stem = m?.[1] || name;
    const ext = m?.[2] || '';

    let i = 2;
    while (used.has(`${stem} (${i})${ext}`)) i++;

    const out = `${stem} (${i})${ext}`;
    used.add(out);

    return out;
  }

  function mdPath(p) {
    return p
      .split('/')
      .map(encodeURIComponent)
      .join('/');
  }

  function mdLabel(s) {
    return String(s || 'attachment')
      .replace(/([\\\[\]])/g, '\\$1');
  }

  // ---------------------------------------------------------------------------
  // ZIP contents
  // ---------------------------------------------------------------------------

  async function putConversation(conv, folder) {
    const branch = currentBranch(conv);

    const usedFiles = new Set();
    const usedImages = new Set();
    const cache = new Map();
    const errors = [];

    async function materialize(a) {
      if (cache.has(a.key)) return cache.get(a.key);

      try {
        const blob = await downloadAsset(a);

        const used = a.image ? usedImages : usedFiles;
        const dir = a.image ? 'images' : 'files';

        const filename = uniqueName(ensureExt(a.filename, blob, a), used);

        folder
          .folder(dir)
          .file(filename, blob);

        const e = {
          ...a,
          filename,
          path: `${dir}/${filename}`,
        };

        cache.set(a.key, e);
        return e;
      } catch (e) {
        errors.push(`${a.label || a.key}: ${e.message}`);
        return null;
      }
    }

    const md = [
      `# ${conv?.title || 'ChatGPT conversation'}`,
      '',
      `- Conversation ID: \`${conv?.conversation_id || ''}\``,
      `- Exported: ${new Date().toISOString()}`,
      '',
      '> Markdownは現在選択中の枝だけを含みます。',
      '> conversation.json はバックエンドから得た完全なJSONを保存します。',
      '',
    ];

    for (const node of branch) {
      const msg = node.message;

      md.push(
        msg?.author?.role === 'user'
          ? '## User'
          : '## Assistant',
        ''
      );

      const text = textOf(msg);
      if (text) md.push(text, '');

      const assets = collectAssets(msg);
      const downloaded = [];

      for (const a of assets) {
        const e = await materialize(a);

        if (
          e &&
          !downloaded.some(x => x.path === e.path)
        ) {
          downloaded.push(e);
        }
      }

      const files = downloaded.filter(x => !x.image);
      const images = downloaded.filter(x => x.image);

      if (files.length) {
        md.push('### Attachments', '');

        files.forEach(
          f =>
            md.push(
              `- [${mdLabel(f.label || f.filename)}](${mdPath(f.path)})`
            )
        );

        md.push('');
      }

      if (images.length) {
        md.push('### Images', '');

        images.forEach(
          i =>
            md.push(
              `![${mdLabel(i.label || i.filename)}](${mdPath(i.path)})`
            )
        );

        md.push('');
      }
    }

    folder.file(
      'conversation.json',
      JSON.stringify(conv, null, 2)
    );

    folder.file(
      'conversation.md',
      md.join('\n').trim() + '\n'
    );

    if (errors.length) {
      folder.file(
        'ASSET_ERRORS.txt',
        errors.join('\n') + '\n'
      );
    }
  }

  function folderName(conv) {
    const id = String(conv?.conversation_id || 'conversation');
    let title = safeName(conv?.title || 'Untitled')
      .slice(0, 110 - id.length - 1)
      .replace(/[\uD800-\uDBFF]$/g, '')
      .replace(/[. -]+$/g, '');
    const encoder = new TextEncoder();
    while (title && encoder.encode(`${title}_${id}`).length > 255) {
      const chars = Array.from(title);
      chars.pop();
      title = chars.join('').replace(/[. -]+$/g, '');
    }
    return `${title}_${id}`;
  }

  function backupManifest(data = {}) {
    return {
      schema: 'chatgpt-local-backup/v1',
      exporterVersion: '0.4.0',
      generatedAt: new Date().toISOString(),
      ...data,
    };
  }

  function writeBackupManifest(zip, data) {
    zip.file(
      'backup-manifest.json',
      JSON.stringify(backupManifest(data), null, 2)
    );
  }

  async function saveZip(zip, filename) {
    setProgress({ detail: 'ZIP生成中…' });

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6,
      },
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = filename;
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------------------------------------------------------------------
  // Export operations
  // ---------------------------------------------------------------------------

  async function exportConversation() {
    const id = conversationId();

    if (!id) {
      throw new Error('conversation IDをURLから取得できません');
    }

    resetProgress();
    setProgress({ title: '現在の会話', detail: '取得中…' });

    const conv = await getConversation(id);
    const p = projectInfo();

    const zip = new JSZip();

    await putConversation(
      conv,
      zip.folder(folderName(conv))
    );

    writeBackupManifest(zip, {
      scope: 'conversation',
      projectId: p?.id || conv?.gizmo_id || conv?.conversation_template_id || null,
      projectName: p?.name || null,
      conversationIds: [id],
      failedConversationIds: [],
    });

    await saveZip(
      zip,
      `chatgpt_${safeName(conv.title || id)}_${new Date().toISOString().slice(0, 10)}.zip`
    );

    // If this conversation belongs to the currently opened Project, remember it.
    if (p) addExportedIds(p.id, [id]);
  }

  async function exportProject(options = {}) {
    const {
      incremental = false,
    } = options;

    const p = projectInfo();

    if (!p) {
      throw new Error('Project内の会話を開いて実行してください');
    }

    resetProgress();
    setProgress({ title: 'Project', detail: '会話一覧取得中…' });

    const all = await listProjectConversations(p.id);

    if (!all.length) {
      throw new Error('Project会話が見つかりません');
    }

    const already = incremental
      ? exportedIdsForProject(p.id)
      : new Set();

    const list = incremental
      ? all.filter(item => !already.has(item.id))
      : all;

    if (incremental && list.length === 0) {
      resetProgress();
      setProgress({ detail: `新規会話なし（既取得 ${already.size}件）` });
      alert(`新しく作られた会話はありません。\n\n既取得として記録済み: ${already.size}件`);
      return;
    }

    const zip = new JSZip();
    const root = zip.folder(safeName(p.name));
    const failures = [];
    const successes = [];

    setProgress({
      current: 0,
      total: list.length,
      title: '',
      detail: incremental
        ? `新規 ${list.length}件を開始`
        : `全 ${list.length}件を開始`,
    });

    for (let i = 0; i < list.length; i++) {
      const item = list[i];

      setProgress({
        current: i + 1,
        total: list.length,
        title: item.title || item.id,
        detail: '取得中…',
      });

      try {
        const conv = await getConversation(item.id);

        setProgress({
          detail: 'ZIPへ格納中…',
        });

        await putConversation(
          conv,
          root.folder(folderName(conv))
        );

        successes.push(item.id);
      } catch (e) {
        failures.push(`${item.title || item.id}: ${e.message}`);
      }

      if (i + 1 < list.length) {
        setProgress({
          detail: `${BETWEEN_CONVERSATIONS_MS / 1000}秒待機`,
        });
        await sleep(BETWEEN_CONVERSATIONS_MS);
      }
    }

    if (failures.length) {
      root.file(
        'EXPORT_ERRORS.txt',
        failures.join('\n') + '\n'
      );
    }

    const mode = incremental ? 'new' : 'full';

    writeBackupManifest(zip, {
      scope: 'project',
      mode,
      projectId: p.id,
      projectName: p.name,
      conversationIds: successes,
      failedConversationIds: failures.map(line => {
        const match = line.match(/conversation\s+([0-9a-f-]{20,})/i);
        return match?.[1] || null;
      }).filter(Boolean),
    });

    await saveZip(
      zip,
      `chatgpt_project_${mode}_${safeName(p.name)}_${new Date().toISOString().slice(0, 10)}.zip`
    );

    // Only mark conversations after the ZIP has been successfully generated and
    // its browser download has been initiated. Failed items remain unmarked and
    // will be retried by the next incremental run.
    addExportedIds(p.id, successes);

    setProgress({
      current: list.length,
      total: list.length,
      title: '',
      detail: failures.length
        ? `完了: 成功 ${successes.length} / 失敗 ${failures.length}`
        : `完了: ${successes.length}件`,
    });

    if (failures.length) {
      alert(
        `ZIPは生成しましたが、${failures.length}件の会話取得に失敗しました。\n` +
        `失敗した会話は既取得扱いにしていないため、次回の新規会話バックアップで再試行されます。`
      );
    }
  }

  function chooseBackupFiles() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip,application/zip,.json,application/json';
      input.multiple = true;
      input.style.display = 'none';

      const cleanup = () => {
        input.remove();
      };

      input.addEventListener(
        'change',
        () => {
          const files = [...(input.files || [])];
          cleanup();
          resolve(files);
        },
        { once: true }
      );

      // If the picker is cancelled, browsers do not consistently emit change.
      // window focus returns after the native picker closes; resolve empty only
      // when no files were selected.
      window.addEventListener(
        'focus',
        () => {
          setTimeout(() => {
            if (document.body.contains(input) && !(input.files?.length)) {
              cleanup();
              resolve([]);
            }
          }, 250);
        },
        { once: true }
      );

      document.body.appendChild(input);
      input.click();
    });
  }

  function projectIdFromConversationJson(conv) {
    return (
      conv?.gizmo_id ||
      conv?.conversation_template_id ||
      null
    );
  }

  function addConversationJsonToImport(result, conv, currentProjectId, sourceName, manifestProjectId = null) {
    const id = conv?.conversation_id || conv?.id || '';
    if (!id) {
      result.invalid++;
      return;
    }

    const projectId = projectIdFromConversationJson(conv) || manifestProjectId;

    if (projectId === currentProjectId) {
      result.matched.add(id);
      return;
    }

    if (projectId) {
      result.mismatched.push({
        id,
        projectId,
        sourceName,
        title: conv?.title || '',
      });
      return;
    }

    result.unknownProject.push({
      id,
      sourceName,
      title: conv?.title || '',
    });
  }

  async function inspectBackupFile(file, currentProjectId, result) {
    const lower = String(file?.name || '').toLowerCase();

    if (lower.endsWith('.json')) {
      const raw = await file.text();
      const data = JSON.parse(raw);

      if (
        data?.schema === 'chatgpt-local-backup/v1' &&
        Array.isArray(data?.conversationIds)
      ) {
        result.manifestOnly++;
        return;
      }

      addConversationJsonToImport(result, data, currentProjectId, file.name);
      return;
    }

    if (!lower.endsWith('.zip')) {
      result.invalid++;
      return;
    }

    const zip = await JSZip.loadAsync(file);

    // Manifests provide project metadata only for actual descendant conversations.
    const manifests = [];
    const manifestEntries = Object.values(zip.files)
      .filter(entry => !entry.dir && /(^|\/)backup-manifest\.json$/i.test(entry.name));

    for (const entry of manifestEntries) {
      try {
        const manifest = JSON.parse(await entry.async('string'));
        if (manifest?.schema === 'chatgpt-local-backup/v1' &&
            Array.isArray(manifest?.conversationIds)) {
          manifests.push({
            folder: entry.name.slice(0, entry.name.lastIndexOf('/') + 1),
            manifest,
          });
        }
      } catch (e) {
        console.warn('[ChatGPT Local Backup] manifest parse failed:', entry.name, e);
      }
    }

    const conversationEntries = Object.values(zip.files)
      .filter(entry => !entry.dir && /(^|\/)conversation\.json$/i.test(entry.name));

    for (let i = 0; i < conversationEntries.length; i++) {
      const entry = conversationEntries[i];

      setProgress({
        detail: `既存ZIPを解析中… ${i + 1}/${conversationEntries.length}`,
      });

      try {
        const conv = JSON.parse(await entry.async('string'));
        const id = conv?.conversation_id || conv?.id || '';
        const nearest = manifests
          .filter(({ folder, manifest }) => entry.name.startsWith(folder) &&
            manifest.conversationIds.includes(id))
          .sort((a, b) => b.folder.length - a.folder.length)[0];
        addConversationJsonToImport(
          result,
          conv,
          currentProjectId,
          `${file.name}:${entry.name}`,
          nearest?.manifest.projectId || null
        );
      } catch (e) {
        result.invalid++;
        console.warn('[ChatGPT Local Backup] conversation.json parse failed:', entry.name, e);
      }
    }
  }

  async function restoreCheckpointFromBackups() {
    const p = projectInfo();

    if (!p) {
      throw new Error('Project内の会話を開いて実行してください');
    }

    const files = await chooseBackupFiles();

    if (!files.length) {
      resetProgress();
      setProgress({ detail: 'バックアップ選択をキャンセルしました' });
      return;
    }

    resetProgress();
    setProgress({
      title: '既取得記録',
      detail: `${files.length}ファイルを解析中…`,
    });

    const result = {
      matched: new Set(),
      unknownProject: [],
      mismatched: [],
      manifestProjectMismatches: 0,
      manifestOnly: 0,
      invalid: 0,
    };

    for (let i = 0; i < files.length; i++) {
      setProgress({
        current: i + 1,
        total: files.length,
        title: files[i].name,
        detail: '解析中…',
      });

      await inspectBackupFile(files[i], p.id, result);
    }

    // Old/foreign JSON without a project marker is never silently assigned.
    // The user may explicitly opt in after seeing the count.
    const unknownIds = new Set(
      result.unknownProject
        .map(item => item.id)
        .filter(Boolean)
    );

    if (unknownIds.size > 0) {
      const includeUnknown = confirm(
        `${unknownIds.size}件のconversationにはProject IDが記録されていません。\n\n` +
        `これらを現在のProject「${p.name}」の既取得会話として追加しますか？\n\n` +
        `Project IDが異なると確認できたconversationは、この確認に関係なく除外します。`
      );

      if (includeUnknown) {
        unknownIds.forEach(id => result.matched.add(id));
      }
    }

    if (result.matched.size === 0 && result.manifestOnly) {
      alert('既取得 0件。manifest単独では復元できません。実際のconversation.jsonを含むZIPまたは会話JSONが必要です。');
      return;
    }

    if (result.matched.size === 0) {
      throw new Error(
        '現在のProjectに属すると確認できるconversation IDを、選択したバックアップから取得できませんでした'
      );
    }

    const before = exportedIdsForProject(p.id).size;
    addExportedIds(p.id, [...result.matched]);
    const after = exportedIdsForProject(p.id).size;
    const added = after - before;

    resetProgress();
    setProgress({
      current: after,
      total: after,
      title: '',
      detail: `既存バックアップから ${added}件追加（記録済み計 ${after}件）`,
    });

    const notes = [
      `選択ファイル: ${files.length}`,
      `現在Projectとして確認できたconversation: ${result.matched.size}`,
      `今回新たに既取得記録へ追加: ${added}`,
      `既取得記録の合計: ${after}`,
    ];

    if (result.mismatched.length || result.manifestProjectMismatches) {
      notes.push(
        `別Projectと確認できた項目は除外: ` +
        `${result.mismatched.length + result.manifestProjectMismatches}`
      );
    }

    if (result.invalid) {
      notes.push(`読み取れなかったJSON等: ${result.invalid}`);
    }

    alert(
      `既存バックアップから既取得記録を復元しました。\n\n${notes.join('\n')}\n\n` +
      `ZIP内に実在したconversationだけを記録しています。` +
      `以前429などで取得に失敗したconversationは次回の「新規会話だけZIP保存」で再取得されます。`
    );
  }

  async function markCurrentProjectAsAlreadyBackedUp() {
    const p = projectInfo();

    if (!p) {
      throw new Error('Project内の会話を開いて実行してください');
    }

    resetProgress();
    setProgress({ title: 'Project', detail: '現在の会話一覧を取得中…' });

    const list = await listProjectConversations(p.id);
    replaceExportedIds(p.id, list.map(item => item.id));

    setProgress({
      current: list.length,
      total: list.length,
      title: '',
      detail: '既取得として記録しました',
    });

    alert(
      `現在Projectにある ${list.length} 件を既取得として記録しました。\n\n` +
      `会話本体は再取得していません。次回「新規会話だけZIP保存」では、これ以後に追加された会話だけを取得します。`
    );
  }

  async function resetIncrementalState() {
    const p = projectInfo();

    if (!p) {
      throw new Error('Project内の会話を開いて実行してください');
    }

    const count = exportedIdsForProject(p.id).size;

    if (
      !confirm(
        `このProjectの既取得記録 ${count} 件をリセットしますか？\n\n` +
        `ローカルのZIPや会話データは削除しません。`
      )
    ) {
      return;
    }

    clearExportedIds(p.id);

    resetProgress();
    setProgress({ detail: '既取得記録をリセットしました' });
  }

  // ---------------------------------------------------------------------------
  // Status display
  // ---------------------------------------------------------------------------

  let statusEl;

  const progress = {
    current: 0,
    total: 0,
    title: '',
    detail: '',
  };

  function resetProgress() {
    progress.current = 0;
    progress.total = 0;
    progress.title = '';
    progress.detail = '';
    renderProgress();
  }

  function setProgress(patch) {
    Object.assign(progress, patch || {});
    renderProgress();
  }

  function renderProgress() {
    if (!statusEl) return;

    const parts = [];

    if (progress.total > 0) {
      parts.push(`[${progress.current}/${progress.total}]`);
    }

    if (progress.title) {
      parts.push(progress.title);
    }

    if (progress.detail) {
      parts.push(`— ${progress.detail}`);
    }

    statusEl.textContent = parts.join(' ');
    statusEl.title = statusEl.textContent;
  }

  // ---------------------------------------------------------------------------
  // Minimal UI
  // ---------------------------------------------------------------------------

  function installUI() {
    if (document.getElementById('local-chatgpt-backup')) return;

    const root = document.createElement('div');

    root.id = 'local-chatgpt-backup';

    Object.assign(root.style, {
      position: 'fixed',
      right: '18px',

      // v0.3: move the whole widget slightly upward.
      bottom: '30px',

      zIndex: '2147483647',
      fontFamily: 'system-ui,sans-serif',
      color: 'inherit',
    });

    const btn = document.createElement('button');

    btn.textContent = 'Backup';

    Object.assign(btn.style, {
      minHeight: '34px',
      padding: '7px 12px',
      borderRadius: '10px',
      border: '1px solid #8886',
      background: 'var(--main-surface-primary,#fff)',
      color: 'inherit',
      cursor: 'pointer',
      boxShadow: '0 4px 16px #0003',
      lineHeight: '1.2',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });

    const menu = document.createElement('div');

    Object.assign(menu.style, {
      display: 'none',
      position: 'absolute',
      right: '0',
      bottom: '44px',
      width: '310px',
      padding: '6px',
      border: '1px solid #8886',
      borderRadius: '12px',
      background: 'var(--main-surface-primary,#fff)',
      color: 'inherit',
      boxShadow: '0 8px 30px #0004',
    });

    async function action(fn) {
      if (running) return;

      running = true;
      btn.disabled = true;
      menu.style.display = 'none';

      try {
        await fn();
      } catch (e) {
        console.error('[ChatGPT Local Backup]', e);

        setProgress({
          detail: `失敗: ${e.message}`,
        });

        alert(e.message);
      } finally {
        running = false;
        btn.disabled = false;
      }
    }

    const add = (label, fn, enabled = true, danger = false) => {
      const b = document.createElement('button');

      b.textContent = label;
      b.disabled = !enabled;

      Object.assign(b.style, {
        display: 'block',
        width: '100%',
        padding: '9px 10px',
        border: '0',
        borderRadius: '7px',
        background: 'transparent',
        color: danger ? '#d33' : 'inherit',
        textAlign: 'left',
        cursor: enabled ? 'pointer' : 'not-allowed',
        opacity: enabled ? '1' : '.45',
      });

      b.addEventListener('mouseenter', () => {
        if (enabled) b.style.background = 'rgba(127,127,127,.14)';
      });

      b.addEventListener('mouseleave', () => {
        b.style.background = 'transparent';
      });

      b.onclick = () => enabled && action(fn);

      menu.appendChild(b);
    };

    const separator = () => {
      const hr = document.createElement('div');
      Object.assign(hr.style, {
        height: '1px',
        margin: '5px 4px',
        background: 'rgba(127,127,127,.22)',
      });
      menu.appendChild(hr);
    };

    btn.onclick = e => {
      e.stopPropagation();

      menu.replaceChildren();

      const convId = conversationId();
      const p = projectInfo();

      add(
        '現在の会話をZIP保存',
        exportConversation,
        Boolean(convId)
      );

      separator();

      add(
        '現在のProjectを丸ごとZIP保存',
        () => exportProject({ incremental: false }),
        Boolean(p)
      );

      add(
        '現在のProjectの新規会話だけZIP保存',
        () => exportProject({ incremental: true }),
        Boolean(p)
      );

      separator();

      add(
        '取得済みZIP/JSONから既取得記録を復元',
        restoreCheckpointFromBackups,
        Boolean(p)
      );

      add(
        '現在のProjectを現在地点まで既取得として記録',
        markCurrentProjectAsAlreadyBackedUp,
        Boolean(p)
      );

      add(
        '現在のProjectの既取得記録をリセット',
        resetIncrementalState,
        Boolean(p),
        true
      );

      if (p) {
        const count = exportedIdsForProject(p.id).size;
        const note = document.createElement('div');
        note.textContent = `既取得記録: ${count}件`;
        Object.assign(note.style, {
          padding: '7px 10px 3px',
          fontSize: '11px',
          opacity: '.65',
        });
        menu.appendChild(note);
      }

      menu.style.display =
        menu.style.display === 'none'
          ? 'block'
          : 'none';
    };

    statusEl = document.createElement('div');

    Object.assign(statusEl.style, {
      position: 'absolute',
      right: '0',

      // The root itself moved up, so this remains visible above the viewport edge.
      bottom: '-19px',

      width: '520px',
      textAlign: 'right',
      fontSize: '11px',
      lineHeight: '1.3',
      opacity: '.78',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      pointerEvents: 'none',
    });

    document.addEventListener(
      'click',
      e => {
        if (!root.contains(e.target)) {
          menu.style.display = 'none';
        }
      }
    );

    root.append(menu, btn, statusEl);
    document.body.appendChild(root);
  }

  if (document.body) {
    installUI();
  } else {
    window.addEventListener(
      'DOMContentLoaded',
      installUI,
      { once: true }
    );
  }
})();
