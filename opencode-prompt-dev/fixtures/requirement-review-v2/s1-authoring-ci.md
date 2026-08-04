# 依頼

skill-kb ワークスペースの設定検証を CI に組み込みたい。`npm run check` が設定の静的検証を行うので、これを使ってほしい。Windows 実機の PowerShell から実行できることが必要で、WSL 側での代替実行は不可。検証が失敗したときは CI が失敗として止まること。

# 確認済みの技術制約

- `npm run check` は既存スクリプトで、終了コードで成否を返す。
- CI は GitHub Actions の windows-latest ランナーで動く。

# 作業

渡された規則文書 `rules/contract-template-rules.md` の「`要件契約`（出力契約）」の形式に従い、この依頼から意味上の義務を2〜3件持つ要件契約の「意味上の義務」表と「判断と認可」表を作成せよ。依頼から分かる範囲だけで書き、推測で埋めない。成果物は Markdown 本文のみを返す。
