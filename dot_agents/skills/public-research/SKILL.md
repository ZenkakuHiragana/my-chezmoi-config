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
- プロジェクト内部の変数名、関数名、class 名、module 名
- プロジェクト固有のエラーメッセージ

疑わしい語は公開してよい一般概念へ言い換える。
一般化できない場合は検索せず、不足している公開可能な入力を示す。

## 根拠の優先順

1. 公式文書
2. 仕様 / 標準
3. 一次提供元のリリースノート / 提供元文書
4. 上流 repository / 公式 issue tracker
5. 原論文 / 標準的な reference
6. 一次資料が弱い場合だけ、信頼できる二次資料

## 根拠の既定値

| 必要な情報         | 最初に見る根拠                    | 補助根拠               |
| ------------------ | --------------------------------- | ---------------------- |
| 構文 / config      | 公式文書 / 仕様                   | 提供元文書 / 上流 code |
| version の利用可否 | リリースノート / version 付き文書 | issue / 上流 code      |
| 既知の不具合       | 課題管理 / advisory               | 変更履歴               |
| runtime の挙動     | 上流 code / test / docs           | 公式文書 / issue       |
| 理由               | issue / PR / discussion           | 変更履歴 / blog        |
| 標準の意味         | 仕様 / RFC                        | 提供元文書             |

## 調査手順

1. 調べる問いを短く言い直す。
2. 分類する: 事実確認、手順確認、文脈確認、一般確認。
3. 必要なら版と範囲を固定する。
4. 必要最小限の根拠を決める。
5. 非公開の語を含まない検索語で調べる。
6. 一次資料を先に開く。
7. 重要な主張を突き合わせる。
8. 確認済みの事実、注意点、推測を分ける。
9. 重要な根拠を引用する。

## 代替手順

検索またはコード検索が使えない場合:

1. 既知の authoritative URL があれば直接取得する。
2. 発見が必要なら DuckDuckGo または GitHub の検索ページを取得する。
3. 検索結果ページは発見にだけ使う。
4. 候補になる根拠ページを取得する。
5. 弱い場合は検索語の形を変える。ほぼ同じ検索語を繰り返さない。
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
- 検索語が非公開または内部の語を漏らしていない。
- 一次資料を優先した。
- 最新性が効く主張を確認した。
- 版の範囲を示した。
- 事実と推測を分けた。
- 引用を付けた。
