#!/usr/bin/env python3
"""プロンプト体系の内部整合性を静的に検査する。

スキル・プロンプトの配置を対象リポジトリから発見し、制御面のバックティック識別子、
allowlist、参照先の実体、曖昧な義務表現、ファイル名参照を検査する。

出力:
  1. unaccounted: 制御面で参照されるが、allowlist・実体名・定義帯のいずれにも無い識別子。
  2. dangling-routing: スキル名の形で参照されるのに実体名や宣言値が見つからない識別子。
  3. dead-allowlist: allowlist にあるが corpus で使われない制御語彙。
  4. obligation-audit: 曖昧/ヘッジ義務表現の監査リスト。終了コードに影響しない。
  5. file-name-reference: 制御面で規則・手順をファイル名で参照する箇所。

原本: `prompt-work` スキルの関連文書にある control-vocabulary.md
使い方: python check_vocabulary.py [--repo <path>] [--verbose]
終了コード: 検出があれば 1、無ければ 0。
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

BACKTICK = re.compile(r"`([^`\n]+)`")
# 定義行: 箇条書き先頭の backtick token の直後が `:` / 行末 / ダッシュの時だけ
# 値の定義とみなす。参照の列挙は定義に数えない。
DEF_BULLET = re.compile(r"^[ \t]*[-*][ \t]+`([^`\n]+)`[ \t]*(?:[:：]|[-—–]|$)", re.M)
NAME_FIELD = re.compile(r"^\s*name:\s*([A-Za-z][A-Za-z0-9-]*)\s*$", re.M)
# fenced code block の中身 (schema / enum の定義帯)。
FENCE = re.compile(r"```[^\n]*\n(.*?)```", re.S)
SCHEMA_KEY = re.compile(r"^\s*([a-z][a-z0-9_]*)\s*:", re.M)
BOLD_SCHEMA_FIELD = re.compile(
    r"^[ \t]*[-*][ \t]+\*\*([A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*)*)\*\*[ \t]*[:：]",
    re.M,
)

SKILLSHAPE = re.compile(r"^[a-z]+(?:-[a-z]+)+$")
IDENT_OK = re.compile(r"^[A-Za-z][A-Za-z0-9 _-]*$")
NOISE_CHAR = re.compile(r"[(){}\[\]<>=;:*$|#@+%./\\,\"']")

# 規則・手順をファイル名で参照する形。「XXX.md の〜」「XXX.md を〜」等。
FILE_REF = re.compile(r"[A-Za-z0-9_\-/.*]+\.md[ \t]*(の|に|を|へ|から|で)")

# 義務レベルを決めない曖昧/ヘッジ表現。
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

# 実行時の複製先（例: `.claude/skills`）は検査対象に含めず、
# source tree のスキル容器だけを同じ探索規則で扱う。
SKILL_CONTAINER_NAMES = (".agents", "dot_agents", ".opencode")
DIAGNOSTIC_LABELS = frozenset({"unaccounted", "dangling", "dead", "file-ref"})
# chezmoi の source tree には設定対象と管理用資料が同居するため、
# 共通プロンプトのディレクトリはその識別用ファイルから発見する。
PROMPT_TEMPLATE_MARKERS = ("common.md", "AGENTS.md")


@dataclass(frozen=True)
class SkillDirectory:
    path: Path
    manifests: tuple[Path, ...]


def _obligation_term_pattern(term: str) -> re.Pattern[str]:
    # `合う` は複合動詞 (見合う / 似合う 等) の一部を義務表現と誤検出しない。
    if term == "合う":
        return re.compile(r"(?<![見似])合う")
    return re.compile(re.escape(term))


def _sorted_unique(paths: Iterable[Path]) -> list[Path]:
    return sorted(set(paths), key=lambda p: p.as_posix())


def _directories(path: Path) -> list[Path]:
    if not path.is_dir():
        return []
    return sorted(
        (p for p in path.iterdir() if p.is_dir()),
        key=lambda p: p.as_posix(),
    )


def _is_markdown(path: Path) -> bool:
    return path.name.endswith((".md", ".md.tmpl"))


def _markdown_files(path: Path) -> list[Path]:
    if not path.is_dir():
        return []
    return sorted(
        (p for p in path.rglob("*") if p.is_file() and _is_markdown(p)),
        key=lambda p: p.as_posix(),
    )


def _skill_roots(repo: Path) -> list[Path]:
    return _sorted_unique(
        repo / container / "skills"
        for container in SKILL_CONTAINER_NAMES
        if (repo / container / "skills").is_dir()
    )


def discover_skills(repo: Path) -> list[SkillDirectory]:
    skills: list[SkillDirectory] = []
    for root in _skill_roots(repo):
        for path in _directories(root):
            manifests = tuple(
                candidate
                for candidate in (path / "SKILL.md", path / "SKILL.md.tmpl")
                if candidate.is_file()
            )
            skills.append(SkillDirectory(path=path, manifests=manifests))
    return sorted(skills, key=lambda skill: skill.path.as_posix())


def _declared_name(path: Path) -> str | None:
    text = path.read_text(encoding="utf-8")
    match = NAME_FIELD.search(text)
    return match.group(1).strip() if match else None


def find_allowlist(skills: list[SkillDirectory]) -> Path:
    prompt_work = [
        skill
        for skill in skills
        if any(_declared_name(manifest) == "prompt-work" for manifest in skill.manifests)
    ]
    if len(prompt_work) != 1:
        raise SystemExit(
            "allowlist: `name: prompt-work` のスキルを一意に特定できない"
        )
    path = prompt_work[0].path / "references" / "control-vocabulary.md"
    if not path.is_file():
        raise SystemExit(f"allowlist: {path} が見つからない")
    return path.resolve()


def parse_allowlist(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    start = text.find("## 維持する制御語彙")
    end = text.find("## 日本語化する語")
    if start == -1:
        raise SystemExit("allowlist: 「## 維持する制御語彙」が見つからない")
    section = text[start : end if end != -1 else len(text)]
    return {m.group(1) for m in BACKTICK.finditer(section)}


def _prompt_template_roots(repo: Path) -> list[Path]:
    parent = repo / ".chezmoitemplates"
    return [
        path
        for path in _directories(parent)
        if any((path / marker).is_file() for marker in PROMPT_TEMPLATE_MARKERS)
    ]


def _configured_document_files(repo: Path, kind: str) -> list[Path]:
    directories: list[Path] = []
    opencode = repo / ".opencode" / kind
    if opencode.is_dir():
        directories.append(opencode)

    config_root = repo / "dot_config"
    directories.extend(
        path / kind
        for path in _directories(config_root)
        if (path / kind).is_dir()
    )

    return _sorted_unique(
        path
        for directory in directories
        for path in directory.iterdir()
        if path.is_file() and _is_markdown(path)
    )


def discover_surface_files(
    repo: Path, skills: list[SkillDirectory]
) -> list[Path]:
    paths: list[Path] = []
    root_agents = repo / "AGENTS.md"
    if root_agents.is_file():
        paths.append(root_agents)

    for root in _prompt_template_roots(repo):
        paths.extend(_markdown_files(root))
    for kind in ("agents", "commands"):
        paths.extend(_configured_document_files(repo, kind))
    for skill in skills:
        paths.extend(skill.manifests)

    return _sorted_unique(paths)


def discover_definition_files(
    surface_files: list[Path], skills: list[SkillDirectory]
) -> list[Path]:
    paths = list(surface_files)
    for skill in skills:
        paths.extend(_markdown_files(skill.path))
    return _sorted_unique(paths)


def _without_markdown_suffix(path: Path) -> str:
    if path.name.endswith(".md.tmpl"):
        return path.name[: -len(".md.tmpl")]
    if path.name.endswith(".md"):
        return path.name[: -len(".md")]
    return path.name


def entity_names(
    surface_files: list[Path], skills: list[SkillDirectory]
) -> set[str]:
    names = {skill.path.name for skill in skills}
    for path in surface_files:
        if path.parent.name in {"agents", "commands"}:
            names.add(_without_markdown_suffix(path))
    for skill in skills:
        for subdirectory in ("concerns", "profiles", "references"):
            names.update(
                _without_markdown_suffix(path)
                for path in _markdown_files(skill.path / subdirectory)
            )
    return names


def harvest_definitions(repo: Path, files: list[Path]) -> set[str]:
    defined: set[str] = set()
    for path in files:
        text = path.read_text(encoding="utf-8")
        for match in DEF_BULLET.finditer(text):
            defined.add(match.group(1).strip())
        for match in NAME_FIELD.finditer(text):
            defined.add(match.group(1).strip())
        for match in BOLD_SCHEMA_FIELD.finditer(text):
            defined.add(match.group(1).strip())
        for block in FENCE.finditer(text):
            for match in SCHEMA_KEY.finditer(block.group(1)):
                defined.add(match.group(1))
    return defined


def collect_refs(repo: Path, files: list[Path]) -> dict[str, list[str]]:
    hits: dict[str, list[str]] = {}
    for path in files:
        relative = path.relative_to(repo).as_posix()
        text = path.read_text(encoding="utf-8")
        for match in BACKTICK.finditer(text):
            token = match.group(1).strip()
            if not token:
                continue
            hits.setdefault(token, [])
            if relative not in hits[token]:
                hits[token].append(relative)
    return hits


def obligation_audit(
    repo: Path, files: list[Path]
) -> list[tuple[str, int, str, str]]:
    """曖昧/ヘッジ義務表現を file:line の監査候補として返す。"""
    patterns = [(term, _obligation_term_pattern(term)) for term in OBLIGATION_AMBIGUOUS_TERMS]
    rows: list[tuple[str, int, str, str]] = []
    for path in files:
        relative = path.relative_to(repo).as_posix()
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            spans = [
                (match.start(), match.end(), term)
                for term, pattern in patterns
                for match in pattern.finditer(line)
            ]
            for index, span in enumerate(spans):
                covered = any(
                    other_index != index
                    and other[0] <= span[0]
                    and other[1] >= span[1]
                    and (other[1] - other[0]) > (span[1] - span[0])
                    for other_index, other in enumerate(spans)
                )
                if not covered:
                    rows.append((relative, lineno, span[2], line.strip()))
    return rows


def file_reference_audit(
    repo: Path, files: list[Path]
) -> list[tuple[str, int, str]]:
    """制御面で規則・手順をファイル名で参照する箇所を返す。"""
    rows: list[tuple[str, int, str]] = []
    for path in files:
        relative = path.relative_to(repo).as_posix()
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for match in FILE_REF.finditer(line):
                rows.append((relative, lineno, match.group(0)))
    return rows


def is_identifier(token: str) -> bool:
    if NOISE_CHAR.search(token):
        return False
    if len(token) < 2:
        return False
    if not token.isascii():
        if "。" in token or "、" in token:
            return False
        return True
    return bool(IDENT_OK.match(token))


def main() -> int:
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    repo = Path(args.repo).resolve()
    if not repo.is_dir():
        raise SystemExit(f"repo: {repo} が見つからない")

    skills = discover_skills(repo)
    allowlist_path = find_allowlist(skills)
    allowlist = parse_allowlist(allowlist_path)
    surface_files = discover_surface_files(repo, skills)
    definition_files = discover_definition_files(surface_files, skills)
    entities = entity_names(surface_files, skills)
    dead_ref_files = [
        path
        for path in definition_files
        if path.resolve() != allowlist_path
    ]

    harvested_definitions = harvest_definitions(repo, definition_files)
    surface_refs = collect_refs(repo, surface_files)
    dead_refs = collect_refs(repo, dead_ref_files)

    # 1. allowlist・実体名・定義帯のいずれにも無い制御面の参照。
    unaccounted: dict[str, list[str]] = {}
    for token, locations in surface_refs.items():
        if (
            token in allowlist
            or token in DIAGNOSTIC_LABELS
            or token in entities
            or token in harvested_definitions
        ):
            continue
        if is_identifier(token):
            unaccounted[token] = locations

    # 2. kebab 形の参照先が、実体名にも宣言値にも無い疑い。
    declared_for_routing = (
        harvested_definitions | allowlist | entities | DIAGNOSTIC_LABELS
    )
    dangling = {
        token: locations
        for token, locations in surface_refs.items()
        if is_identifier(token)
        and SKILLSHAPE.match(token)
        and token not in declared_for_routing
    }

    # 3. allowlist 自身を除く定義母集団で未使用の制御語彙。
    dead = sorted(token for token in allowlist if token not in dead_refs)

    obligation_rows = obligation_audit(repo, surface_files)
    file_ref_rows = file_reference_audit(repo, surface_files)

    def dump(title: str, rows: dict[str, list[str]]) -> None:
        print(f"\n## {title} ({len(rows)})")
        for token in sorted(rows):
            locations = rows[token]
            shown = ", ".join(locations[:8]) + (" ..." if len(locations) > 8 else "")
            print(f"  `{token}`  [{len(locations)} files]  {shown}")

    print("# vocabulary check")
    print(
        f"control-surface files: {len(surface_files)} / "
        f"definition-corpus files: {len(definition_files)}"
    )
    print(
        f"allowlist: {len(allowlist)} / entities: {len(entities)} / "
        f"harvested-definitions-not-allowing: {len(harvested_definitions)}"
    )

    dump("unaccounted backtick identifiers (allowlist-only)", unaccounted)
    dump("dangling skill/capability routing targets", dangling)
    print(f"\n## dead allowlist entries ({len(dead)})")
    for token in dead:
        print(f"  `{token}`")

    print(f"\n## obligation ambiguity audit ({len(obligation_rows)})")
    for relative, lineno, term, line in obligation_rows:
        print(f"  {relative}:{lineno}: `{term}`  {line}")

    print(f"\n## file-name reference audit ({len(file_ref_rows)})")
    for relative, lineno, match in file_ref_rows:
        print(f"  {relative}:{lineno}: {match}")

    total = len(unaccounted) + len(dead) + len(file_ref_rows)
    print(
        f"\n# unaccounted: {len(unaccounted)} / dangling: {len(dangling)} "
        f"/ dead: {len(dead)} "
        f"/ obligation-audit: {len(obligation_rows)} / file-ref: {len(file_ref_rows)}"
    )
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
