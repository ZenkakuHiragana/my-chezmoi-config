#!/bin/sh
# Meilisearch の起動後に会話索引の設定を当てて終わる。compose の meilisearch-settings が実行する。
# 設定の正本は meilisearch-settings.json。中身が同じなら埋め込みは作り直されない。
set -eu

url=http://meilisearch:7700
index=${INDEX:-conversations}
body=/tmp/response.json

# request METHOD PATH [curl の引数...]: 応答を $body に、HTTP の応答コードを $status に置く。
request() {
  method=$1
  path=$2
  shift 2
  status=$(curl -sS -o "$body" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' "$@" "$url$path") ||
    fail "$method $path: Meilisearch に接続できない"
}

fail() {
  echo "meilisearch-settings: $1" >&2
  cat "$body" >&2 2>/dev/null || true
  echo >&2
  exit 1
}

# wait_task WHAT: 直前の応答のタスクが終わるまで待つ。succeeded 以外で終わったら失敗にする。
wait_task() {
  [ "$status" = 202 ] || fail "$1: HTTP $status"
  uid=$(sed -n 's/.*"taskUid":\([0-9][0-9]*\).*/\1/p' "$body")
  [ -n "$uid" ] || fail "$1: taskUid のない応答"
  while :; do
    request GET "/tasks/$uid"
    [ "$status" = 200 ] || fail "$1 task=$uid: HTTP $status"
    state=$(grep -o '"status":"[a-z]*"' "$body" | head -n 1 | cut -d '"' -f 4)
    case $state in
      succeeded) echo "$1 task=$uid: succeeded"; return ;;
      enqueued | processing) sleep 1 ;;
      *) fail "$1 task=$uid: $state" ;;
    esac
  done
}

tries=0
until curl -sf "$url/health" >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || fail "60 秒待っても Meilisearch が応答しない"
  sleep 1
done

# 埋め込みの indexingFragments / searchFragments は実験機能 multimodal が、
# 索引用と検索用で接続先を分ける composite は実験機能 compositeEmbedders が要る。
request PATCH /experimental-features -d '{"multimodal":true,"compositeEmbedders":true}'
[ "$status" = 200 ] || fail "experimental-features: HTTP $status"

# インデックスがなければ、設定の更新が作る。主キーは、文書を送る側が ?primaryKey=id で決める。
# 文書が先に届いてインデックスができていても、設定は後から当たる。
request PATCH "/indexes/$index/settings" --data-binary @/settings.json
wait_task "settings $index"
