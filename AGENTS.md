# このリポジトリについて

このリポジトリは [chezmoi](https://www.chezmoi.io/reference) を用いた個人設定管理用データである。

## ソースと実際の設定ファイルとの関係

chezmoi の管理下にあるファイルはユーザーホームディレクトリ以下に展開される。

- 例: `./dot_config/**` → `~/.config/**`
- [`readonly_` や `run_onchange_` など特定のスネークケース識別子で特別な効果を表すことがある。](https://www.chezmoi.io/user-guide/frequently-asked-questions/design/#why-does-chezmoi-use-weird-filenames)
- [`./.chezmoitemplates/` と `*.tmpl` ファイルを組み合わせたテンプレート展開が行われる。](https://www.chezmoi.io/user-guide/templating/)

## AI 委任のためのスキル等の構成

通常の個人設定の他に、スキルやシステムプロンプトなど、AI 委任のための環境整備が存在する。

最も大きな目的は、AI へ作業を委任したときに生じる不都合を少ない検証労力で確認することである。
人間の確認を受け入れ可否の判断に必要な範囲へ絞り、作業の委任を成立させる。
そのために、プロンプト、実行基盤、権限、根拠収集、検証、記録を組み合わせる。

## リポジトリ全体のパスと責務

- `./AGENTS.md` はこのリポジトリそのものの目的、構成、責務、作業方針等を定める。
- `./docs/` には AI 委任で起きる問題の分析、設計原理、プロンプト保守の資料がある。
- `./.chezmoidata/` には`*.tmpl` 形式のテンプレートファイルから参照できる構造化データを構成する。複数の JSONC ファイルが統合された単一の JSON オブジェクトとして参照される。
- `./.chezmoitemplates/` には複数の実行環境で共有するテンプレート断片がある。
- `./.chezmoi.toml.tmpl` は chezmoi 自体の設定ファイルである。
- `./.chezmoiignore` はこのリポジトリの管理下であって chezmoi の設定項目ではないものを `.gitignore` と同様の形式で記述する。
  - `chezmoi init --no-tty --error-on-conflict` で適用できる。`
- `./dot_agents/skills/` には実行環境で利用するスキルがある。現在のセッションで実際に利用するには `chezmoi apply 配置先の具体的なファイル名`
- `./dot_config/` には各種ツールの設定ソースを置く。
  - ツールによっては対応する設定が Windows では `~/AppData/Local/` 以下や `~/AppData/Roaming/` 以下から参照する場合がある。
  - 新規に設定を配置する場合は必ず OS ごとの配置先を確認する。
  - OS ごとに展開先が異なる場合は共通の設定を `./.chezmoitemplates/` 以下に配置し、展開先となるパスには `*.tmpl` 形式のテンプレート参照形式で同一の設定となるよう構成する。その場合でも、片方の OS でしか有効にならない設定は無理に共通化せず、OS ごとの `*.tmpl` ファイルに直接 OS 固有の設定を書く。
  - Linux でのみ、または Windows でのみ動作するツールの設定は共通化しない。ただし共通化により保守性に関する特段のメリットが得られる場合はこの限りではない。
- `./dot_claude/`、`./dot_codex/`、`./dot_omp/`、`./dot_pi/`、`./dot_copilot/`、`./dot_config/opencode/` には AI ハーネス実行環境ごとの設定項目がある。
  - 共通する概念を設定する場合は `./.chezmoidata/` 以下のデータに集約するか `./.chezmoitemplates/` 以下の共通ファイルに書き、設定ファイル本体はそれらの設定の参照とする。
- `./.claude/`, `./.codex/`, `./.omp/`, `./.pi/`, `./.copilot/`, `./.opencode/` にはこのリポジトリでのみ作用する AI ハーネス実行環境ごとのプロジェクトローカル設定や一時ファイルがある。
  - `./.opencode/work/` には作業用の一時ファイルがある。
  - `./.opencode/local-failure-logs/` には過去の失敗の記録が蓄積される。
- `run_onchange_*` は、`chezmoi apply` を実行した後に自動的に実行されるスクリプトファイルである。
  - 形式を変換して AI ハーネス実行環境ごとの設定に合わせる、自作拡張機能の依存関係を同期するなど、単なるファイルの配置だけでは得られない同期結果を得るために使う。
- `./packages/` にはパッケージマネージャで一括インストールしたいパッケージの一覧がある。
- `./scripts/` には chezmoi の機能だけでは実現しにくい環境設定用スクリプトがある。
- `./tools/skill-kb/` は、情報源の利用方法を案内する skill-kb MCP サーバーの実装である。

## 変更の適用

- **この作業ディレクトリで実行する。他の場所に移動すると想定と異なる結果となる。**
- `chezmoi status` で `git status --porcelain` 相当の表示方法による変更対象ファイル一覧が得られる。
- `chezmoi diff --no-pager 適用先のファイルパス` で `git diff` 相当の変更差分表示を特定のファイルについて得られる。
- `chezmoi apply --dry-run 適用先のファイルパス` で変更の適用が可能であるか検証できる。テンプレート展開エラーが出たらここで分かる。
- `chezmoi apply --no-tty --error-on-conflict 適用先のファイルパス` で実際に展開できる。適用先で別の変更がある場合はエラーとなる。
- `chezmoi apply --no-tty --force 適用先のファイルパス` で適用先で別の変更があっても無視して実際に展開し、上書きする。 **これをやる場合は必ずユーザーの明示的な承認を得る。**
