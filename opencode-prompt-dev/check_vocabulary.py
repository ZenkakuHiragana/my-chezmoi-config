#!/usr/bin/env python3
"""プロンプト体系の内部整合性を静的に検査する。

要件捕捉とは独立した、体系それ自体の整合検査。「参照 vs 定義」モデルで、
制御識別子が定義されないまま参照されている箇所を有限リストで出す。

定義 (definition) とみなす位置:
  - allowlist (english-token-allowlist.md の維持制御語彙)
  - filesystem の実体名 (skill dir / agent / command / concern / profile / reference)
  - skill frontmatter の `name:` 値
  - enumeration 行 `- `TOKEN`` または `- `TOKEN`: ...` (値の列挙・定義)
参照 (reference): それ以外の backtick 出現。

出力:
  1. unaccounted: control surface で参照されるが、上のどの定義にも無い識別子。
     未定義・多義・allowlist 漏れの候補。
  2. dangling-routing: skill 名の形 (kebab) で参照されるのに、対応する skill が
     どこにも定義されていない識別子。routing 先が実在しない疑い。
  3. dead-allowlist: allowlist にあるが corpus のどこでも使われない制御語彙。
  4. obligation-audit: 曖昧/ヘッジ義務表現の監査リスト。
     有限ブロックリストで候補を拾うだけで、完全な義務文 parser ではない。
     この監査リストは終了コードに影響しない。

正本: opencode-prompt-dev/english-token-allowlist.md
使い方: python opencode-prompt-dev/check_vocabulary.py [--repo <path>] [--verbose]
終了コード: 検出があれば 1、無ければ 0。
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# control surface: orchestration prompt と skill 本文。
# 制御識別子の整合がもっとも効く層。concern/profile/reference は
# ドメイン内容 (言語 API 名や日本語例) を含むので参照走査から外す。
CONTROL_SURFACE_GLOBS = [
    ".chezmoitemplates/opencode/AGENTS.md",
    ".chezmoitemplates/opencode/agents/*.md",
    ".chezmoitemplates/opencode/parent/*.md",
    "dot_config/opencode/agents/*.md",
    "dot_config/opencode/agents/*.md.tmpl",
    "dot_config/opencode/commands/*.md",
    ".opencode/commands/*.md",
    "dot_agents/skills/*/SKILL.md",
    "dot_agents/skills/*/SKILL.md.tmpl",
]

# 定義の母集団 (control surface に加えてドメイン content も含む)。
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
    path = repo / "opencode-prompt-dev" / "english-token-allowlist.md"
    text = path.read_text(encoding="utf-8")
    start = text.find("## 維持する制御語彙")
    end = text.find("## 日本語化する語")
    if start == -1:
        raise SystemExit("allowlist: 「## 維持する制御語彙」が見つからない")
    section = text[start : end if end != -1 else len(text)]
    return {m.group(1) for m in BACKTICK.finditer(section)}


def entity_names(repo: Path) -> set[str]:
    names: set[str] = set()
    skills_dir = repo / "dot_agents" / "skills"
    if skills_dir.is_dir():
        names |= {p.name for p in skills_dir.glob("*") if p.is_dir()}
    dirs = [
        repo / "dot_config" / "opencode" / "agents",
        repo / ".chezmoitemplates" / "opencode" / "agents",
        repo / ".chezmoitemplates" / "opencode" / "parent",
        repo / "dot_claude" / "agents",
        repo / "dot_config" / "opencode" / "commands",
        repo / ".opencode" / "commands",
        repo / "dot_claude" / "commands",
    ]
    for d in dirs:
        if d.is_dir():
            for p in d.glob("*.md*"):
                name = re.sub(r"\.md(\.tmpl)?$", "", p.name)
                names.add(name)
    # concern / profile / reference の stem も routing 名になりうる。
    for sub in ("concerns", "profiles", "references"):
        for p in skills_dir.glob(f"*/{sub}/*.md"):
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


def classification_consistency(repo: Path) -> dict[str, str]:
    """AGENTS.md の分類定義が context-clarification に反映されているか。

    `### 文脈状態` と `### 不足の分類と解消` で定義された分類トークンが、
    context-clarification SKILL.md で参照されているかを確認する。理論
    (AGENTS.md) に分類を足して手順 (skill) へ反映し忘れる方向のドリフトを
    機械的に捕まえる。戻り値: 反映漏れトークン -> 定義元 section。
    """
    agents = repo / ".chezmoitemplates" / "opencode" / "AGENTS.md"
    skill = repo / "dot_agents" / "skills" / "context-clarification" / "SKILL.md"
    if not agents.is_file() or not skill.is_file():
        return {}
    sections = {"### 文脈状態", "### 不足の分類と解消"}
    canonical: dict[str, str] = {}
    current: str | None = None
    for line in agents.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("#"):
            current = s if s in sections else None
            continue
        if current:
            m = DEF_BULLET.match(line)
            if m:
                canonical[m.group(1).strip()] = current
    skill_tokens = {
        m.group(1).strip() for m in BACKTICK.finditer(skill.read_text(encoding="utf-8"))
    }
    return {tok: sec for tok, sec in canonical.items() if tok not in skill_tokens}


def is_identifier(tok: str) -> bool:
    if not tok.isascii():
        return False
    if NOISE_CHAR.search(tok):
        return False
    if not IDENT_OK.match(tok):
        return False
    if len(tok) < 2:
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
    surface_files = load_files(repo, CONTROL_SURFACE_GLOBS)

    defined = harvest_definitions(repo, def_files) | allowlist | entities
    surface_refs = collect_refs(repo, surface_files)
    all_refs = collect_refs(repo, def_files)

    # 1. unaccounted: 識別子の形なのに定義が無い参照。
    unaccounted: dict[str, list[str]] = {}
    for tok, locs in surface_refs.items():
        if tok in defined:
            continue
        if not is_identifier(tok):
            continue
        unaccounted[tok] = locs

    # 2. dangling routing: kebab 形の未定義参照 (routing 先が実在しない疑い)。
    dangling = {t: l for t, l in unaccounted.items() if SKILLSHAPE.match(t)}

    # 3. dead allowlist: 制御語彙だがどこでも未使用。
    dead = sorted(t for t in allowlist if t not in all_refs)

    # 4. 分類ドリフト: AGENTS.md の分類定義が context-clarification に未反映。
    drift = classification_consistency(repo)

    # 5. 義務曖昧表現: 監査リスト。終了コードには含めない。
    obligation_rows = obligation_audit(repo, surface_files)

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
        f"defined-total: {len(defined)}"
    )

    dump("unaccounted backtick identifiers", unaccounted)
    dump("dangling skill/capability routing targets", dangling)
    print(f"\n## dead allowlist entries ({len(dead)})")
    for t in dead:
        print(f"  `{t}`")

    print(
        f"\n## classification drift "
        f"(AGENTS.md defined, missing in context-clarification) ({len(drift)})"
    )
    for tok in sorted(drift):
        print(f"  `{tok}`  <- {drift[tok]}")

    print(f"\n## obligation ambiguity audit ({len(obligation_rows)})")
    for rel, lineno, term, line in obligation_rows:
        print(f"  {rel}:{lineno}: `{term}`  {line}")

    total = len(unaccounted) + len(dead) + len(drift)
    print(
        f"\n# unaccounted: {len(unaccounted)} / dangling: {len(dangling)} "
        f"/ dead: {len(dead)} / drift: {len(drift)} "
        f"/ obligation-audit: {len(obligation_rows)}"
    )
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
