"""Python 風に書いたスキル本文が、書き方の決まりのうち機械的に確かめられるものを守っているかを調べる。

使い方: python check_pystyle.py SKILL.md [SKILL.md ...]

書き方の決まりは、このスキルの references/python-style.md にある。
ここで調べるのは構文の形だけで、意味が原文や意図と合っているかは調べない。

調べること:
- frontmatter で始まり、その後に python のコードフェンスが 1 つだけあり、フェンスの外に文が無い
- フェンスの中が Python としてコンパイルできる（ast.parse だけでは見逃す誤りがあるので compile を使う）
- 先頭に補助関数 condition、constraint、context、do の宣言が決まりの文面のままあり（デコレーターも付けない）、後で定義し直していない
- 同じ名前の段階を二度定義していない
- 末尾が、メインの段階を引数なしで呼ぶ 1 行になっている
- 使わない構文（return、import、代入、引数、f 文字列、リスト・辞書・クラス、例外、ループの else、段階の中の def、コメント）が無い
- for が「for 名前 in 名前:」の形になっている
- if と while の条件が、condition と and / or / not だけでできていて、condition がそれ以外の場所に無い
- and と or を混ぜるところに括弧がある
- 入れ子のループの内側に break が無い
- 効く範囲が同じ with が入れ子になっていない（with の中身が別の with だけ）
- 定義した段階が、メインの段階から呼び出しをたどって届く

段階を呼ばれる順に置いているかは調べない。
condition の文の最初の一文が「ない」「ず」「ぬ」「なかった」で終わるものは、否定形かもしれないので注意として出す。
注意は終了コードに関わらない。違反が 1 つでもあれば終了コード 1、無ければ 0 で終わる。
"""

import ast
import io
import pathlib
import re
import sys
import tokenize

HELPERS = ["condition", "constraint", "context", "do"]
DECLARATIONS = {
    "condition": "def condition(prompt: str) -> bool: ...",
    "constraint": "def constraint(prompt: str): ...",
    "context": "def context(prompt: str): ...",
    "do": "def do(prompt: str): ...",
}
FENCE = re.compile(r"^\x60\x60\x60python\n(.*?)^\x60\x60\x60[ \t]*$", re.S | re.M)
FRONTMATTER = re.compile(r"\A---\n.*?\n---\n", re.S)


def check(path):
    """path のスキル本文を調べ、(違反の一覧, 注意の一覧, 段階名の一覧, 呼び出し名の一覧) を返す。行番号はファイルの行番号。"""
    text = pathlib.Path(path).read_text(encoding="utf-8").replace("\r\n", "\n")
    errors = []
    notes = []

    front = FRONTMATTER.match(text)
    if not front:
        errors.append("frontmatter で始まっていない")
    rest = text[front.end():] if front else text
    blocks = list(FENCE.finditer(text))
    if len(blocks) != 1:
        errors.append(f"python のフェンスが {len(blocks)} 個")
        return errors, notes, [], []
    block = blocks[0]
    if FENCE.sub("", rest).strip():
        errors.append("フェンスの外に文がある")
    code = block.group(1)
    offset = text.count("\n", 0, block.start(1))

    def at(lineno):
        return lineno + offset

    try:
        compile(code, str(path), "exec")
    except SyntaxError as e:
        errors.append(f"{at(e.lineno or 0)} 構文エラー: {e.msg}")
        return errors, notes, [], []
    tree = ast.parse(code)

    defs = [f for f in tree.body if isinstance(f, ast.FunctionDef)]
    if [f.name for f in defs[:4]] != HELPERS:
        errors.append("補助関数の宣言（condition、constraint、context、do）が先頭に無い")
    for f in defs[:4]:
        if f.decorator_list:
            errors.append(f"{at(f.lineno)} 補助関数 {f.name} にデコレーターがある")
        if f.name in DECLARATIONS and (ast.get_source_segment(code, f) or "").strip() != DECLARATIONS[f.name]:
            errors.append(f"{at(f.lineno)} 補助関数 {f.name} の宣言が決まりの文面と違う: {DECLARATIONS[f.name]}")
    for f in defs[4:]:
        if f.name in HELPERS:
            errors.append(f"{at(f.lineno)} 補助関数 {f.name} を定義し直している")
    stages = [f for f in defs[4:] if f.name not in HELPERS]
    names = {f.name for f in stages}
    seen = set()
    for f in stages:
        if f.name in seen:
            errors.append(f"{at(f.lineno)} 同じ名前の段階をもう一度定義している: {f.name}")
        seen.add(f.name)
    if not stages:
        errors.append("段階が無い")
        return errors, notes, [], []

    tail = [n for n in tree.body if not isinstance(n, ast.FunctionDef)]
    main_call = (
        len(tail) == 1
        and tree.body[-1] is tail[0]
        and isinstance(tail[0], ast.Expr)
        and isinstance(tail[0].value, ast.Call)
        and getattr(tail[0].value.func, "id", None) == stages[0].name
        and not tail[0].value.args
        and not tail[0].value.keywords
    )
    if not main_call:
        errors.append("末尾が、メインの段階を呼ぶ 1 行になっていない")

    def is_test(e):
        if isinstance(e, ast.Call):
            return getattr(e.func, "id", None) == "condition"
        if isinstance(e, ast.BoolOp):
            return all(is_test(v) for v in e.values)
        if isinstance(e, ast.UnaryOp) and isinstance(e.op, ast.Not):
            return is_test(e.operand)
        return False

    in_test = set()
    for f in stages:
        for n in ast.walk(f):
            if isinstance(n, (ast.If, ast.While)):
                if not is_test(n.test):
                    errors.append(f"{at(n.lineno)} if / while の条件に condition 以外がある")
                in_test |= {id(x) for x in ast.walk(n.test)}

    lines = code.splitlines()
    loop_names = {
        getattr(x, "id", None)
        for f in stages
        for n in ast.walk(f)
        if isinstance(n, ast.For)
        for x in (n.target, n.iter)
    }
    allowed_stmts = (ast.FunctionDef, ast.If, ast.While, ast.For, ast.Break, ast.With, ast.Expr)
    allowed_exprs = (ast.Call, ast.Name, ast.Constant, ast.BoolOp, ast.UnaryOp)

    for f in stages:
        if f.args.posonlyargs or f.args.args or f.args.vararg or f.args.kwarg or f.args.kwonlyargs or f.decorator_list or f.returns:
            errors.append(f"{at(f.lineno)} 段階 {f.name} に引数などがある")
        for n in ast.walk(f):
            line = at(getattr(n, "lineno", 0))
            if isinstance(n, ast.stmt) and not isinstance(n, allowed_stmts):
                errors.append(f"{line} 使わない文: {type(n).__name__}")
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n is not f:
                errors.append(f"{line} 段階の中に def がある")
            if isinstance(n, ast.For) and not (isinstance(n.target, ast.Name) and isinstance(n.iter, ast.Name)):
                errors.append(f"{line} for が「for 名前 in 名前:」の形でない")
            if isinstance(n, ast.expr) and not isinstance(n, allowed_exprs):
                errors.append(f"{line} 使わない式: {type(n).__name__}")
            if isinstance(n, ast.Constant) and not isinstance(n.value, str):
                errors.append(f"{line} 文字列以外の定数")
            if isinstance(n, ast.Expr):
                callee = getattr(getattr(n.value, "func", None), "id", None)
                if callee not in {"do"} | names:
                    errors.append(f"{line} do や段階の呼び出しでない式文")
            if isinstance(n, ast.Call):
                callee = getattr(n.func, "id", None)
                if callee in HELPERS:
                    one_string = (
                        len(n.args) == 1
                        and not n.keywords
                        and isinstance(n.args[0], ast.Constant)
                        and isinstance(n.args[0].value, str)
                    )
                    if not one_string:
                        errors.append(f"{line} {callee} の引数が文字列 1 つでない")
                    if callee == "condition" and id(n) not in in_test:
                        errors.append(f"{line} if / while の条件の外に condition がある")
                    if callee == "condition" and one_string:
                        first = re.split(r"[。\n]", n.args[0].value.strip())[0]
                        if re.search(r"(ない|ず|ぬ|なかった)$", first):
                            notes.append(f"{line} condition の述語が否定形かもしれない: {first}")
                elif callee in names:
                    if n.args or n.keywords:
                        errors.append(f"{line} 段階の呼び出しに引数がある")
                else:
                    errors.append(f"{line} 定義されていない呼び出し: {callee}")
            if isinstance(n, ast.With):
                for item in n.items:
                    callee = getattr(getattr(item.context_expr, "func", None), "id", None)
                    if callee not in ("constraint", "context") or item.optional_vars:
                        errors.append(f"{line} with に constraint / context 以外がある")
                if len(n.body) == 1 and isinstance(n.body[0], ast.With):
                    errors.append(f"{line} 効く範囲が同じ with の入れ子")
            if isinstance(n, (ast.For, ast.While)) and n.orelse:
                errors.append(f"{line} ループの else")
            if isinstance(n, ast.Name) and n.id not in set(HELPERS) | names | loop_names:
                errors.append(f"{line} 定義されていない名前: {n.id}")
            if isinstance(n, ast.BoolOp):
                for v in n.values:
                    if isinstance(v, ast.BoolOp):
                        k = v.lineno - 1
                        before = lines[k].encode("utf-8")[: v.col_offset].decode("utf-8").rstrip()
                        while not before and k > 0:
                            k -= 1
                            before = lines[k].rstrip()
                        same_start = (v.lineno, v.col_offset) == (n.lineno, n.col_offset)
                        if same_start or not before.endswith("("):
                            errors.append(f"{at(v.lineno)} and と or を混ぜるところに括弧が無い")

    def walk_loops(node, depth):
        for c in ast.iter_child_nodes(node):
            if isinstance(c, ast.Break) and depth >= 2:
                errors.append(f"{at(c.lineno)} 入れ子のループの内側に break がある")
            next_depth = 0 if isinstance(c, ast.FunctionDef) else depth + isinstance(c, (ast.For, ast.While))
            walk_loops(c, next_depth)

    walk_loops(tree, 0)
    for tok in tokenize.generate_tokens(io.StringIO(code).readline):
        if tok.type == tokenize.COMMENT:
            errors.append(f"{at(tok.start[0])} コメント")

    calls = [getattr(n.func, "id", None) for f in stages for n in ast.walk(f) if isinstance(n, ast.Call)]
    callees = {
        f.name: {getattr(n.func, "id", None) for n in ast.walk(f) if isinstance(n, ast.Call)} & names
        for f in stages
    }
    reached, todo = set(), [stages[0].name]
    while todo:
        name = todo.pop()
        if name not in reached:
            reached.add(name)
            todo.extend(callees.get(name, ()))
    for name in sorted(names - reached):
        errors.append(f"メインの段階から届かない段階: {name}")
    return errors, notes, [f.name for f in stages], calls


def main(paths):
    if not paths:
        print(__doc__.splitlines()[2])
        return 2
    failed = False
    for path in paths:
        errors, notes, stages, calls = check(path)
        print(f"== {path}")
        if stages:
            print("段階:", "、".join(stages))
            print(" / ".join(f"{h} {calls.count(h)}" for h in HELPERS))
        print("違反: なし" if not errors else "違反:")
        for e in errors:
            print("  " + e)
        if notes:
            print("注意:")
            for n in notes:
                print("  " + n)
        failed |= bool(errors)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
