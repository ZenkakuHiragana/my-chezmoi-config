#!/usr/bin/env node
// 書いた HTML のページを実際のブラウザ（画面を出さない Chrome または Edge）で開き、
// 機械的に判定できる問題を報告して、図ごとの画面を PNG で保存する。
// 文字の重なりや、図が見せたいものを見せているかは判定しない。保存した画像を見て確かめる。
//
// 使い方:
//   node check-page.mjs <ページのパスまたは URL> <画像の保存先> [オプション]
//
// オプション:
//   --width <幅,幅,...>       確かめる画面の幅（px）。既定は 390,1280
//   --height <高さ>           画面の高さ（px）。既定は 900
//   --wait <ミリ秒>           読み込み後、画面を保存するまで待つ時間。既定は 500
//   --state <名前>=<JS>       ページを開き直してから JavaScript を実行し、その状態の図も保存する。複数指定できる
//   --chrome <パス>           ブラウザの実行ファイル。省略時は環境変数 CHROME_PATH、次に既知の場所を探す
//   --browser-arg <引数>      ブラウザに渡す引数を足す（例: --browser-arg=--no-sandbox）。複数指定できる
//   --bare                    図ごとに、説明文（figcaption）を隠した画像（…-figNN-bare.png）も保存する。
//                             図の説明を知らない確認者に、図だけから読み取れることを書かせるために使う
//
// 報告する問題:
//   コンソールのエラー、スクリプトの例外、読み込みの失敗（ネットワークの失敗と 400 以上の応答）、
//   横へのはみ出し、説明文（figcaption）の無い図、大きさが 0 の図、存在しない場所へのページ内リンク、
//   存在しないファイルへのリンク（ファイルとして開いたページだけ。URL で開いたページの他ページへのリンクは確かめない）、
//   表示できなかった画像、式の組版の失敗（KaTeX と MathJax のエラー表示）、
//   Mermaid の図の描画の失敗（エラーの図と、SVG にならずに残った class="mermaid" の要素）、--state の JavaScript の失敗
//
// 終了コード: 0 = 問題なし / 1 = 問題あり / 2 = 確かめられなかった（ブラウザが見つからない、起動できない、ページを開けない）
// 結果は標準出力と、画像の保存先の report.txt に書く。

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function parseArgs(argv) {
  const opt = { widths: [390, 1280], height: 900, wait: 500, states: [], chrome: null, browserArgs: [], bare: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let value = null;
    if (a.startsWith("--") && a.includes("=")) {
      value = a.slice(a.indexOf("=") + 1);
      a = a.slice(0, a.indexOf("="));
    }
    const next = () => (value !== null ? value : argv[++i]);
    switch (a) {
      case "--width": opt.widths = next().split(",").map((s) => Number.parseInt(s, 10)); break;
      case "--height": opt.height = Number.parseInt(next(), 10); break;
      case "--wait": opt.wait = Number.parseInt(next(), 10); break;
      case "--chrome": opt.chrome = next(); break;
      case "--browser-arg": opt.browserArgs.push(next()); break;
      case "--bare": opt.bare = true; break;
      case "--state": {
        const s = next();
        const eq = s.indexOf("=");
        if (eq <= 0) throw new Error(`--state は「名前=JavaScript」の形で指定する: ${s}`);
        opt.states.push({ name: s.slice(0, eq), js: s.slice(eq + 1) });
        break;
      }
      default:
        if (a.startsWith("--")) throw new Error(`知らないオプション: ${a}`);
        opt.positional.push(argv[i]);
    }
  }
  if (opt.positional.length !== 2) throw new Error("使い方: node check-page.mjs <ページのパスまたは URL> <画像の保存先> [オプション]");
  if (opt.widths.some((w) => !Number.isFinite(w) || w <= 0)) throw new Error("--width は正の整数をカンマで区切って指定する");
  for (const s of opt.states) {
    if (!/^[A-Za-z0-9_-]+$/.test(s.name)) throw new Error(`--state の名前は英数字・-・_ だけにする: ${s.name}`);
  }
  return opt;
}

function findBrowser(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const fixed = process.platform === "win32"
    ? [
        join(process.env["PROGRAMFILES"] ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
        join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
        join(process.env["LOCALAPPDATA"] ?? "", "Google\\Chrome\\Application\\chrome.exe"),
        join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft\\Edge\\Application\\msedge.exe"),
        join(process.env["PROGRAMFILES"] ?? "C:\\Program Files", "Microsoft\\Edge\\Application\\msedge.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
      : [];
  for (const p of fixed) if (p && existsSync(p)) return p;
  const names = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    for (const n of names) {
      const p = join(dir, n);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }
  open() {
    return new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error("DevTools に接続できない"));
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id !== undefined && this.pending.has(m.id)) {
          const { res: ok, rej: ng } = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (m.error) ng(new Error(m.error.message));
          else ok(m.result);
        } else if (m.method) {
          for (const l of this.listeners) l(m);
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  waitFor(pred, ms) {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.listeners.delete(l); rej(new Error(`${ms} ms 待っても読み込みが終わらない`)); }, ms);
      const l = (m) => { if (pred(m)) { clearTimeout(timer); this.listeners.delete(l); res(m); } };
      this.listeners.add(l);
    });
  }
  close() { try { this.ws.close(); } catch { /* 閉じられなくても結果は変わらない */ } }
}

async function launch(browser, extraArgs) {
  const userDir = mkdtempSync(join(tmpdir(), "check-page-"));
  const args = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    "--remote-debugging-port=0", `--user-data-dir=${userDir}`, ...extraArgs, "about:blank"];
  // Linux では、--user-data-dir を指定してもクラッシュ報告の設定がホームの設定フォルダに書かれる。
  // 設定フォルダを一時フォルダに向け、確認の外に書き込みを残さない。
  const env = process.platform === "linux" ? { ...process.env, XDG_CONFIG_HOME: userDir } : process.env;
  const proc = spawn(browser, args, { stdio: ["ignore", "ignore", "pipe"], env });
  let stderr = "";
  proc.stderr.on("data", (d) => { stderr += d; });
  let exited = false;
  proc.on("exit", () => { exited = true; });
  const portFile = join(userDir, "DevToolsActivePort");
  for (let i = 0; i < 150; i++) {
    if (existsSync(portFile)) {
      const [port, path] = readFileSync(portFile, "utf8").split("\n");
      if (port && path) return { proc, userDir, url: `ws://127.0.0.1:${port.trim()}${path.trim()}` };
    }
    if (exited) break;
    await sleep(100);
  }
  proc.kill();
  throw new Error(`ブラウザを起動できない: ${stderr.trim().split("\n").slice(-3).join(" / ")}`);
}

// ページの中で実行する検査。結果は JSON にできる値だけで返す。
const INSPECT = `(() => {
  const vw = document.documentElement.clientWidth;
  const sw = document.documentElement.scrollWidth;
  const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "");
  const overflow = [];
  if (sw > vw + 1) {
    for (const el of document.body.querySelectorAll("*")) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.right <= vw + 1) continue;
      const p = el.parentElement;
      if (p && p !== document.body && p.getBoundingClientRect().right > vw + 1) continue;
      let q = el.parentElement, clipped = false;
      while (q && q !== document.body) { if (getComputedStyle(q).overflowX !== "visible") { clipped = true; break; } q = q.parentElement; }
      if (!clipped) overflow.push(name(el) + " の右端 " + Math.round(b.right) + " px");
      if (overflow.length >= 5) break;
    }
  }
  const brokenAnchors = [...document.querySelectorAll('a[href^="#"]')]
    .map((a) => a.getAttribute("href").slice(1))
    .filter((id) => id && !document.getElementById(decodeURIComponent(id)));
  const brokenImages = [...document.querySelectorAll("img")]
    .filter((img) => img.complete && img.naturalWidth === 0)
    .map((img) => img.getAttribute("src"));
  const mathErrors = document.querySelectorAll(".katex-error, mjx-merror, .MathJax_Error, merror").length;
  const mermaidErrors = document.querySelectorAll('svg[aria-roledescription="error"]').length
    + [...document.querySelectorAll(".mermaid")].filter((el) => !el.querySelector("svg")).length;
  const fileLinks = [...document.querySelectorAll("a[href]")]
    .map((a) => a.href)
    .filter((h) => h.startsWith("file:"))
    .map((h) => h.split("#")[0]);
  return { title: document.title, viewport: vw, scrollWidth: sw, overflow, brokenAnchors: [...new Set(brokenAnchors)], brokenImages, mathErrors, mermaidErrors, fileLinks: [...new Set(fileLinks)] };
})()`;

const FIGURES = `(() => [...document.querySelectorAll("figure")].map((f, i) => {
  const cap = f.querySelector("figcaption");
  return { index: i + 1, id: f.id || "", caption: cap ? cap.textContent.trim().replace(/\\s+/g, " ").slice(0, 60) : "" };
}))()`;

// スクロールを滑らかにするページでも位置がずれないよう、即座にスクロールしてから測る
const scrollTo = (i) => `document.querySelectorAll("figure")[${i}].scrollIntoView({ block: "center", behavior: "instant" })`;
const hideCaption = (i, hide) => `(() => {
  for (const c of document.querySelectorAll("figure")[${i}].querySelectorAll("figcaption")) c.style.display = ${hide ? '"none"' : '""'};
  return true;
})()`;
const rectOf = (i) => `(() => {
  const b = document.querySelectorAll("figure")[${i}].getBoundingClientRect();
  return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };
})()`;

async function main() {
  if (typeof WebSocket !== "function") {
    console.error(`確かめられなかった: この Node.js（${process.version}）には WebSocket が無い。Node.js 22 以降で実行する`);
    process.exit(2);
  }
  let opt;
  try { opt = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  const [target, outArg] = opt.positional;
  const isUrl = /^[a-z]+:\/\//i.test(target);
  if (!isUrl && !(existsSync(target) && statSync(target).isFile())) {
    console.error(`確かめられなかった: ページのファイルが無い: ${target}`);
    process.exit(2);
  }
  const pageUrl = isUrl ? target : pathToFileURL(resolve(target)).href;
  const outDir = resolve(outArg);
  mkdirSync(outDir, { recursive: true });

  const lines = [];
  // 問題の文 → 見つかった場所（幅と状態）。同じ問題は 1 件にまとめる
  const problems = new Map();
  const out = (s) => { lines.push(s); console.log(s); };
  const finish = (code) => {
    writeFileSync(join(outDir, "report.txt"), lines.join("\n") + "\n");
    process.exit(code);
  };

  const browser = findBrowser(opt.chrome);
  if (!browser) {
    out("確かめられなかった: ブラウザが見つからない（--chrome か環境変数 CHROME_PATH で実行ファイルを指定する）");
    finish(2);
  }

  let session;
  try { session = await launch(browser, opt.browserArgs); } catch (e) { out(`確かめられなかった: ${e.message}`); finish(2); }
  const cdp = new Cdp(session.url);
  const cleanup = () => {
    cdp.close();
    session.proc.kill();
    try { rmSync(session.userDir, { recursive: true, force: true }); } catch { /* 一時フォルダが残っても結果は変わらない */ }
  };

  out(`ページ: ${pageUrl}`);
  out(`ブラウザ: ${browser}`);
  const shots = [];
  try {
    await cdp.open();
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId: s } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const requests = new Map();
    let current = null;
    cdp.listeners.add((m) => {
      if (m.sessionId !== s || !current) return;
      const p = m.params;
      switch (m.method) {
        case "Runtime.consoleAPICalled":
          if (p.type === "error" || p.type === "assert") current.push(`コンソールのエラー: ${p.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
          break;
        case "Runtime.exceptionThrown":
          current.push(`スクリプトの例外: ${[p.exceptionDetails.text, p.exceptionDetails.exception?.description].filter(Boolean).join(" ").split("\n")[0]}`);
          break;
        case "Network.requestWillBeSent": requests.set(p.requestId, p.request.url); break;
        case "Network.loadingFailed":
          if (!p.canceled) current.push(`読み込みの失敗: ${requests.get(p.requestId) ?? p.requestId}（${p.errorText}）`);
          break;
        case "Network.responseReceived":
          if (p.response.status >= 400) current.push(`読み込みの失敗: ${p.response.url}（HTTP ${p.response.status}）`);
          break;
        case "Log.entryAdded":
          if (p.entry.level === "error" && p.entry.source !== "network") current.push(`ブラウザのエラー: ${p.entry.text}`);
          break;
      }
    });
    for (const d of ["Page.enable", "Runtime.enable", "Network.enable", "Log.enable"]) await cdp.send(d, {}, s);
    const evaluate = async (expression, awaitPromise = false) => {
      const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise }, s);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    const load = async () => {
      const loaded = cdp.waitFor((m) => m.sessionId === s && m.method === "Page.loadEventFired", 30000);
      const nav = await cdp.send("Page.navigate", { url: pageUrl }, s);
      if (nav.errorText) throw new Error(`ページを開けない: ${nav.errorText}`);
      await loaded;
      await evaluate("document.fonts ? document.fonts.ready.then(() => true) : true", true);
      await sleep(opt.wait);
    };
    const shoot = async (file, clip) => {
      const params = { format: "png", captureBeyondViewport: !!clip };
      if (clip) params.clip = { ...clip, scale: 1 };
      const { data } = await cdp.send("Page.captureScreenshot", params, s);
      writeFileSync(join(outDir, file), Buffer.from(data, "base64"));
      shots.push(file);
    };

    let figureList = [];
    for (const width of opt.widths) {
      let initialFound = new Set();
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: opt.height, deviceScaleFactor: 1, mobile: false }, s);
      for (const state of [{ name: "initial", js: null }, ...opt.states]) {
        const found = [];
        current = found;
        try {
          await load();
        } catch (e) {
          out(`確かめられなかった: ${e.message}`);
          cleanup();
          finish(2);
        }
        if (state.js) {
          try { await evaluate(state.js, true); await sleep(opt.wait); } catch (e) { found.push(`状態 ${state.name} の JavaScript の失敗: ${e.message.split("\n")[0]}`); }
        }
        await evaluate('window.scrollTo({ top: 0, left: 0, behavior: "instant" })');
        await shoot(`${width}-${state.name}-top.png`, null);
        const figs = await evaluate(FIGURES);
        if (state.name === "initial" && width === opt.widths[0]) figureList = figs;
        for (const f of figs) {
          await evaluate(scrollTo(f.index - 1));
          await sleep(150);
          const r = await evaluate(rectOf(f.index - 1));
          if (r.width < 1 || r.height < 1) { found.push(`大きさが 0 の図: ${f.index} 番目${f.id ? `（#${f.id}）` : ""}`); continue; }
          const base = `${width}-${state.name}-fig${String(f.index).padStart(2, "0")}`;
          await shoot(`${base}.png`, r);
          if (opt.bare) {
            await evaluate(hideCaption(f.index - 1, true));
            await sleep(100);
            const rb = await evaluate(rectOf(f.index - 1));
            await shoot(`${base}-bare.png`, rb);
            await evaluate(hideCaption(f.index - 1, false));
          }
        }
        const info = await evaluate(INSPECT);
        if (info.overflow.length || info.scrollWidth > info.viewport + 1) {
          found.push(`横へのはみ出し: ページの幅 ${info.scrollWidth} px が画面の幅 ${info.viewport} px を超える${info.overflow.length ? `（${info.overflow.join("、")}）` : ""}`);
        }
        for (const id of info.brokenAnchors) found.push(`存在しない場所へのページ内リンク: #${id}`);
        for (const src of info.brokenImages) found.push(`表示できなかった画像: ${src}`);
        if (info.mathErrors) found.push(`式の組版の失敗: ${info.mathErrors} か所`);
        if (info.mermaidErrors) found.push(`Mermaid の図の描画の失敗: ${info.mermaidErrors} か所`);
        for (const link of info.fileLinks) {
          if (!existsSync(fileURLToPath(link))) found.push(`存在しないファイルへのリンク: ${link}`);
        }
        if (state.name === "initial") {
          for (const f of figs) if (!f.caption) found.push(`説明文（figcaption）の無い図: ${f.index} 番目${f.id ? `（#${f.id}）` : ""}`);
        }
        current = null;
        // 操作後の状態では、操作前に無かった問題だけを数える
        const fresh = [...new Set(found)].filter((p) => state.name === "initial" || !initialFound.has(p));
        if (state.name === "initial") initialFound = new Set(found);
        for (const p of fresh) {
          if (!problems.has(p)) problems.set(p, []);
          problems.get(p).push(`幅 ${width} px・${state.name}`);
        }
      }
    }
    out(`図: ${figureList.length} 枚`);
    for (const f of figureList) out(`  ${String(f.index).padStart(2, "0")}${f.id ? ` #${f.id}` : ""}: ${f.caption || "（説明文なし）"}`);
  } catch (e) {
    out(`確かめられなかった: ${e.message}`);
    cleanup();
    finish(2);
  }
  cleanup();
  out(`保存した画像（${outDir}）: ${shots.length} 枚`);
  for (const f of shots) out(`  ${f}`);
  if (problems.size) {
    out(`問題: ${problems.size} 件`);
    for (const [p, where] of problems) out(`  ${p}（${where.join("、")}）`);
    finish(1);
  }
  out("問題: 0 件");
  finish(0);
}

main();
