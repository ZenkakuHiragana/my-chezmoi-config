"""Python 風に書いたスキル本文の、補助関数に渡す文字列の書き方をそろえる。

使い方: python format_pystyle.py SKILL.md [SKILL.md ...]

書き方の決まりは、このスキルの references/python-style.md の「文字列の書き方」にある。
1 文の文字列は 1 行に、2 文以上の文字列は三重引用符で 1 文 1 行に書き直す。
箇条書きを含む文字列と、二重引用符かバックスラッシュを含む文字列は書き直さない。文字列を並べてつないだものや、間にコメントのあるものも書き直さない。
折り返してあった 1 文をつなぐとき、英数字どうしの間には空白を入れ、それ以外は空白を入れずにつなぐ。
文の並びが変わらないことを確かめてから、ファイルを上書きする。
"""

import ast
import pathlib
import re
import sys

import check_pystyle


def helper_strings(code):
    """code の中の、補助関数に渡した文字列のノードを返す。"""
    found = []
    for n in ast.walk(ast.parse(code)):
        literal = check_pystyle.helper_string(n)
        if literal is not None:
            found.append(literal)
    return found


def sentences_of(value):
    """文字列の文の並びを返す。箇条書きを含む文字列は、行の並びを返す。"""
    parts = check_pystyle.string_lines(value)
    return parts if parts is not None else [x.strip() for x in value.strip().splitlines() if x.strip()]


def reformat(path):
    """path の本文の文字列を書き直し、書き直した文字列の数を返す。"""
    path = pathlib.Path(path)
    raw = path.read_bytes()
    crlf = b"\r\n" in raw
    text = raw.decode("utf-8").replace("\r\n", "\n")
    front = check_pystyle.FRONTMATTER.match(text)
    block = check_pystyle.FENCE.search(text, front.end() if front else 0)
    if not block:
        raise SystemExit(f"{path}: python のフェンスが無い")
    code = block.group(1)
    lines = code.split("\n")
    before = [sentences_of(c.value) for c in helper_strings(code)]
    edits = []
    for c in helper_strings(code):
        first = lines[c.lineno - 1]
        expected = check_pystyle.expected_literal(c.value, len(first) - len(first.lstrip()))
        segment = ast.get_source_segment(code, c) or ""
        if expected is None or segment == expected or "#" in segment or segment.count('"""') not in (0, 2):
            continue
        start = len(first.encode("utf-8")[: c.col_offset].decode("utf-8"))
        end = len(lines[c.end_lineno - 1].encode("utf-8")[: c.end_col_offset].decode("utf-8"))
        edits.append((c.lineno, start, c.end_lineno, end, expected))
    for lineno, start, end_lineno, end, expected in sorted(edits, reverse=True):
        merged = lines[lineno - 1][:start] + expected + lines[end_lineno - 1][end:]
        lines[lineno - 1:end_lineno] = merged.split("\n")
    new_code = "\n".join(lines)
    after = [sentences_of(c.value) for c in helper_strings(new_code)]
    if before != after:
        raise SystemExit(f"{path}: 文の中身が変わるので、書き直さなかった")
    if not edits:
        return 0
    new_text = text[: block.start(1)] + new_code + text[block.end(1):]
    path.write_bytes((new_text.replace("\n", "\r\n") if crlf else new_text).encode("utf-8"))
    return len(edits)


def main(paths):
    if not paths:
        print(__doc__.splitlines()[2])
        return 2
    for path in paths:
        print(f"{path}: {reformat(path)} 個の文字列を書き直した")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
