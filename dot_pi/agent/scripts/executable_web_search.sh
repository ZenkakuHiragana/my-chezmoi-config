#!/usr/bin/env bash
# Web を検索し、見つかったページの題名と URL、取得できた場合は抜粋を標準出力へ返す。
#
#   web_search.sh [--max-results <件数>] <検索クエリ>
#   --max-results の既定は 5。
#   WEB_SEARCH_RUSTXNG_URL  RustXNG 検索 API の URL（既定 http://127.0.0.1:29483/search）
#   WEB_SEARCH_CLAUDE_MODEL Claude のモデル（既定 haiku）
#   WEB_SEARCH_CODEX_MODEL  Codex のモデル（既定 gpt-6-luna）
#
# 使える検索手段を上から順に試し、結果が返った時点で終える。
#   1. Exa        検索サーバーへ直接問い合わせる
#   2. RustXNG    手元で動いている検索サーバーへ問い合わせる
#   3. claude     WebSearch ツールの出力を、応答の文章を通さずに取り出す
#   4. codex      検索ツールの出力を、応答の文章を通さずに取り出す
# 応答の整形には node を使う。

set -u -o pipefail

max_results=5
while [ $# -gt 0 ]; do
    case "$1" in
        --max-results)
            if [ $# -lt 2 ]; then
                echo "--max-results の後に値を渡す。" >&2
                exit 2
            fi
            max_results=$2
            shift 2
            ;;
        --help | -h) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        --) shift; break ;;
        *) break ;;
    esac
done
query=$*
if [ -z "$query" ]; then
    echo "使い方: $(basename "$0") [--max-results <件数>] <検索クエリ>" >&2
    exit 2
fi
case "$max_results" in
    '' | *[!0-9]*) echo "--max-results には件数を整数で渡す。" >&2; exit 2 ;;
esac
while [[ ${#max_results} -gt 1 && $max_results == 0* ]]; do
    max_results=${max_results#0}
done
[ "$max_results" = 0 ] && exit 0

have() {
    command -v "$1" > /dev/null 2>&1
}

# 検索手段ごとの応答を標準入力から読み、題名、URL、抜粋の並びにして返す。
# 第1引数は応答の形（exa、rustxng、claude、codex）。
# Exa と RustXNG の応答がエラーか、解釈できない形なら、終了コード 65 で終わる。
format() {
    node -e '
const [shape, max] = [process.argv[1], Number(process.argv[2])];
const page = (r, snippet) => `Title: ${r.title ?? ""}\nURL: ${r.url ?? ""}\n${snippet === undefined ? "" : (snippet ?? "") + "\n"}`;
// 1 行に 1 つの JSON が並ぶ応答を読む。JSON でない行は飛ばす。
const events = (lines) => lines.flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });

let text = "";
process.stdin.setEncoding("utf8").on("data", (chunk) => { text += chunk; }).on("end", () => {
    const lines = text.split(/\r?\n/);
    let out = [];
    if (shape === "exa") {
        // MCP の単一 JSON と SSE の各イベントは同じ JSON-RPC 応答を含む。
        let found;
        try {
            found = [JSON.parse(text)].flat();
        } catch {
            found = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n\n/).slice(0, -1).flatMap((event) => {
                const data = event.split(/\n/)
                    .filter((line) => line === "data" || line.startsWith("data:"))
                    .map((line) => line.slice(5).replace(/^ /, ""));
                if (!data.length) return [];
                try { return [JSON.parse(data.join("\n"))].flat(); } catch { return []; }
            });
        }
        if (text.trim() && (found.length === 0 || found.some((e) => e.error || e.result?.isError === true))) {
            process.exitCode = 65;
        }
        out = found
            .filter((e) => e.result && e.result.isError !== true)
            .flatMap((e) => (e.result.content ?? []).map((c) => c.text).filter(Boolean))
            .filter((text) => !/^No search results found\b/.test(text.trim()));
    } else if (shape === "rustxng") {
        const found = events([text])[0];
        if (text.trim() && found === undefined) {
            process.exitCode = 65;
        }
        out = (found?.results ?? []).slice(0, max).map((r) => page(r, r.content));
    } else if (shape === "claude") {
        out = events(lines)
            .filter((e) => e.type === "user" && e.tool_use_result && typeof e.tool_use_result === "object")
            .flatMap((e) => e.tool_use_result.results ?? [])
            .filter((group) => group && typeof group === "object")
            .flatMap((group) => group.content ?? [])
            .filter((r) => r && typeof r === "object")
            .slice(0, max).map((r) => page(r));
    } else if (shape === "codex") {
        out = events(lines)
            .filter((e) => e.type === "item.completed" && e.item?.type === "web_search")
            .flatMap((e) => e.item.results ?? [])
            .filter((r) => r.type === "text_result")
            .slice(0, max).map((r) => page(r, r.snippet));
    }
    process.stdout.write(out.join("\n"));
});
' "$1" "$max_results"
}

# 検索クエリを JSON の文字列にする。
json_string() {
    node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' -- "$1"
}

search_exa() {
    have curl || return 127
    local quoted
    quoted=$(json_string "$query")
    curl --silent --fail --max-time 30 -X POST 'https://mcp.exa.ai/mcp' \
        -H 'Content-Type: application/json' \
        -H 'Accept: application/json, text/event-stream' \
        -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"web_search_exa\",\"arguments\":{\"query\":$quoted,\"objective\":$quoted,\"numResults\":$max_results}}}" \
        | format exa
}

search_rustxng() {
    have curl || return 127
    curl --silent --fail --max-time 30 --get "${WEB_SEARCH_RUSTXNG_URL:-http://127.0.0.1:29483/search}" \
        --data-urlencode "q=$query" --data 'format=json' --data "max_results=$max_results" \
        | format rustxng
}

search_claude() {
    have claude || return 127
    timeout 180 claude -p --no-session-persistence --tools WebSearch --allowedTools WebSearch \
        --permission-mode dontAsk --model "${WEB_SEARCH_CLAUDE_MODEL:-haiku}" --max-turns 4 --output-format stream-json --verbose \
        --system-prompt 'Use WebSearch once with the given query, then reply with the single word done.' \
        -- "$query" < /dev/null 2> /dev/null \
        | format claude
}

# 検索ツールだけを使わせるために、利用者の設定、スキル、ほかのツール、環境の説明を外して起動する。
# 作業先のフォルダは使い回し、プロジェクトの指示ファイルは設定で読ませない。
search_codex() {
    have codex || return 127
    local tmp_root=/tmp/pi
    if [ -n "${LOCALAPPDATA:-}" ]; then
        tmp_root="$(cygpath -u "$LOCALAPPDATA" 2> /dev/null || printf '%s' "$LOCALAPPDATA")/Temp/pi"
    fi
    local workdir="$tmp_root/web-search-codex"
    mkdir -p "$workdir" || return 1
    printf '%s' "$query" | timeout 300 codex --search exec \
        --json --ephemeral --ignore-user-config \
        --skip-git-repo-check --sandbox read-only \
        -C "$(cygpath -m "$workdir" 2> /dev/null || printf '%s' "$workdir")" \
        -m "${WEB_SEARCH_CODEX_MODEL:-gpt-6-luna}" \
        -c 'project_doc_max_bytes=0' \
        -c 'model_reasoning_effort="none"' \
        -c 'instructions="Use web search once with the user input as the query, then reply only done."' \
        -c 'skills.include_instructions=false' \
        -c 'agents.enabled=false' \
        -c 'include_permissions_instructions=false' \
        -c 'include_environment_context=false' \
        -c 'include_apps_instructions=false' \
        -c 'include_collaboration_mode_instructions=false' \
        -c 'tools={update_plan={enabled=false},experimental_request_user_input={enabled=false}}' \
        -c 'features={shell_tool=false,view_image=false,sleep_tool=false,multi_agent=false,multi_agent_v2=false,apps=false,plugins=false,goals=false,image_generation=false,standalone_web_search=true}' \
        -- - 2> /dev/null \
        | format codex
}

# 結果が返らなかった手段ごとに、理由を残す。
reasons=
for source in exa rustxng claude codex; do
    result=$("search_$source")
    status=$?
    if [ -n "${result//[[:space:]]/}" ]; then
        echo "検索手段: $source"
        echo
        printf '%s\n' "$result"
        exit 0
    fi
    case $status in
        0) reasons+="  $source: 結果なし"$'\n' ;;
        127) reasons+="  $source: コマンドが無い"$'\n' ;;
        65) reasons+="  $source: エラー応答か、解釈できない応答"$'\n' ;;
        *) reasons+="  $source: 終了コード $status"$'\n' ;;
    esac
done

{
    echo "どの検索手段からも結果が返らなかった。"
    printf '%s' "$reasons"
} >&2
exit 1
