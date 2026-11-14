#!/usr/bin/env bash
# Meilisearch の会話インデックスを検索・表示する。引数解析・HTTP・整形は Node.js の標準機能を使う。
exec node -e "$(cat <<'JS'
const { parseArgs } = require("node:util");
const { readFileSync } = require("node:fs");

const help = String.raw`使い方:
  session.sh search QUERY [QUERY ...] [オプション]
  session.sh show [--full] [--pick N,N,...] [ID ...]
  session.sh --help

過去の会話を検索・表示する。

search QUERY [QUERY ...]
  QUERY に合うやり取りの ID、日時、出典、題名や作業フォルダ、
  発言・返答の抜粋を表示する。
  空白を含む QUERY は引用符で囲む。同じ引数は一つにまとめ、異なるクエリを独立検索する。
  複数クエリは順位ごとに引数順で交互に拾い、同じ会話・コピーをまとめる。
  --conversation 時は同じ ID だけをまとめる。検索語は「検索: [...]」に示す。
  複数クエリでは各検索をサービス設定の取得上限まで取得してから統合する。
  複数クエリの --limit と --offset は統合後の一覧に適用する。

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
  [番号] は今回表示された一覧内の位置（1始まり）。ページごとに1へ戻る。
  --conversation にも show にも、この ID をそのまま渡せる。

show [--full] [--pick N,N,...] [ID ...]
  指定したやり取りの発言・返答と、元の記録の場所を表示する。
  ID を省略すると、標準入力から検索結果または1行1件の ID を読む。
  --full              長い本文を省略せずに表示する。
  --pick N,N,...      標準入力の一覧から、指定した位置の項目だけを読む。
                      例: --pick 2,5,8。指定順に表示し、重複番号は一度だけ読む。
                      空行・字下げ行は数えない。表示番号ではなく項目順で選ぶ。
                      ID 引数とは併用不可。範囲外は取得前にエラーにする。

例:
  session.sh search '検索語' --limit 3
  session.sh show ID
  session.sh search '' --conversation ID --offset 10 --limit 5
  session.sh search '検索語' --limit 1 | session.sh show
  mkdir -p /tmp/pi
  session.sh search '認知負荷' '認知的負荷' --limit 15 | tee /tmp/pi/session-search.txt
  # 保存した一覧を見て、存在する番号を選ぶ（例: 2番と5番）
  session.sh show --pick 2,5 < /tmp/pi/session-search.txt

-h, --help            この説明を表示する。サブコマンドの直後でも指定できる。

環境変数:
  MEILISEARCH_EMBEDDER  検索に使う埋め込み設定名（既定: ruri）。
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

function header(doc, position) {
    let time = "日時不明";
    if (typeof doc.timestamp === "number") {
        const d = new Date(doc.timestamp);
        const pad = (n) => String(n).padStart(2, "0");
        time = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())
            + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    return [doc.id, ...(position === undefined ? [] : ["[" + position + "]"]), time, doc.source,
        ...(doc.title ? ["「" + oneLine(doc.title) + "」"] : []),
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

// 単一検索と統合検索で同じ識別キーを使う。時刻不明の文書はコピー扱いしない。
function copyKey(hit) {
    return typeof hit.timestamp === "number"
        ? JSON.stringify(["copy", hit.source, hit.message_id, hit.timestamp]) : undefined;
}

function mergeSearches(results, queries, withinConversation) {
    const groups = [];
    const byKey = new Map();
    const find = (index) => {
        let root = index;
        while (groups[root].parent !== root) root = groups[root].parent;
        while (index !== root) {
            const next = groups[index].parent;
            groups[index].parent = root;
            index = next;
        }
        return root;
    };
    for (let rank = 0; results.some((result) => rank < result.hits.length); rank++) {
        for (let q = 0; q < results.length; q++) {
            const hit = results[q].hits[rank];
            if (!hit) continue;
            const keys = [JSON.stringify(["id", hit.id])];
            if (!withinConversation) {
                if (hit.conversation_id != null) keys.push(JSON.stringify(["conversation", hit.conversation_id]));
                const copy = copyKey(hit);
                if (copy !== undefined) keys.push(copy);
            }
            const roots = [...new Set(keys.filter((key) => byKey.has(key)).map((key) => find(byKey.get(key))))];
            // 最初のグループを代表に残す。古いキーも親参照で併合先へ辿れる。
            const root = roots.length ? Math.min(...roots) : groups.length;
            if (!roots.length) groups.push({ parent: root, hit, queries: new Set() });
            for (const other of roots) {
                if (other === root) continue;
                groups[other].parent = root;
                for (const query of groups[other].queries) groups[root].queries.add(query);
            }
            groups[root].queries.add(queries[q]);
            for (const key of keys) byKey.set(key, root);
        }
    }
    return groups.flatMap((group, index) => group.parent === index ? [{ hit: group.hit,
        queries: queries.filter((query) => group.queries.has(query)) }] : []);
}

async function search(options, args) {
    if (!args.length) usage("QUERY を1つ以上指定してください");
    if (args.some((query) => !query) && (args.length !== 1 || !options.conversation))
        usage("空の QUERY は単一かつ --conversation 指定時だけ使えます");
    const queries = [...new Set(args)];
    const multiple = queries.length > 1;
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
    // ページによって候補集合を変えると、後から見つかるコピーで先行位置がずれる。
    // 複数検索はサービスの取得可能範囲を固定して統合し、最後にページを切る。
    const candidateLimit = multiple ? (await request("GET", "/settings/pagination")).maxTotalHits
        : options.conversation ? limit : offset + limit;
    // 全検索が成功するまで出力しない。単一会話検索のサーバー側ページ送りは維持する。
    const results = await Promise.all(queries.map((query) => request("POST", "/search", {
        q: query, limit: candidateLimit,
        offset: options.conversation && !multiple ? offset : 0, filter,
        attributesToRetrieve: ["id", "conversation_id", "source", "message_id", "timestamp", "title", "cwd", "project"],
        attributesToCrop: ["question:20", "reply:40"], cropMarker: "…",
        ...(query ? { hybrid: { embedder: process.env.MEILISEARCH_EMBEDDER || "ruri", semanticRatio: 0.5 } } : { sort: ["timestamp:asc"] }),
        ...(options.conversation ? {} : { distinct: "conversation_id" }),
    })));

    const result = results[0];
    // 単一検索は従来どおり、生の候補範囲と先頭側を照合してコピーを除く。
    const seenCopies = new Set();
    const entries = multiple ? mergeSearches(results, queries, !!options.conversation).slice(offset, offset + limit)
        : (options.conversation ? result.hits : result.hits.filter((hit, i) => {
            const key = copyKey(hit);
            const duplicate = key !== undefined && seenCopies.has(key);
            if (key !== undefined) seenCopies.add(key);
            return i >= offset && !duplicate;
        })).map((hit) => ({ hit }));
    process.stdout.write(entries.map(({ hit, queries: matched }, i) => header(hit, i + 1)
        + (multiple ? "\n  検索: " + oneLine(JSON.stringify(matched)) : "")
        + "\n  Q: " + oneLine(hit._formatted.question)
        + "\n  A: " + oneLine(hit._formatted.reply) + "\n").join(""));
    if (!entries.length) {
        const message = !multiple && !options.conversation && result.hits.length > offset
            ? "この範囲は重複する結果のみです"
            : offset ? "取得できる検索結果はここまでです" : "該当するやり取りはありません";
        report(message);
    }
}

async function show(options, args) {
    if (options.pick !== undefined && args.length) usage("--pick と ID 引数は併用できません");
    if (options.pick !== undefined && !/^[1-9]\d*(,[1-9]\d*)*$/.test(options.pick))
        usage("--pick は1始まりの整数をカンマで区切って指定してください");
    let ids = args.length ? args : readFileSync(0, "utf8").split(/\r?\n/)
        .filter((line) => /^\S/.test(line)).map((line) => line.split(/\s/)[0]);
    if (options.pick !== undefined) {
        const positions = [...new Set(options.pick.split(",").map(Number))];
        if (positions.some((position) => !Number.isSafeInteger(position) || position > ids.length))
            usage("--pick の番号が標準入力の一覧（" + ids.length + "件）の範囲外です");
        ids = positions.map((position) => ids[position - 1]);
    }
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
    } : command === "show" ? { full: { type: "boolean" }, pick: { type: "string" } } : usage("search か show を指定してください");
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
