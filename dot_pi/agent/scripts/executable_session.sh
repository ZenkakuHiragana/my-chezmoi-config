#!/usr/bin/env bash
# Meilisearch の会話インデックスを検索・表示する。引数解析・HTTP・整形は Node.js の標準機能を使う。
exec node -e "$(cat <<'JS'
const { parseArgs } = require("node:util");
const { readFileSync } = require("node:fs");

const help = String.raw`使い方:
  session.sh search QUERY [オプション]
  session.sh show [--full] [ID ...]
  session.sh --help

過去の会話を検索・表示する。

search QUERY
  QUERY に合うやり取りの ID、日時、出典、題名や作業フォルダ、
  発言・返答の抜粋を表示する。
  空白を含む QUERY は引用符で囲む。

  --conversation ID   指定したやり取りと同じ会話に絞る。
                      QUERY に '' を渡すと、会話を古い順に表示する。
  --since YYYY-MM-DD  この日以降に絞る（ローカル日付）。
  --until YYYY-MM-DD  この日以前に絞る（指定した日を含む）。
  --limit N           表示する最大件数（既定: 5）。
  --offset N          先頭から飛ばす件数（既定: 0）。
                      続きは、前回の --offset と --limit の和を指定する。
                      「取得できる検索結果はここまでです」が末尾を示す。
                      「重複する結果のみ」の範囲は飛ばして次へ進める。
  --                  以降の引数を QUERY として扱う。

  ID は検索結果の各項目の先頭に表示される値。
  --conversation にも show にも、この ID をそのまま渡せる。

show [--full] [ID ...]
  指定したやり取りの発言・返答と、元の記録の場所を表示する。
  --full              長い本文を省略せずに表示する。
  ID を省略すると、標準入力から検索結果または1行1件の ID を読む。

例:
  session.sh search '検索語' --limit 3
  session.sh show ID
  session.sh search '' --conversation ID --offset 10 --limit 5
  session.sh search '検索語' --limit 1 | session.sh show

-h, --help            この説明を表示する。サブコマンドの直後でも指定できる。
`;
const origin = (process.env.MEILISEARCH_URL || "http://127.0.0.1:7700").replace(/\/+$/, "");
const indexUrl = origin + "/indexes/" + (process.env.MEILISEARCH_INDEX || "conversations");

class UsageError extends Error {}
const usage = (message) => { throw new UsageError(message + "。--help を参照してください。"); };
const report = (message) => process.stderr.write("session.sh: " + message + "\n");
const oneLine = (text) => text.replace(/[\u0000-\u001f\u007f]+/g, " ");

async function request(method, path, body) {
    let response;
    try {
        response = await fetch(indexUrl + path, {
            method,
            ...(body === undefined ? {} : {
                headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
            }),
        });
    } catch {
        throw new Error("Meilisearch に接続できません: " + origin);
    }
    const value = await response.json();
    if (!response.ok) throw new Error("HTTP " + response.status + ": " + oneLine(value.message));
    return value;
}

function header(doc) {
    let time = "日時不明";
    if (typeof doc.timestamp === "number") {
        const d = new Date(doc.timestamp);
        const pad = (n) => String(n).padStart(2, "0");
        time = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
            + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    return [doc.id, time, doc.source, ...(doc.title ? ["「" + oneLine(doc.title) + "」"] : []),
        ...[doc.project, doc.cwd].filter(Boolean).map(oneLine)].join("  ");
}

function integer(text, min, option) {
    const n = Number(text);
    if (!Number.isSafeInteger(n) || n < min) usage(option + " は " + min + " 以上の整数です");
    return n;
}

function dayStart(text, nextDay) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(text + "T00:00:00");
    if (!date || date.getMonth() + 1 !== Number(text.slice(5, 7))
        || date.getDate() !== Number(text.slice(8))) usage("日付は実在する YYYY-MM-DD で指定してください");
    date.setDate(date.getDate() + (nextDay ? 1 : 0));
    return date.getTime();
}

async function search(options, args) {
    if (args.length !== 1) usage("QUERY を1つ指定してください");
    const query = args[0];
    if (!query && !options.conversation) usage("空の QUERY には --conversation が必要です");
    const limit = integer(options.limit, 1, "--limit");
    const offset = integer(options.offset, 0, "--offset");
    const filter = [];
    if (options.since) filter.push("timestamp >= " + dayStart(options.since, false));
    if (options.until) filter.push("timestamp < " + dayStart(options.until, true));

    // 入力の ID はやり取りを指す。会話は文書の項目から取得する。
    if (options.conversation) {
        const target = await request("GET", "/documents/" + encodeURIComponent(options.conversation) + "?fields=conversation_id");
        filter.push("conversation_id = " + JSON.stringify(target.conversation_id));
    } else if (process.env.PI_SESSION_ID) {
        filter.push("conversation_id != " + JSON.stringify(process.env.PI_SESSION_ID));
    }
    const result = await request("POST", "/search", {
        q: query, limit: options.conversation ? limit : offset + limit,
        offset: options.conversation ? offset : 0, filter,
        attributesToRetrieve: ["id", "source", "message_id", "timestamp", "title", "cwd", "project"],
        attributesToCrop: ["question:20", "reply:40"], cropMarker: "…",
        ...(query ? { hybrid: { embedder: "ruri", semanticRatio: 0.5 } } : { sort: ["timestamp:asc"] }),
        ...(options.conversation ? {} : { distinct: "conversation_id" }),
    });

    // 先頭側と照合してコピーを除き、指定範囲だけ表示する。時刻不明はコピーとみなさない。
    const hits = options.conversation ? result.hits : result.hits.filter((hit, i) =>
        i >= offset && !result.hits.slice(0, i).some((previous) => typeof hit.timestamp === "number"
            && previous.source === hit.source && previous.message_id === hit.message_id
            && previous.timestamp === hit.timestamp));
    process.stdout.write(hits.map((hit) => header(hit) + "\n  Q: " + oneLine(hit._formatted.question)
        + "\n  A: " + oneLine(hit._formatted.reply) + "\n").join(""));
    if (!hits.length) {
        const message = !options.conversation && result.hits.length > offset
            ? "この範囲は重複する結果のみです"
            : offset ? "取得できる検索結果はここまでです" : "該当するやり取りはありません";
        report(message);
    }
}

async function show(options, args) {
    const ids = args.length ? args : readFileSync(0, "utf8").split(/\r?\n/)
        .filter((line) => /^\S/.test(line)).map((line) => line.split(/\s/)[0]);
    const cut = (text, n) => {
        if (options.full) return text;
        const chars = Array.from(text);
        return chars.length <= n ? text : chars.slice(0, n).join("")
            + "\n…（以下 " + (chars.length - n) + " 字を省略。全文は --full）";
    };
    const fields = "id,source,message_id,timestamp,title,cwd,project,question,reply,source_path,source_member";
    let separator = "";
    for (const id of ids) {
        try {
            const doc = await request("GET", "/documents/" + encodeURIComponent(id) + "?fields=" + fields);
            process.stdout.write(separator + [
                "===== " + header(doc),
                "元ログ: " + doc.source_path + (doc.source_member ? " の " + doc.source_member : "")
                    + "（発言 ID " + doc.message_id + "）",
                "--- Q", cut(doc.question, 2000), "--- A", cut(doc.reply, 4000),
            ].join("\n") + "\n");
            separator = "\n";
        } catch (error) {
            report(id + ": " + error.message);
            process.exitCode = 1;
        }
    }
}

async function main() {
    const [command, ...args] = process.argv.slice(1);
    if (command === "--help" || command === "-h") {
        process.stdout.write(help);
        return;
    }
    const schema = command === "search" ? {
        conversation: { type: "string" }, since: { type: "string" }, until: { type: "string" },
        limit: { type: "string", default: "5" }, offset: { type: "string", default: "0" },
    } : command === "show" ? { full: { type: "boolean" } } : usage("search か show を指定してください");
    let parsed;
    try {
        parsed = parseArgs({ args, options: { ...schema, help: { type: "boolean", short: "h" } }, allowPositionals: true });
    } catch (error) {
        usage(error.message);
    }
    if (parsed.values.help) {
        process.stdout.write(help);
        return;
    }
    for (const [name, value] of Object.entries(parsed.values)) {
        if (value === "") usage("--" + name + " に値が必要です");
    }
    if (command === "search") await search(parsed.values, parsed.positionals);
    else await show(parsed.values, parsed.positionals);
}

main().catch((error) => {
    report(error.message);
    process.exitCode = error instanceof UsageError ? 2 : 1;
});
JS
)" -- "$@"
