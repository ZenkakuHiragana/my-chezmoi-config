#!/usr/bin/env bash
# FxTwitter の読み取り API を一ページずつ呼び、応答 JSON をそのまま返す。
set -u
export LC_ALL=C

help() {
    cat <<'HELP'
使い方:
  fxtwitter.sh --help
  fxtwitter.sh search QUERY [--feed latest|top|media] [--count N] [--cursor CURSOR]
  fxtwitter.sh get POST
  fxtwitter.sh replies POST [--ranking likes|recency] [--cursor CURSOR]
  fxtwitter.sh quotes POST [--count N] [--cursor CURSOR]
  fxtwitter.sh user-posts USER [--with-replies] [--count N] [--cursor CURSOR]

例:
  fxtwitter.sh search '生成AI 口コミ' --feed latest --count 30
  fxtwitter.sh get 'https://x.com/example/status/1234567890123456789?s=20'
  fxtwitter.sh replies 1234567890123456789 --ranking recency
  fxtwitter.sh quotes 1234567890123456789 --count 20
  fxtwitter.sh user-posts @example --with-replies

QUERY は非空の一引数。POST は 2〜20 桁の数字、または https の
x.com / twitter.com (www. 可) の /ユーザー/status/ID URL。末尾の /
と query / fragment は使用できる。ユーザー名は照合せず ID のみ使用。
USER は @ 省略可の英数字・_ 1〜15 文字、または id: と数字列。
記事単体の /i/article/ URL や外部記事本文は取得できない。
N は 1〜100。オプションは対象の後に各々一回まで指定できる。

成功時は API の JSON 本文をそのまま出力する。get の status に text、
media、quote、article 等が含まれる場合がある。get の status.quote.id が
利用可能なら get に渡して引用先を取得できる。利用不能な引用先は追跡できる
とは限らない。記事の内容・全文の存在は保証されない。
replies は status、thread、replies、cursor を返す会話取得であり、
quotes はその投稿を引用した投稿の一覧。user-posts は記事専用一覧ではない。
検索や一覧の網羅性は保証されず、画像・動画は自動ダウンロードしない。

一回の呼び出しは一ページ。続きがあれば JSON の cursor.bottom を、
同じ操作・対象・他のオプションを変えずに --cursor に引用して渡す。
省略時の API 既定は feed=latest、ranking=likes、count は search=30、
quotes/user-posts=20。既定値は明示されない限り送信しない。
投稿、ログイン、その他の書き込みはできない。

依存: Bash, curl, Node.js, mktemp, mkdir, cat, rm。ヘルプに通信は不要。
終了コード: 0 成功、2 使用法エラー、1 依存・通信・API・出力等の失敗。
失敗時は stderr に診断し、API エラー本文は出力しない。
出力中や出力後の後始末が失敗した場合、stdout に本文が残り得る。
結果の有無だけでなく終了コードを確認する。
HELP
}

usage_error() {
    printf 'fxtwitter.sh: %s。--help を参照してください。\n' "$1" >&2
    exit 2
}

if [ "$#" -eq 1 ] && [ "$1" = --help ]; then
    if help; then exit 0; fi
    printf 'fxtwitter.sh: ヘルプの出力に失敗しました。
' >&2
    exit 1
fi
[ "$#" -ge 1 ] || usage_error 'コマンドが必要です'
operation=$1
shift
case "$operation" in
    search|get|replies|quotes|user-posts) ;;
    *) usage_error '不明なコマンドです' ;;
esac
[ "$#" -ge 1 ] || usage_error '対象が必要です'
target=$1
shift

query_args=()
case "$operation" in
    search)
        [ -n "$target" ] || usage_error 'QUERY は空にできません'
        path=/2/search
        query_args+=(--data-urlencode "q=$target")
        ;;
    get|replies|quotes)
        post_id=$target
        # URL の query と fragment は ID の抽出後に捨て、接続先には使わない。
        post_url_re='^https://(www\.)?(x\.com|twitter\.com)/[A-Za-z0-9_]{1,15}/status/([0-9]{2,20})/?([?#].*)?$'
        if [[ $target =~ $post_url_re ]]; then
            post_id=${BASH_REMATCH[3]}
        fi
        [[ $post_id =~ ^[0-9]{2,20}$ ]] || usage_error 'POST は対応する URL または 2〜20 桁の ID で指定してください'
        case "$operation" in
            get) path=/2/status/$post_id ;;
            replies) path=/2/conversation/$post_id ;;
            quotes) path=/2/status/$post_id/quotes ;;
        esac
        ;;
    user-posts)
        if [[ $target =~ ^id:([0-9]+)$ ]]; then
            handle="id%3A${BASH_REMATCH[1]}"
        else
            handle=${target#@}
            [[ $handle =~ ^[A-Za-z0-9_]{1,15}$ ]] || usage_error 'USER の形式が不正です'
        fi
        path=/2/profile/$handle/statuses
        ;;
esac

seen_feed=0 seen_count=0 seen_cursor=0 seen_ranking=0 seen_replies=0
while [ "$#" -gt 0 ]; do
    option=$1
    shift
    case "$option" in
        --feed)
            [ "$operation" = search ] && [ "$seen_feed" -eq 0 ] || usage_error '使用できないか重複した --feed です'
            [ "$#" -gt 0 ] || usage_error '--feed に値が必要です'
            case "$1" in latest|top|media) ;; *) usage_error '--feed の値が不正です' ;; esac
            query_args+=(--data-urlencode "feed=$1")
            seen_feed=1; shift
            ;;
        --count)
            case "$operation" in search|quotes|user-posts) ;; *) usage_error 'このコマンドでは --count を使えません' ;; esac
            [ "$seen_count" -eq 0 ] || usage_error '--count が重複しています'
            [ "$#" -gt 0 ] || usage_error '--count に値が必要です'
            [[ $1 =~ ^[0-9]+$ ]] || usage_error '--count は 1〜100 の整数です'
            count=$1
            while [[ ${#count} -gt 1 && $count == 0* ]]; do count=${count#0}; done
            [[ $count =~ ^([1-9]|[1-9][0-9]|100)$ ]] || usage_error '--count は 1〜100 の整数です'
            query_args+=(--data-urlencode "count=$1")
            seen_count=1; shift
            ;;
        --cursor)
            case "$operation" in search|replies|quotes|user-posts) ;; *) usage_error 'このコマンドでは --cursor を使えません' ;; esac
            [ "$seen_cursor" -eq 0 ] || usage_error '--cursor が重複しています'
            [ "$#" -gt 0 ] && [ -n "$1" ] || usage_error '--cursor に非空の値が必要です'
            query_args+=(--data-urlencode "cursor=$1")
            seen_cursor=1; shift
            ;;
        --ranking)
            [ "$operation" = replies ] && [ "$seen_ranking" -eq 0 ] || usage_error '使用できないか重複した --ranking です'
            [ "$#" -gt 0 ] || usage_error '--ranking に値が必要です'
            case "$1" in likes|recency) ;; *) usage_error '--ranking の値が不正です' ;; esac
            query_args+=(--data-urlencode "ranking_mode=$1")
            seen_ranking=1; shift
            ;;
        --with-replies)
            [ "$operation" = user-posts ] && [ "$seen_replies" -eq 0 ] || usage_error '使用できないか重複した --with-replies です'
            query_args+=(--data-urlencode 'with_replies=1')
            seen_replies=1
            ;;
        *) usage_error '不明または余分な引数です' ;;
    esac
done

http_status='未取得'
fail() {
    printf 'fxtwitter.sh: %s: HTTP %s: %s\n' "$operation" "$http_status" "$1" >&2
    exit 1
}
for dependency in curl node mktemp mkdir cat rm; do
    command -v "$dependency" >/dev/null 2>&1 || fail "依存コマンドがありません: $dependency"
done

# 指定された一時領域の下に、他プロセスと共有しないディレクトリを作る。
if [ -d /tmp ] || [ -z "${LOCALAPPDATA:-}" ]; then
    temp_root=/tmp/pi
else
    temp_root=$LOCALAPPDATA/Temp/pi
fi
mkdir -p -- "$temp_root" 2>/dev/null || fail '一時領域を作成できません'
temp_dir=$(mktemp -d "$temp_root/fxtwitter.XXXXXXXXXX" 2>/dev/null) || fail '一時ディレクトリを作成できません'
cleanup() {
    local original_status=$?
    if ! rm -rf -- "$temp_dir" 2>/dev/null; then
        printf 'fxtwitter.sh: %s: HTTP %s: 一時ディレクトリの削除に失敗しました
' "$operation" "$http_status" >&2
        exit 1
    fi
    return "$original_status"
}
trap cleanup EXIT
trap 'fail "中断されました"' HUP INT TERM

base_url=https://api.fxtwitter.com
# curl のユーザー設定を読まず、TLS 検証を維持して固定ホストにのみ接続する。
curl_result=0
status=$(curl -q --silent --proto '=https' --connect-timeout 10 --max-time 30 \
    --get "${query_args[@]}" --output "$temp_dir/body" --write-out '%{http_code}' \
    "$base_url$path" 2>/dev/null) || curl_result=$?
if [[ $status =~ ^[0-9]{3}$ && $status != 000 ]]; then
    http_status=$status
fi
[ "$curl_result" -eq 0 ] || fail "通信に失敗しました (curl 終了コード: $curl_result)"
[ "$http_status" != '未取得' ] || fail 'HTTP status を取得できませんでした'
[[ $http_status == 2[0-9][0-9] ]] || fail 'API が HTTP エラーを返しました'
# JSON.parse は余分な JSON 値を含まない一つの JSON を要求する。
node -e 'const fs = require("fs");
const value = JSON.parse(fs.readFileSync(0, "utf8"));
if (value === null || typeof value !== "object" || Array.isArray(value) ||
    typeof value.code !== "number" || !(value.code >= 200 && value.code < 300)) process.exit(1);' < "$temp_dir/body" >/dev/null 2>&1 || fail 'JSON 応答または API code が不正です'
cat -- "$temp_dir/body" 2>/dev/null || fail '標準出力への書き込みに失敗しました'
