# コードレビュー

コードまたは差分について、実際の利用経路と実行環境で成立する欠陥を検査する。
コードの挙動に直接関係する設定、スキーマ、生成物、テストなども、必要に応じて検査対象との関係を辿って確認する。

検査観点が指定されていない場合はすべての観点を検査対象にする。
対象の言語または基盤に対応する補足事項がある場合は、該当するものをすべて適用する。

## 検査方法

検査すべき観点に従って問題が存在しうる箇所を探し、その定義から実際の利用側と検証まで必要な範囲を追う。

正常時の経路だけで判断せず、対象に関係する境界条件、空や重複した入力、失敗と再試行、並行実行、終了処理、互換性など、通常と異なる状態で挙動が変わる経路も確認する。

観点に示された構造やパターンを見つけた場合は、実際の入力、状態、規模、呼び出し経路、実行環境と照合する。その条件で利用者から見える結果や内部の不変条件が実際に壊れる場合に問題として扱う。

## 検査観点

- [正しさ](concerns/correctness.md)
- [仕様照合](concerns/spec-conformance.md)
- [資源寿命](concerns/resource-lifecycle.md)
- [並行処理と非同期](concerns/concurrency-and-async.md)
- [セキュリティとプライバシー](concerns/security.md)
- [互換性と移行](concerns/compatibility-and-migration.md)
- [依存関係](concerns/dependencies.md)
- [複雑さ](concerns/complexity.md)
- [性能](concerns/performance.md)
- [観測性と運用性](concerns/observability-and-operability.md)
- [保守性と慣用表現](concerns/maintainability-idioms.md)
- [責務境界](concerns/responsibility-boundaries.md)
- [コメントと文書](concerns/comments-and-docs.md)
- [ビルドと配布](concerns/build-and-distribution.md)
- [テスト品質](concerns/test-quality.md)
- [テスト網羅](concerns/tests.md)
- [最小性と意図性](concerns/minimality-and-intentionality.md)

## 言語・基盤別の補足

検査対象に該当する補足を適用する。複数に該当する場合はそれぞれを適用する。

- [C++ と CMake](profiles/cpp-cmake.md)
- [C# と .NET](profiles/csharp-dotnet.md)
- [Lua](profiles/lua-generic.md)
- [Lua と Neovim](profiles/lua-neovim.md)
- [Python](profiles/python.md)
- [Rust と Cargo](profiles/rust-cargo.md)
- [シェル](profiles/shell.md)
