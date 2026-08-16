#!/usr/bin/env python3
"""プロンプト体系の内部整合性を静的に検査する。

制御面（control surface）のバックティック識別子が、制御語彙の棚卸し（allowlist）に
登録されているか、参照先の実体が存在するかを検査し、結果を有限リストで出す。

出力:
  1. unaccounted: 制御面で参照されるが、allowlist・実体名・定義帯のいずれにも無い識別子。
  2. dangling-routing: スキル名の形で参照されるのに実体名や宣言値が見つからない識別子。
  3. dead-allowlist: allowlist にあるが corpus で使われない制御語彙。
  4. obligation-audit: 曖昧/ヘッジ義務表現の監査リスト。終了コードに影響しない。
  5. file-name-reference: 制御面で規則・手順をファイル名で参照する箇所。

原本: opencode-prompt-dev/control-vocabulary.md
使い方: python opencode-prompt-dev/check_vocabulary.py [--repo <path>] [--verbose]
終了コード: 検出があれば 1、無ければ 0。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# control surface: orchestration prompt と skill 本文。
# ルート AGENTS.md、共有テンプレート断片、プロジェクトローカルの
# エージェント・スキルも含む。concern/profile/reference は
# ドメイン内容 (言語 API 名や日本語例) を含むので参照走査から外す。
CONTROL_SURFACE_GLOBS = [
    "AGENTS.md",
    ".chezmoitemplates/opencode/AGENTS.md",
    ".chezmoitemplates/opencode/*.md",
    ".chezmoitemplates/opencode/agents/*.md",
    ".chezmoitemplates/opencode/parent/*.md",
    "dot_config/opencode/agents/*.md",
    "dot_config/opencode/agents/*.md.tmpl",
    "dot_config/opencode/commands/*.md",
    ".opencode/commands/*.md",
    ".opencode/agents/*.md",
    ".opencode/skills/*/SKILL.md",
    "dot_agents/skills/*/SKILL.md",
    "dot_agents/skills/*/SKILL.md.tmpl",
]

# 診断用の定義母集団 (control surface に加えてドメイン content も含む)。
# ここから収穫した語は制御面の語彙許可元に含める（定義済みの語は allowlist への登録を要しない）。
DEFINITION_GLOBS = CONTROL_SURFACE_GLOBS + [
    "dot_agents/skills/*/references/*.md",
    "dot_agents/skills/*/concerns/*.md",
    "dot_agents/skills/*/profiles/*.md",
    "AGENTS.md",
    "opencode-prompt-dev/*.md",
]

BACKTICK = re.compile(r"`([^`\n]+)`")
# 定義行: 箇条書き先頭の backtick token の直後が `:` / 行末 / ダッシュ の時だけ
# 値の定義とみなす。`- `token` に戻る` のような参照の列挙は定義に数えない。
DEF_BULLET = re.compile(r"^[ \t]*[-*][ \t]+`([^`\n]+)`[ \t]*(?:[:：]|[-—–]|$)", re.M)
NAME_FIELD = re.compile(r"^\s*name:\s*([A-Za-z][A-Za-z0-9-]*)\s*$", re.M)
# fenced code block の中身 (schema / enum の定義帯)。
FENCE = re.compile(r"```[^\n]*\n(.*?)```", re.S)
# code block 内の `key:` 形 schema field。
SCHEMA_KEY = re.compile(r"^\s*([a-z][a-z0-9_]*)\s*:", re.M)
# Markdown の schema field 行: `- **Parallel group**:` など。
BOLD_SCHEMA_FIELD = re.compile(
    r"^[ \t]*[-*][ \t]+\*\*([A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*)*)\*\*[ \t]*[:：]",
    re.M,
)

SKILLSHAPE = re.compile(r"^[a-z]+(?:-[a-z]+)+$")
# 制御識別子の形: ASCII。snake_case / kebab / 「Title Case の語句」。
IDENT_OK = re.compile(r"^[A-Za-z][A-Za-z0-9 _-]*$")
# コード片や path とみなす記号。
NOISE_CHAR = re.compile(r"[(){}\[\]<>=;:*$|#@+%./\\,\"']")

# 規則・手順をファイル名で参照する形。「XXX.md の〜」「XXX.md を〜」等。
# パス例示 (「例: `読取可能: ./AGENTS.md`」)、列挙 (「...AGENTS.md、...」)、
# 取り込み名 ({{ template "..." }}) は `.md` の直後に助詞が来ないため対象外。
FILE_REF = re.compile(r"[A-Za-z0-9_\-/.*]+\.md[ \t]*(の|に|を|へ|から|で)")

# 義務レベルを決めない曖昧/ヘッジ表現。
# 完全な義務文 parser ではなく、監査候補を file:line で出す有限リスト。
OBLIGATION_AMBIGUOUS_TERMS = [
    "向いている",
    "合う",
    "場合だけ",
    "使える場合だけ",
    "可能なら",
    "必要なら",
    "できれば",
    "するとよい",
    "望ましい",
]


def _obligation_term_pattern(term: str) -> re.Pattern[str]:
    # `合う` は複合動詞 (見合う / 似合う 等) の一部を義務表現と誤検出しない。
    if term == "合う":
        return re.compile(r"(?<![見似])合う")
    return re.compile(re.escape(term))


def load_files(repo: Path, globs: list[str]) -> list[Path]:
    seen: set[Path] = set()
    out: list[Path] = []
    for g in globs:
        for p in sorted(repo.glob(g)):
            if p.is_file() and p not in seen:
                seen.add(p)
                out.append(p)
    return out


def parse_allowlist(repo: Path) -> set[str]:
    path = repo / "opencode-prompt-dev" / "control-vocabulary.md"
    text = path.read_text(encoding="utf-8")
    start = text.find("## 維持する制御語彙")
    end = text.find("## 日本語化する語")
    if start == -1:
        raise SystemExit("allowlist: 「## 維持する制御語彙」が見つからない")
    section = text[start : end if end != -1 else len(text)]
    return {m.group(1) for m in BACKTICK.finditer(section)}


def entity_names(repo: Path) -> set[str]:
    names: set[str] = set()
    for sd in (repo / "dot_agents" / "skills", repo / ".opencode" / "skills"):
        if sd.is_dir():
            names |= {p.name for p in sd.glob("*") if p.is_dir()}
    dirs = [
        repo / "dot_config" / "opencode" / "agents",
        repo / ".chezmoitemplates" / "opencode" / "agents",
        repo / ".chezmoitemplates" / "opencode" / "parent",
        repo / "dot_claude" / "agents",
        repo / "dot_config" / "opencode" / "commands",
        repo / ".opencode" / "commands",
        repo / ".opencode" / "agents",
        repo / "dot_claude" / "commands",
    ]
    for d in dirs:
        if d.is_dir():
            for p in d.glob("*.md*"):
                name = re.sub(r"\.md(\.tmpl)?$", "", p.name)
                names.add(name)
    # concern / profile / reference の stem も routing 名になりうる。
    for sd in (repo / "dot_agents" / "skills", repo / ".opencode" / "skills"):
        if not sd.is_dir():
            continue
        for sub in ("concerns", "profiles", "references"):
            for p in sd.glob(f"*/{sub}/*.md"):
                names.add(p.stem)
    return names


def harvest_definitions(repo: Path, files: list[Path]) -> set[str]:
    defined: set[str] = set()
    for p in files:
        text = p.read_text(encoding="utf-8")
        for m in DEF_BULLET.finditer(text):
            defined.add(m.group(1).strip())
        for m in NAME_FIELD.finditer(text):
            defined.add(m.group(1).strip())
        for m in BOLD_SCHEMA_FIELD.finditer(text):
            defined.add(m.group(1).strip())
        # fenced code block は schema / enum の定義帯として扱う。
        for block in FENCE.finditer(text):
            body = block.group(1)
            for m in SCHEMA_KEY.finditer(body):
                defined.add(m.group(1))
    return defined


def collect_refs(repo: Path, files: list[Path]) -> dict[str, list[str]]:
    hits: dict[str, list[str]] = {}
    for p in files:
        rel = p.relative_to(repo).as_posix()
        text = p.read_text(encoding="utf-8")
        for m in BACKTICK.finditer(text):
            tok = m.group(1).strip()
            if not tok:
                continue
            hits.setdefault(tok, [])
            if rel not in hits[tok]:
                hits[tok].append(rel)
    return hits


def obligation_audit(repo: Path, files: list[Path]) -> list[tuple[str, int, str, str]]:
    """曖昧/ヘッジ義務表現の監査候補を返す。

    有限ブロックリストの単純検出であり、完全な義務文 parser ではない。
    検出結果は人間が必須 / 推奨 / 任意などの義務レベルへ分類するための
    監査リストであり、終了コードには影響させない。
    """
    patterns = [(t, _obligation_term_pattern(t)) for t in OBLIGATION_AMBIGUOUS_TERMS]
    rows: list[tuple[str, int, str, str]] = []
    for p in files:
        rel = p.relative_to(repo).as_posix()
        for lineno, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            spans = [
                (m.start(), m.end(), term)
                for term, pat in patterns
                for m in pat.finditer(line)
            ]
            # 同一行で長い語が短い語を包含する二重カウントを、最長一致で畳む。
            for i, s in enumerate(spans):
                covered = any(
                    j != i
                    and o[0] <= s[0]
                    and o[1] >= s[1]
                    and (o[1] - o[0]) > (s[1] - s[0])
                    for j, o in enumerate(spans)
                )
                if not covered:
                    rows.append((rel, lineno, s[2], line.strip()))
    return rows


def file_reference_audit(repo: Path, files: list[Path]) -> list[tuple[str, int, str]]:
    """規則・手順をファイル名で参照する箇所を返す。

    制御面のテキストで「XXX.md の〜」「XXX.md を〜」のような、ファイル名に
    助詞が続く形を検出する。文脈に積まれた指示がどのファイルから来たか
    はハーネス実装依存で保証されないため、実行エージェントはファイル名が指す
    内容を特定できず、規則・手順の参照には使ってはならない。
    「〜.md」で終わるパス例示、列挙、取り込み名は対象外。
    """
    rows: list[tuple[str, int, str]] = []
    for p in files:
        rel = p.relative_to(repo).as_posix()
        for lineno, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            for m in FILE_REF.finditer(line):
                rows.append((rel, lineno, m.group(0)))
    return rows


def is_identifier(tok: str) -> bool:
    if NOISE_CHAR.search(tok):
        return False
    if len(tok) < 2:
        return False
    if not tok.isascii():
        if "。" in tok or "、" in tok:
            return False
        return True
    if not IDENT_OK.match(tok):
        return False
    return True


def main() -> int:
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=".")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    repo = Path(args.repo).resolve()

    allowlist = parse_allowlist(repo)
    entities = entity_names(repo)
    def_files = load_files(repo, DEFINITION_GLOBS)
    allowlist_path = (repo / "opencode-prompt-dev" / "control-vocabulary.md").resolve()
    dead_ref_files = [p for p in def_files if p.resolve() != allowlist_path]
    surface_files = load_files(repo, CONTROL_SURFACE_GLOBS)

    harvested_definitions = harvest_definitions(repo, def_files)
    surface_refs = collect_refs(repo, surface_files)
    dead_refs = collect_refs(repo, dead_ref_files)

    # 1. unaccounted: allowlist・実体名・定義帯のいずれにも無い参照。
    unaccounted: dict[str, list[str]] = {}
    for tok, locs in surface_refs.items():
        if tok in allowlist or tok in entities or tok in harvested_definitions:
            continue
        if not is_identifier(tok):
            continue
        unaccounted[tok] = locs

    # 2. dangling routing: kebab 形の参照先が、実体名にも宣言値にも無い疑い。
    declared_for_routing = harvested_definitions | allowlist | entities
    dangling = {
        t: l
        for t, l in surface_refs.items()
        if is_identifier(t) and SKILLSHAPE.match(t) and t not in declared_for_routing
    }

    # 3. dead allowlist: 制御語彙だが allowlist 自身以外で未使用。
    # allowlist は全登録語を backtick で列挙するため、参照母集団に含めると
    # 自己参照だけで全語が使用済みになり、dead 判定が常に 0 件へ潰れる。
    dead = sorted(t for t in allowlist if t not in dead_refs)

    # 4. 義務曖昧表現: 監査リスト。終了コードには含めない。
    obligation_rows = obligation_audit(repo, surface_files)

    # 5. ファイル名参照: 規則・手順をファイル名で参照する箇所。
    file_ref_rows = file_reference_audit(repo, surface_files)

    def dump(title: str, rows: dict[str, list[str]]) -> None:
        print(f"\n## {title} ({len(rows)})")
        for tok in sorted(rows):
            locs = rows[tok]
            shown = ", ".join(locs[:8]) + (" ..." if len(locs) > 8 else "")
            print(f"  `{tok}`  [{len(locs)} files]  {shown}")

    print("# vocabulary check")
    print(
        f"control-surface files: {len(surface_files)} / "
        f"definition-corpus files: {len(def_files)}"
    )
    print(
        f"allowlist: {len(allowlist)} / entities: {len(entities)} / "
        f"harvested-definitions-not-allowing: {len(harvested_definitions)}"
    )

    dump("unaccounted backtick identifiers (allowlist-only)", unaccounted)
    dump("dangling skill/capability routing targets", dangling)
    print(f"\n## dead allowlist entries ({len(dead)})")
    for t in dead:
        print(f"  `{t}`")

    print(f"\n## obligation ambiguity audit ({len(obligation_rows)})")
    for rel, lineno, term, line in obligation_rows:
        print(f"  {rel}:{lineno}: `{term}`  {line}")

    print(f"\n## file-name reference audit ({len(file_ref_rows)})")
    for rel, lineno, match in file_ref_rows:
        print(f"  {rel}:{lineno}: {match}")

    total = len(unaccounted) + len(dead) + len(file_ref_rows)
    print(
        f"\n# unaccounted: {len(unaccounted)} / dangling: {len(dangling)} "
        f"/ dead: {len(dead)} "
        f"/ obligation-audit: {len(obligation_rows)} / file-ref: {len(file_ref_rows)}"
    )
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
