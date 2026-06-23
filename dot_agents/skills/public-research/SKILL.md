---
name: public-research
description: >
  Use when current public facts, official docs, specs, release notes, standards, APIs, or upstream practices must be verified with citations, especially for unresolved public_fact items or policy changes; not when repository-local sources already answer the question. 公開根拠の確認専用。検証済み事実、注意点、出典、次の判断材料を返す。
---

# Public Research

公開情報で確認すべき事実、公式ガイド、標準、API、上流の実務を扱う。
ローカルの正本がある場合は、先に `investigation` で確認する。

## 機密保護

外部検索の前に検索語を確認する。

検索してはいけない:

- 非公開リポジトリの内容
- 未公開の識別子
- 秘密情報、内部 URL、ローカル path
- project 内部の変数名、関数名、class 名、module 名
- project 固有のエラーメッセージ

疑わしい語は公開してよい一般概念へ言い換える。
一般化できない場合は検索せず、不足している公開可能な入力を示す。

## 根拠の優先順

1. 公式文書
2. 仕様 / 標準
3. first-party release notes / vendor docs
4. upstream repositories / official issue trackers
5. original papers / canonical references
6. primary sources が弱い場合だけ、信頼できる secondary sources

## 根拠の既定値

| 必要な情報           | 最初に見る根拠                 | 補助根拠                    |
| -------------------- | ------------------------------ | --------------------------- |
| syntax / config      | official docs / spec           | vendor docs / upstream code |
| version availability | release notes / versioned docs | issues / upstream code      |
| known bug            | issue tracker / advisory       | changelog                   |
| runtime behavior     | upstream code/tests/docs       | official docs / issues      |
| rationale            | issues / PRs / discussions     | changelog / blog            |
| standard semantics   | spec / RFC                     | vendor docs                 |

## 調査手順

1. 調べる問いを短く言い直す。
2. 分類する: `FACTUAL`、`PROCEDURAL`、`CONTEXTUAL`、`GENERAL`。
3. 必要なら version/scope を固定する。
4. 必要最小限の根拠を決める。
5. private な語を含まない検索語で調べる。
6. 一次資料を先に開く。
7. 重要な主張を突き合わせる。
8. 確認済みの事実、注意点、推測を分ける。
9. 重要な根拠を引用する。

## 代替手順

検索または codesearch が使えない場合:

1. 既知の authoritative URL があれば直接 fetch。
2. 発見が必要なら DuckDuckGo または GitHub search page を fetch。
3. results page は発見にだけ使う。
4. 候補になる根拠ページを fetch。
5. 弱い場合は query の形を変える。ほぼ同じ query を繰り返さない。
6. 一次資料が見つからない場合は明示し、推測と分ける。

## 返す内容

- 回答
- 確認済みの事実
- 注意点または不確実性
- 推測または提案
- 引用
- 必要な場合は根拠の制限

## 完了チェック

- 外部調査が本当に必要だった。
- 検索語が private/internal terms を漏らしていない。
- 一次資料を優先した。
- recency-sensitive claims を確認した。
- version scope を示した。
- 事実と推測を分けた。
- 引用を付けた。
