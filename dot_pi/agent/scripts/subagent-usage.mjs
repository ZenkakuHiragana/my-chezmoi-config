// subagent.sh が起動した子の Pi（--mode json）の出力を受け取り、
// 子の最終応答を pi -p と同じ形で出し、使用量を台帳 ~/.pi/agent/subagent-usage.jsonl へ 1 行追記する。
// 台帳に書けなかったとき、subagent.sh が集計器の起動前に止められたとき、
// subagent.sh が終了処理の途中で制限時間・中断の合図を受けて、台帳に書く前の集計器を止めたときは、行が残らない。
// subagent.sh が trap の効かない止め方で止められたときは、集計器も止まれば行は残らず、
// 集計器が入力の終わりを受け取れれば exitCode が null の行が残る。
//
//   node subagent-usage.mjs <種類> <説明> <model> <thinking>
//
// 標準入力には、子の stdout（JSONL のイベント）に続けて、subagent.sh が終了記録
// {"type":"subagent_end","code":N} を 1 行書く。N は、子が自分で終わったなら pi の終了コード、
// 制限時間なら 124、中断なら 130。この集計器の終了コードが、通常は subagent.sh の終了コードになる。
// イベントの形は Pi の docs/json.md、最終応答の出し方は Pi の print モード（dist/modes/print-mode.js）に合わせる。
//
// 台帳の 1 行の項目:
//   time          台帳に書いた時刻（ISO 8601）。子の終了後、最終応答を出す前
//   durationMs    集計器の起動から台帳に書くまでのミリ秒
//   parentSession 呼び出し元の Pi のセッション ID（環境変数 PI_SESSION_ID）。無ければ null
//   cwd           作業ディレクトリ
//   type, name    サブエージェントの種類と --name の説明（説明が無ければ null）
//   model, thinking  エージェント定義の欄の値
//   exitCode      集計器が決めた終了コード。終了記録が届かなかったときは null。
//                 台帳は最終応答を出す前に書くので、最終応答を出し終える前に制限時間・中断・出力の失敗があると、
//                 subagent.sh の実際の終了コードと異なることがある
//   usage         input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost（ドル）の合計
// usage には、assistant の応答、圧縮、キャッシュ維持の分を含める。圧縮が中止・失敗したときは、その分は含まない
// （compaction_end に結果が無いため）。
// reasoning は output の内数で、内訳を報告しないプロバイダでは 0 になる。
// 子が応答の途中で止められたときは、その応答について途中までに報告された値を加える。
// 途中で usage を報告しないプロバイダでは、その応答の分は 0 になる。

import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const startedAt = Date.now();
const [type, name, model, thinking] = process.argv.slice(2);
const ledgerPath = join(homedir(), ".pi", "agent", "subagent-usage.jsonl");

const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0, cost: 0 };
// message_end がまだ来ていない assistant 応答の、最新の累積 usage。
// 子が応答の途中で止められたとき、その応答の分として加える。
let pendingUsage;
// 最後の message_end の message。最終応答に使うのは assistant のときだけなので、それ以外は role だけ残す。
let lastMessage;
let endCode;

function add(usage) {
    if (!usage) return;
    total.input += usage.input ?? 0;
    total.output += usage.output ?? 0;
    total.cacheRead += usage.cacheRead ?? 0;
    total.cacheWrite += usage.cacheWrite ?? 0;
    total.reasoning += usage.reasoning ?? 0;
    total.totalTokens += usage.totalTokens ?? 0;
    total.cost += usage.cost?.total ?? 0;
}

function handle(line) {
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line === "") return;
    let event;
    try {
        event = JSON.parse(line);
    } catch {
        // 子が行の途中で止められた場合など。読めない行には依頼文やツールの結果が含まれうるので、
        // 呼び出し元へは出さずに捨てる。
        return;
    }
    switch (event?.type) {
        case "message_update":
            if (event.usage) pendingUsage = event.usage;
            break;
        case "message_end":
            lastMessage = event.message?.role === "assistant" ? event.message : { role: event.message?.role };
            if (event.message?.role === "assistant") {
                add(event.message.usage);
                pendingUsage = undefined;
            }
            break;
        case "compaction_end":
            add(event.result?.usage);
            break;
        case "entry_appended":
            // キャッシュ維持など、assistant の応答以外でモデルを呼んだ分（Pi の docs/session-format.md の UsageEntry）。
            if (event.entry?.type === "usage") add(event.entry.usage);
            break;
        case "subagent_end":
            endCode = event.code;
            break;
    }
}

// 子が自分で終わったときの出力と終了コードを、Pi の print モードと同じ規則で決める。
function finalMessageOutput() {
    if (lastMessage?.role !== "assistant") return { stdout: "", stderr: "", code: 0 };
    if (lastMessage.stopReason === "error" || lastMessage.stopReason === "aborted") {
        return { stdout: "", stderr: (lastMessage.errorMessage || "Request " + lastMessage.stopReason) + "\n", code: 1 };
    }
    let stdout = "";
    for (const content of lastMessage.content ?? []) {
        if (content.type === "text") stdout += content.text + "\n";
    }
    if (lastMessage.stopReason === "length") {
        return { stdout, stderr: "Response was truncated: the model reached its output token limit.\n", code: 1 };
    }
    return { stdout, stderr: "", code: 0 };
}

function finish() {
    add(pendingUsage);
    let output = { stdout: "", stderr: "", code: endCode ?? null };
    if (endCode === 0) output = finalMessageOutput();
    const exitCode = output.code;
    const record = {
        time: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        parentSession: process.env.PI_SESSION_ID || null,
        cwd: process.cwd(),
        type,
        name: name || null,
        model,
        thinking,
        exitCode,
        usage: total,
    };
    try {
        appendFileSync(ledgerPath, JSON.stringify(record) + "\n");
    } catch (e) {
        process.stderr.write("使用量を台帳 " + ledgerPath + " に書けなかった: " + e.message + "\n");
    }
    // 呼び出し元が stdout を読まずに止まっても台帳には残るよう、出力は台帳への追記の後にする。
    process.stdout.write(output.stdout);
    process.stderr.write(output.stderr);
    // 終了記録が届かなかったのは、subagent.sh ごと止められた場合だけ。
    process.exitCode = exitCode ?? 1;
}

// 行は LF だけで区切る。JSON 文字列中の U+2028 などを区切りと見なす readline は使わない（docs/json.md）。
// 改行は新しく届いた部分だけで探す。画像を含む長い行で、届いた分を毎回先頭から探し直さないため。
const decoder = new TextDecoder();
let partial = "";
process.stdin.on("data", (chunk) => {
    let text = decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = text.indexOf("\n")) !== -1) {
        handle(partial + text.slice(0, newline));
        partial = "";
        text = text.slice(newline + 1);
    }
    partial += text;
});
process.stdin.on("end", () => {
    handle(partial + decoder.decode());
    finish();
});

