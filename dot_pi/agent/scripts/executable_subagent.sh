#!/usr/bin/env bash
# サブエージェントを一つ起動し、最終応答を標準出力へ返す。
#
#   subagent.sh <種類> [--name <説明>] [--timeout <秒>] [依頼文]
#
# 依頼文を省略すると標準入力から読む。
# 種類は、このスクリプトと同じ場所にある agents/<種類>.md で定義する。
# 定義の先頭の欄（model、thinking、read_only）が起動条件で、欄より後ろがシステムプロンプトになる。
# 子の記録は ~/.pi/agent/subagent-sessions/ の下に残る。フォルダ名は、Pi のセッションフォルダと同じ形に
# 作業ディレクトリを符号化したもの（例: /home/user/project なら --home-user-project--）。

set -u

script_dir=$(cd "$(dirname "$0")" && pwd)
agents_dir="$script_dir/agents"
default_timeout=2700

# 定義の先頭の欄から値を一つ取り出す。
field() {
    awk -v key="$1" '
        /^---[[:space:]]*$/ { n++; next }
        n == 1 && index($0, key ":") == 1 {
            value = substr($0, length(key) + 2)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
            gsub(/^"|"$/, "", value)
            print value
            exit
        }
        n >= 2 { exit }
    ' "$2"
}

# 定義の欄より後ろの本文を取り出す。
body() {
    awk '
        n >= 2 { print; next }
        /^---[[:space:]]*$/ { n++ }
    ' "$1"
}

usage() {
    echo "使い方: $(basename "$0") <種類> [--name <説明>] [--timeout <秒>] [依頼文]"
    echo "依頼文を省略すると標準入力から読む。--timeout の既定は $default_timeout 秒。"
    echo "種類:"
    local def
    for def in "$agents_dir"/*.md; do
        [ -e "$def" ] || continue
        echo "  $(basename "$def" .md): $(field description "$def")"
    done
}

if [ "${PI_SUBAGENT_CHILD:-}" = 1 ]; then
    echo "サブエージェントからサブエージェントは起動できない。" >&2
    exit 2
fi

if [ $# -ge 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
    usage
    exit 0
fi
if [ $# -lt 1 ]; then
    usage >&2
    exit 2
fi

type=$1
shift
def="$agents_dir/$type.md"
if [ ! -f "$def" ]; then
    echo "サブエージェントの種類 '$type' の定義がない。" >&2
    usage >&2
    exit 2
fi

# オプションの後に値が無ければ、使い方の誤りとして終える。
need_value() {
    if [ "$2" -lt 2 ]; then
        echo "$1 の後に値を渡す。" >&2
        exit 2
    fi
}

description=
timeout=$default_timeout
prompt=
have_prompt=0
while [ $# -gt 0 ]; do
    case "$1" in
        --name) need_value "$1" $#; description=$2; shift 2 ;;
        --timeout) need_value "$1" $#; timeout=$2; shift 2 ;;
        --) shift; prompt=$*; have_prompt=1; break ;;
        *) prompt=$*; have_prompt=1; break ;;
    esac
done

case "$timeout" in
    '' | *[!0-9]*) echo "--timeout には秒数を整数で渡す。" >&2; exit 2 ;;
esac

if [ "$have_prompt" = 0 ]; then
    prompt=$(cat)
fi
if [ -z "$prompt" ]; then
    echo "依頼文が空である。" >&2
    exit 2
fi

# Pi がセッションを置くフォルダ名と同じ形に、作業ディレクトリを符号化する。
cwd=$(pwd -W 2> /dev/null || pwd)
encoded=${cwd#/}
encoded=${encoded//[\/\\:]/-}
session_dir="$HOME/.pi/agent/subagent-sessions/--$encoded--"
mkdir -p "$session_dir"

args=(
    -p
    --session-dir "$session_dir"
    --name "$type${description:+: $description}"
    --model "$(field model "$def")"
    --thinking "$(field thinking "$def")"
    --system-prompt "$(body "$def")"
    # 追記を空で指定して、親と共通の追記用プロンプトを Pi に読ませない。
    --append-system-prompt ""
    # 子のメモリを減らすため、権限の検査を行う pi-tool-filter 以外の拡張と MCP を読み込まない。
    --no-extensions
    --extension "$HOME/.pi/agent/extensions/pi-tool-filter/index.ts"
    --no-mcp
)
# read_only は edit と write のツールを外すだけで、bash による書き込みは防がない。
# bash で許す操作は pi-tool-filter の設定が決める。
if [ "$(field read_only "$def")" = true ]; then
    args+=(--exclude-tools "edit,write")
fi

# 子と、子が起動したプロセスをまとめて止める。
# 子の環境変数に入れた目印を持つプロセスを探して止める。親子関係やプロセスグループを
# たどる方法では、子の bash ツールが起動したプロセスに届かない。
# 止めている途中で親を失ったプロセスが残ることがあるので、目印を持つプロセスが無くなるまで 3 回まで繰り返す。
kill_run_processes() {
    local round environ pid
    for round in 1 2 3; do
        set -- $(grep -l -z -x "PI_SUBAGENT_RUN=$run_id" /proc/[0-9]*/environ 2> /dev/null)
        [ $# -eq 0 ] && return
        for environ; do
            pid=${environ#/proc/}
            pid=${pid%/environ}
            if [ -r "/proc/$pid/winpid" ]; then
                taskkill //T //F //PID "$(cat "/proc/$pid/winpid")" > /dev/null 2>&1
            else
                kill -KILL "$pid" 2> /dev/null
            fi
        done
    done
}

# 5 秒おきに次のことを確かめる。
#   - このスクリプトが居なくなった。呼び出し元の中断でスクリプトごと止められた場合。
#   - このスクリプトの親が居なくなった。Windows では、呼び出し元の中断で親の bash だけが止まり、
#     このスクリプトは走り続けることがある。
#   - 制限時間を過ぎた。
# 前の 2 つでは、子と、子が起動したプロセスを止め、このスクリプトに TERM を送る。
# 制限時間では、このスクリプトに USR1 を送って止めさせる。
# 呼び出し元の中断は trap で受けられない止め方で行われるので、別のプロセスから見張る。
watch() {
    while kill -0 "$wrapper_pid" 2> /dev/null \
        && { [ "$caller_pid" = 1 ] || kill -0 "$caller_pid" 2> /dev/null; }; do
        if [ "$SECONDS" -ge "$timeout" ]; then
            kill -USR1 "$wrapper_pid"
            return
        fi
        sleep 5
    done
    kill_run_processes
    # スクリプトが走り続けている場合は、まだ子を起動していないこともあるので、スクリプトにも止めさせる。
    kill -TERM "$wrapper_pid" 2> /dev/null
}

timed_out() {
    kill_run_processes
    echo "サブエージェントを ${timeout} 秒で停止した。途中までの記録は $session_dir にある。" >&2
    exit 124
}

interrupted() {
    kill_run_processes
    kill "$watcher" 2> /dev/null
    echo "サブエージェントを中断した。途中までの記録は $session_dir にある。" >&2
    exit 130
}

trap timed_out USR1
trap interrupted INT TERM HUP

run_id="$$-$RANDOM-$SECONDS"

# 見張りは子より先に起動する。子を起動した直後に中断されても、見張りが子を止められる。
# 呼び出し元の中断に巻き込まれないよう、使える環境では別のセッションで起動する。
watch_script="$(declare -f kill_run_processes watch); run_id='$run_id'; wrapper_pid=$$; caller_pid=$PPID; timeout=$timeout; watch"
if command -v setsid > /dev/null 2>&1; then
    setsid bash -c "$watch_script" < /dev/null > /dev/null 2>&1 &
else
    bash -c "$watch_script" < /dev/null > /dev/null 2>&1 &
fi
watcher=$!

PI_SUBAGENT_CHILD=1 PI_SUBAGENT_RUN=$run_id pi "${args[@]}" <<< "$prompt" &
child=$!

wait "$child" 2> /dev/null
status=$?
# 子が自分で終わった後は、制限時間の合図を受けても止めない。
trap '' USR1
# 子が残したプロセスも止める。
kill_run_processes
kill "$watcher" 2> /dev/null
exit "$status"
