# コードレビュー

コードまたは差分を読み、仕様、利用経路、実行環境、言語、依存関係と照合して、実際に起きる欠陥だけを指摘する。対象を編集せず、設計の好みや一般論を破綻として返さない。

## 境界

レビュー対象はコード、差分、コードに直接結び付く設定・スキーマ・生成物・テストである。文章の自然さ、設計案の比較、実装の編集、未確認の要件決定は行わない。コードが実行する利用者向け文言の意味を確認する場合も、コードの挙動と結果との一致だけを扱う。

対象の一部、依存先、実行環境、テストを読めない場合は、その範囲の無欠陥を主張せず、未確認の範囲と理由を返す。

## 検査観点

以下は利用可能な検査観点である。対象・目的・差分との関係を確認し、必要な観点だけを適用する。

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

対象に該当する補足を実施する。該当しない補足は適用しない。

- [C++ と CMake](profiles/cpp-cmake.md)
- [C# と .NET](profiles/csharp-dotnet.md)
- [Lua](profiles/lua-generic.md)
- [Lua と Neovim](profiles/lua-neovim.md)
- [Python](profiles/python.md)
- [Rust と Cargo](profiles/rust-cargo.md)
- [シェル](profiles/shell.md)

## コード固有の入力

- 対象言語、実行時基盤、ビルド・配布方法
- 検査する観点。指定がなければ、全観点を必須にせず、対象・目的・差分に実質的に関係する観点だけを選ぶ。全観点を確認する場合は明示する

## コード固有の手順

1. 正常、境界、空、重複、失敗、再試行、並行、終了、互換の経路を追う。
2. 対象に該当する言語・基盤別の補足を適用する。

## コード固有の完了条件

- 該当する言語・基盤別の補足を検査した。
