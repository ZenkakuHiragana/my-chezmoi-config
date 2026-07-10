---
name: frame-redefinition
description: Use when a stated obstacle or problem setup is suspected to conflate layers, overclaim its applicability reach, or pose an unanswerable question as stated, and the frame itself—not the detail within it—needs re-examination rather than acceptance. Re-measures the obstacle's applicability domain, re-partitions into a mechanically solvable part / human-judgment part / residual resolvable only by collision with reality, declares the residual rather than dissolving it, and smoke-checks each redefinition for grounding and falsifiability. Not for pre-implementation readiness (use context-clarification), design-decision interviews (use grill-me), or local/public fact-finding (use investigation / public-research). 枠の健全性を疑い、障害の適用域を測り直して問題を再分割し、残差を隠さず宣言する。
---

# Frame Redefinition

与えられた問題設定や障害点の枠が健全かを疑い、不健全なら適用域を測り直して問題を再分割する。
枠内の詳細分析を代行しない。事実確認を代行しない。

## 何を移植し、何を移植しないか

この skill は、強いモデルが自発的に引き出す「枠の再定義」のうち、認識・手順・検出を外部化する。
自発的な統合密度や、どこで切るかの勘所は移植しない。したがって出力は手順を踏んだ分割であって、
一枚の応答に全手が連鎖するような密な統合ではない。その差を埋めるのが手動起動と煙検出である。

## 入力

- 問題設定（依頼、計画、設計）の本文
- 障害とされる主張（「これでは成立しない」「ここで必ず失敗する」等）とその根拠
- 既に確認済みの文脈（`investigation` / `public-research` の結果があれば含む）

## 手順

1. **発火ゲート。** 枠が本当に疑われるかを3点で確認する。
   - 障害が「全体を殺す」と主張されているが、明らかに成立している部分はないか。
   - 一つの枠内で矛盾する2つの観察があるか。
   - 問いがそのままでは答えられないか（内部状態、完全性、全称主張）。
   いずれも該当しないなら、枠は健全と判定して再定義せず、「枠内で分析せよ」と返して止まる。
   該当するものだけ次へ進む。

2. **帰属・接地チェック。** 障害の前提を1つずつ取り出し、それぞれ出典を付ける。
   出典が一次資料で確認できない前提は `unknown` と印付する。
   前提が誤っていれば障害は再定義前に溶解する場合がある。未検証前提の上に再定義を組まない。

3. **適用域の測定。** 障害の暗黙の量化域を明示する。「計画全体」なのか「特定の層」なのか。
   域が全称（どの設計も通さない等）なら、障害ではなく基準の方を棄却する。
   域が部分なら、障害が本当に当たる部分と生き残る部分に分ける。

4. **直交性の確認。** 矛盾する2観察がある場合、独立な軸の直積に分解できるか見る。
   「効いている層が違う」で矛盾が解消するなら、軸ごとに分けて扱う。

5. **問いの変換。** 答えられない問い（「知っているか」「完全か」）を、
   同じ情報要求を満たす検証可能な代理問い（「根拠を今ここで提示できるか」「各条項は検証可能か」）に置き換える。
   変換で失われる成分を明示する。

6. **再分割と残差宣言。** 問題を3つに分ける。
   - 工学で解ける部分（機械的検査、手順、構造で扱える）
   - 人間判断が必要な部分（意図、費用対効果、優先順位）
   - 現実との衝突でしか分からない部分（実行、実機、利用者手戻り。残差）
   残差を消したことにせず、名前を付けて残す。

7. **煙検出。** 自分が出した再定義のそれぞれについて2点を問う。
   - 接地: 一次資料への参照があるか。
   - 反証可能性: 何が起きたら間違いと言えるか。
   どちらも答えられない再定義は 煙 と印付し、採用しないか保留にする。
   優雅なだけで根拠のない再定義は、この skill が防ごうとしている失敗そのものだから。

## 出力

- 元フレーム: 与えられた問題設定と障害を、再定義前の形で述べたもの
- 発火ゲートの結果（枠が健全ならその旨と「枠内分析を推奨」で終了）
- 変更したフレーム要素: 適用域の縮小、軸の分離、問いの置き換えなど、枠のどこを動かしたか
- 障害の適用域の明示文
- 再分割（工学で解ける / 人間判断 / 残差）
- 各再定義の煙検出 verdict（根拠あり / 煙）
- 残差の宣言
- 枠内詳細分析への復帰先: 再定義の結果、枠内の詳細分析に戻ってよい部分。枠が健全だった場合は元フレームそのもの。

## 完了条件

- 適用域が明示されている。
- 3つの区分に再分割されている。
- 各再定義が煙検出を通過するか 煙 と印付されている。
- 残差が名前付きで明示されている（隠されていない）。

## 使わない場面

- 枠が健全で、枠内の詳細分析が正解の時。この skill は煙を増やすだけになる。
- 実作業前の準備完了判定と要件契約 → `context-clarification`
- 相互依存する設計判断の質問 → `grill-me`
- ローカル根拠・公開根拠の確認 → `investigation` / `public-research`
