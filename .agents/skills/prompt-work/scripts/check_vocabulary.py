#!/usr/bin/env python3
"""プロンプト本文の制御語彙とファイル名参照を静的に検査する。

制御面を発見し、バックティック内の未登録語彙と、規則・手順を
ファイル名で参照する記述を検査する。

出力:
  1. unaccounted: 制御面のバックティック内にある未登録語彙。
  2. file-name-reference: 規則・手順をファイル名で参照する箇所。

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
NAME_FIELD = re.compile(r"^\s*name:\s*([A-Za-z][A-Za-z0-9-]*)\s*$", re.M)

# 規則・手順をファイル名で参照する形。「XXX.md の〜」「XXX.md を〜」等。
# バックティックで囲んだファイル名にも対応する。
FILE_REF = re.compile(
    r"[A-Za-z0-9_\-/.*]+\.md(?:\.tmpl)?[ \t]*(?:`[ \t]*)?(?:の|に|を|へ|から|で)"
)

# 実行時の複製先は検査対象に含めず、source tree のスキル容器だけを扱う。
SKILL_CONTAINER_NAMES = (".agents", "dot_agents", ".opencode")
# chezmoi の source tree では設定対象と管理用資料が同居するため、
# 共通プロンプトのディレクトリは識別用ファイルから発見する。
PROMPT_TEMPLATE_MARKERS = ("common.md", "AGENTS.md")


@dataclass(frozen=True)
class SkillDirectory:
    path: Path
    manifests: tuple[Path, ...]


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
    roots = [
        repo / container / "skills"
        for container in SKILL_CONTAINER_NAMES
        if (repo / container / "skills").is_dir()
    ]
    exact_skills = repo / "dot_agents" / "exact_skills"
    if exact_skills.is_dir():
        roots.append(exact_skills)
    return _sorted_unique(roots)


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
    return {match.group(1) for match in BACKTICK.finditer(section)}


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
    surface_refs = collect_refs(repo, surface_files)

    unaccounted = {
        token: locations
        for token, locations in surface_refs.items()
        if token not in allowlist
    }
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
        f"allowlist: {len(allowlist)}"
    )
    dump("unaccounted backtick vocabulary (allowlist-only)", unaccounted)

    print(f"\n## file-name reference audit ({len(file_ref_rows)})")
    for relative, lineno, match in file_ref_rows:
        print(f"  {relative}:{lineno}: {match}")

    print(
        f"\n# unaccounted: {len(unaccounted)} "
        f"/ file-ref: {len(file_ref_rows)}"
    )
    return 1 if unaccounted or file_ref_rows else 0


if __name__ == "__main__":
    sys.exit(main())
