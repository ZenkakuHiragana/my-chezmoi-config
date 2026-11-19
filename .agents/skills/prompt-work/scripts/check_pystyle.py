"""Python 風に書いたスキル本文が、書き方の決まりのうち機械的に確かめられるものを守っているかを調べる。

使い方: python check_pystyle.py SKILL.md [SKILL.md ...]

書き方の決まりは、このスキルの references/python-style.md にある。
ここで調べるのは構文の形だけで、意味が原文や意図と合っているかは調べない。

調べること:
- frontmatter で始まり、その後に python のコードフェンスが 1 つだけあり、フェンスの外に文が無い（frontmatter の中のフェンスは数えない）
- フェンスの中が Python としてコンパイルできる（ast.parse だけでは見逃す誤りがあるので compile を使う）
- フェンスの中に、補助関数（condition、constraint、context、do、define、interrupt）と同じ名前の def が無い。補助関数の宣言は書き方の決まりにだけあり、本文には置かない
- 同じ名前の段階を二度定義していない
- 末尾が、メインの段階を引数なしで呼ぶ 1 行になっている
- do の文が 1 文で、箇条書きが無い。文は、かっこの外の「。」「！」「？」で数える。半角の ! と ? は、後ろが空白か文の終わりのときだけ数える。英文のピリオドでは数えない。箇条書きは、行頭の「- 」「* 」「・」「1. 」の形を見る
- 補助関数に渡す文字列が、二重引用符で、1 文なら 1 行に、2 文以上なら三重引用符で 1 文 1 行に書いてある（三重引用符の中の行は 1 段深く字下げし、閉じる引用符は始めた行の字下げに置く）。箇条書きを含む文字列と、二重引用符かバックスラッシュを含む文字列は調べない
- コメントが、段階の def か手順の直前にあり、コードと同じ行に無い。その手順だけを囲む with があるときは、その with の直前にある
- 文に書いた、フォルダ付きの .md のパス（references/x.md など）が、スキルのフォルダの中にある。調べるのは、英数字と「.」「_」「-」でできたパスだけで、フォルダの付かないファイル名は調べない。空白や日本語を含むパスは、正しく調べられない
- 使わない構文（elif、return、import、define による宣言以外の代入、名前以外の引数、f 文字列、リスト・辞書・クラス、例外、ループの else、interrupt に渡す段階以外の段階の中の def、docstring）が無い
- 名前の宣言が「名前 = define("…")」の形で、段階の外では最初の段階より前に、段階の中ではその段階の先頭にあり、同じ名前を重ねて宣言しておらず、その段階の引数とも重なっていない
- 段階の引数が名前だけで、呼び出しで渡すものが、その場所で使える名前（囲んでいる for のループ変数、段階の外かその段階の先頭で宣言した名前、その段階の引数）で、数が定義と合っている
- 宣言した名前、段階の引数、for の名前が、段階や補助関数の名前と重なっていない
- interrupt が with にだけあり、when= に文字列 1 つ、run= に引数を取らない段階の名前 1 つを、この順に名前を付けて渡していて（位置では渡さない）、渡す段階を段階として呼ばず、渡す段階の中では interrupt を使っていない
- 一つの段階でしか interrupt に渡さない段階を、その段階の中に定義している。段階の中に定義した段階が、それを渡す with の直前にあり、その with でだけ渡され、その中に def や名前の宣言が無く、名前がほかの名前と重なっていない
- 段階が、決まりの順に並んでいる。メインの後に、メインから呼び出しを書いてある順にたどって初めて出てくる順。いくつもの段階から呼ばれる段階は、メインからたどる呼び出しの数がいちばん少ない呼び出し元の所（同じ数なら、先に置く呼び出し元の所）。interrupt に渡す段階の本文は、渡した所に書いてあるものとして数える。段階の外に定義して interrupt に渡す段階は、それを渡す段階のうち、いちばん先に置くものの直前（いくつもあれば、渡す順）
- for が「for 名前 in 名前:」の形になっている
- if と while の条件が、condition と and / or / not だけでできていて、condition がそれ以外の場所に無い
- and と or を混ぜるところに括弧がある
- 入れ子のループの内側に break が無い
- 効く範囲が同じ with が入れ子になっていない（with の中身が別の with だけ）
- 定義した段階が、メインの段階から、呼び出しと interrupt をたどって届く
- 段階が、呼び出しをたどって自分へ戻らない（再帰が無い）。interrupt に渡す段階の本文は、渡した段階が呼ぶものとして数える

コメントの中身は調べない。
宣言した名前が、文の中で宣言した意味のとおりに使われているかも調べない。
for の対象の名前と、文の中の語が、その場所で使える名前を指しているかも調べない。
condition の文の最初の一文が「ない」「ず」「ぬ」「なかった」で終わるものは、否定形かもしれないので注意として出す。
宣言した名前が、使える範囲のどの文にも出てこず、引数や for の対象としても使っていないものも、注意として出す。
ほかの段階の中で宣言した名前と同じ名前を for の対象にしているものも、注意として出す。同じものを指しているなら、その段階では使えない。
注意は終了コードに関わらない。違反が 1 つでもあれば終了コード 1、無ければ 0 で終わる。
"""

import ast
import io
import pathlib
import re
import sys
import tokenize

HELPERS = ["condition", "constraint", "context", "do", "define", "interrupt"]
ONE_STRING = ["condition", "constraint", "context", "do", "define"]
FENCE = re.compile(r"^\x60\x60\x60python\n(.*?)^\x60\x60\x60[ \t]*$", re.S | re.M)
FRONTMATTER = re.compile(r"\A---\n.*?\n---\n", re.S)


def callee_of(node):
    """node が名前で呼ぶ呼び出しなら、呼ぶ名前を返す。そうでなければ None を返す。"""
    return getattr(getattr(node, "func", None), "id", None) if isinstance(node, ast.Call) else None


def is_declaration(node):
    """node が「名前 = define(…)」の形の文かを返す。"""
    return (
        isinstance(node, ast.Assign)
        and len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
        and callee_of(node.value) == "define"
    )


def interrupt_parts(node):
    """node が interrupt(when=…, run=…) の形の呼び出しなら、(when に渡した式, run に渡した式) を返す。形が違えば None を返す。"""
    if callee_of(node) != "interrupt" or node.args or [k.arg for k in node.keywords] != ["when", "run"]:
        return None
    return node.keywords[0].value, node.keywords[1].value


def interrupt_target(node):
    """node が interrupt(when=…, run=名前) の形の呼び出しなら、run に渡した名前を返す。そうでなければ None を返す。"""
    parts = interrupt_parts(node)
    return getattr(parts[1], "id", None) if parts else None


def sentence_count(text):
    """text の文の数を返す。かっこの中の句点では文を切らない。続けて並んだ句点や疑問符は、1 つと数える。"""
    parts = string_lines(text)
    if parts is not None:
        return len([x for x in parts if x])
    joined = " ".join(line.strip() for line in text.strip().splitlines())
    depth = count = 0
    pending = False
    for i, ch in enumerate(joined):
        if ch in "（(「『":
            depth += 1
        elif ch in "）)」』":
            depth = max(0, depth - 1)
        ends = ch in "。！？" or (ch in "!?" and (i + 1 == len(joined) or joined[i + 1].isspace()))
        if ends and depth == 0:
            count += 1
            pending = False
        elif not ch.isspace():
            pending = True
    return count + pending


def string_lines(value):
    """文字列を 1 文 1 行にした行の一覧を返す。箇条書きを含む文字列は、行の分け方を決められないので None を返す。

    行をつなぐとき、英数字どうしの間には空白を入れる。かっこの中の句点では切らない。続けて並んだ句点や疑問符では、最後の 1 つで切る。
    空行で分けた段落は、空の行を 1 つ挟んで残す。
    """
    found = []
    for paragraph in re.split(r"\n[ \t]*\n", value.strip()):
        rows = [x.strip() for x in paragraph.splitlines() if x.strip()]
        if any(re.match(r"(- |\* |・|\d+[.)] )", x) for x in rows):
            return None
        joined = ""
        for x in rows:
            between_words = joined and joined[-1].isascii() and joined[-1].isalnum() and x[0].isascii() and x[0].isalnum()
            if between_words or joined[-1:] in ("!", "?"):
                joined += " "
            joined += x
        if found and joined:
            found.append("")
        current, depth = "", 0
        for i, ch in enumerate(joined):
            current += ch
            if ch in "（(「『":
                depth += 1
            elif ch in "）)」』":
                depth = max(0, depth - 1)
            ends = ch in "。！？" or (ch in "!?" and (i + 1 == len(joined) or joined[i + 1].isspace()))
            more = i + 1 < len(joined) and joined[i + 1] in "。！？!?"
            if ends and depth == 0 and not more:
                found.append(current.strip())
                current = ""
        if current.strip():
            found.append(current.strip())
    return found


def expected_literal(value, indent):
    """文字列 value を決まりの書き方にしたリテラルを返す。indent は、リテラルが始まる行の字下げ。箇条書きを含むとき、二重引用符かバックスラッシュを含むときは None を返す。"""
    if '"' in value or "\\" in value:
        return None
    parts = string_lines(value)
    if parts is None:
        return None
    if len(parts) <= 1:
        return '"' + (parts[0] if parts else "") + '"'
    return '"""\n' + "\n".join(" " * (indent + 4) + x if x else "" for x in parts) + "\n" + " " * indent + '"""'


MD_PATH = re.compile(r"(?<![A-Za-z0-9_/.-])((?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.md)(?![A-Za-z0-9_-]|\.[A-Za-z0-9])")


def is_string(node):
    """node が文字列の定数かを返す。"""
    return isinstance(node, ast.Constant) and isinstance(node.value, str)


def helper_string(node):
    """node が補助関数の呼び出しなら、渡した文字列のノードを返す。interrupt では when= に渡した文字列を返す。文字列を渡していなければ None を返す。"""
    callee = callee_of(node)
    if callee in ONE_STRING and node.args and is_string(node.args[0]):
        return node.args[0]
    if callee == "interrupt":
        for k in node.keywords:
            if k.arg == "when" and is_string(k.value):
                return k.value
    return None


def check(path):
    """path のスキル本文を調べ、(違反の一覧, 注意の一覧, 段階名の一覧, 呼び出し名の一覧, interrupt に渡した段階名の一覧) を返す。行番号はファイルの行番号。"""
    text = pathlib.Path(path).read_text(encoding="utf-8").replace("\r\n", "\n")
    errors = []
    notes = []

    front = FRONTMATTER.match(text)
    if not front:
        errors.append("frontmatter で始まっていない")
    rest = text[front.end():] if front else text
    blocks = list(FENCE.finditer(text, front.end() if front else 0))
    if len(blocks) != 1:
        errors.append(f"python のフェンスが {len(blocks)} 個")
        return errors, notes, [], [], []
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
        return errors, notes, [], [], []
    tree = ast.parse(code)

    defs = [f for f in tree.body if isinstance(f, ast.FunctionDef)]
    for f in defs:
        if f.name in HELPERS:
            errors.append(f"{at(f.lineno)} 補助関数と同じ名前の def がある（補助関数の宣言は、本文に置かない）: {f.name}")
    stages = [f for f in defs if f.name not in HELPERS]
    names = {f.name for f in stages}
    seen = set()
    for f in stages:
        if f.name in seen:
            errors.append(f"{at(f.lineno)} 同じ名前の段階をもう一度定義している: {f.name}")
        seen.add(f.name)
    if not stages:
        errors.append("段階が無い")
        return errors, notes, [], [], []
    params = {f.name: [a.arg for a in f.args.args] for f in stages}
    by_name = {f.name: f for f in stages}
    inner = {f.name: [n for n in ast.walk(f) if isinstance(n, ast.FunctionDef) and n is not f] for f in stages}
    inner_names = {d.name for ds in inner.values() for d in ds}

    others = [n for n in tree.body if not isinstance(n, ast.FunctionDef)]
    module_decls = [n for n in others if is_declaration(n)]
    tail = [n for n in others if not is_declaration(n)]
    main_call = (
        len(tail) == 1
        and tree.body[-1] is tail[0]
        and isinstance(tail[0], ast.Expr)
        and callee_of(tail[0].value) in names
        and not tail[0].value.args
        and not tail[0].value.keywords
    )
    if not main_call:
        errors.append("末尾が、メインの段階を呼ぶ 1 行になっていない")
    elif tail[0].lineno != tail[0].end_lineno:
        errors.append(f"{at(tail[0].lineno)} 末尾のメインの段階の呼び出しが 1 行でない")
    main_stage = by_name[callee_of(tail[0].value)] if main_call else stages[0]
    if params[main_stage.name]:
        errors.append(f"{at(main_stage.lineno)} メインの段階に引数がある")

    position = {id(n): i for i, n in enumerate(tree.body)}
    module_names = []
    for n in module_decls:
        name = n.targets[0].id
        if not position[id(n)] < position[id(stages[0])]:
            errors.append(f"{at(n.lineno)} 段階の外の宣言が、最初の段階より前に無い: {name}")
        if not (len(n.value.args) == 1 and not n.value.keywords and is_string(n.value.args[0])):
            errors.append(f"{at(n.lineno)} define の引数が文字列 1 つでない")
        if name in module_names:
            errors.append(f"{at(n.lineno)} すでに宣言した名前をもう一度宣言している: {name}")
        if name in names or name in HELPERS:
            errors.append(f"{at(n.lineno)} 宣言した名前が、段階や補助関数の名前と同じ: {name}")
        module_names.append(name)
    local_decls = {}
    for f in stages:
        head = []
        for s in f.body:
            if not is_declaration(s):
                break
            head.append(s)
        local_decls[f.name] = head
        local_names = []
        for s in head:
            name = s.targets[0].id
            if name in local_names or name in module_names:
                errors.append(f"{at(s.lineno)} すでに宣言した名前をもう一度宣言している: {name}")
            if name in params[f.name]:
                errors.append(f"{at(s.lineno)} その段階の引数と同じ名前を宣言している: {name}")
            if name in names or name in HELPERS:
                errors.append(f"{at(s.lineno)} 宣言した名前が、段階や補助関数の名前と同じ: {name}")
            local_names.append(name)
        inner_decls = {id(x) for d in inner[f.name] for x in ast.walk(d) if is_declaration(x)}
        for n in ast.walk(f):
            if id(n) in inner_decls:
                errors.append(f"{at(n.lineno)} 段階の中に定義した段階の中で、名前を宣言している: {n.targets[0].id}")
            elif is_declaration(n) and not any(n is s for s in head):
                errors.append(f"{at(n.lineno)} 段階の中の宣言が、その段階の先頭に無い: {n.targets[0].id}")
    decl_calls = {id(n.value) for f in stages for n in ast.walk(f) if is_declaration(n)}
    with_items = {
        id(item.context_expr)
        for f in stages
        for n in ast.walk(f)
        if isinstance(n, ast.With)
        for item in n.items
    }

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
    skipped = (tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)
    all_tokens = list(tokenize.generate_tokens(io.StringIO(code).readline))
    tokens = [t for t in all_tokens if t.type not in skipped]
    for t in tokens:
        if t.type == tokenize.NAME and t.string == "elif":
            errors.append(f"{at(t.start[0])} elif を使っている")
    step_lines = {f.lineno for f in stages}
    for f in stages:
        step_lines |= {n.lineno for n in ast.walk(f) if isinstance(n, ast.stmt) and not is_declaration(n)}
    only_child_lines = {
        n.body[0].lineno
        for f in stages
        for n in ast.walk(f)
        if isinstance(n, ast.With) and len(n.body) == 1
    }
    for t in all_tokens:
        if t.type != tokenize.COMMENT:
            continue
        row = t.start[0]
        if lines[row - 1][: t.start[1]].strip():
            errors.append(f"{at(row)} コードと同じ行にコメントがある")
            continue
        after = row
        while after < len(lines) and lines[after].lstrip().startswith("#"):
            after += 1
        if after + 1 not in step_lines:
            errors.append(f"{at(row)} コメントの直後に、段階の def も手順も無い")
        elif after + 1 in only_child_lines:
            errors.append(f"{at(row)} コメントが、その手順だけを囲む with の内側にある")
    for n in ast.walk(tree):
        literal = helper_string(n)
        if literal is not None:
            indent = len(lines[literal.lineno - 1]) - len(lines[literal.lineno - 1].lstrip())
            expected = expected_literal(literal.value, indent)
            if expected is not None and ast.get_source_segment(code, literal) != expected:
                errors.append(f"{at(literal.lineno)} 文字列の書き方が決まりと違う（1 文は 1 行、2 文以上は三重引用符で 1 文 1 行）")
    folder = pathlib.Path(path).parent
    for n in ast.walk(tree):
        if is_string(n):
            for found in MD_PATH.findall(n.value):
                target = (folder / found).resolve()
                if not target.is_file() or folder.resolve() not in target.parents:
                    errors.append(f"{at(n.lineno)} 文に書いたパスが、スキルのフォルダに無い: {found}")

    def token_before(node):
        """node の式の直前にある字句を返す。コメントと改行は飛ばす。"""
        column = len(lines[node.lineno - 1].encode("utf-8")[: node.col_offset].decode("utf-8"))
        before = ""
        for t in tokens:
            if t.start >= (node.lineno, column):
                break
            before = t.string
        return before

    loop_names = {
        getattr(x, "id", None)
        for f in stages
        for n in ast.walk(f)
        if isinstance(n, ast.For)
        for x in (n.target, n.iter)
    }
    known_names = (
        set(HELPERS)
        | names
        | loop_names
        | set(module_names)
        | {s.targets[0].id for head in local_decls.values() for s in head}
        | {p for ps in params.values() for p in ps}
        | inner_names
    )
    local_only = {s.targets[0].id for head in local_decls.values() for s in head} - set(module_names)
    allowed_stmts = (ast.FunctionDef, ast.If, ast.While, ast.For, ast.Break, ast.With, ast.Expr, ast.Assign)
    allowed_exprs = (ast.Call, ast.Name, ast.Constant, ast.BoolOp, ast.UnaryOp)
    handlers = []

    for f in stages:
        a = f.args
        plain = not (a.posonlyargs or a.vararg or a.kwarg or a.kwonlyargs or a.defaults or a.kw_defaults)
        if not plain or any(x.annotation for x in a.args) or f.decorator_list or f.returns:
            errors.append(f"{at(f.lineno)} 段階 {f.name} に、名前だけの引数以外のものがある")
        for x in params[f.name]:
            if x in names or x in HELPERS:
                errors.append(f"{at(f.lineno)} 引数の名前が、段階や補助関数の名前と同じ: {x}")
        for n in ast.walk(f):
            line = at(getattr(n, "lineno", 0))
            if isinstance(n, ast.stmt) and not isinstance(n, allowed_stmts):
                errors.append(f"{line} 使わない文: {type(n).__name__}")
            if isinstance(n, ast.Assign) and not is_declaration(n):
                errors.append(f"{line} define による宣言でない代入")
            if isinstance(n, ast.FunctionDef) and n is not f:
                a = n.args
                if a.posonlyargs or a.args or a.vararg or a.kwarg or a.kwonlyargs or n.decorator_list or n.returns:
                    errors.append(f"{line} 段階の中に定義した段階が引数を取る、またはデコレーターや戻り値の型を持つ: {n.name}")
                if any(isinstance(x, ast.FunctionDef) and x is not n for x in ast.walk(n)):
                    errors.append(f"{line} 段階の中に定義した段階の中に、さらに def がある: {n.name}")
                loops_here = {getattr(x, "id", None) for m in ast.walk(f) if isinstance(m, ast.For) for x in (m.target, m.iter)}
                others_named = (
                    names | set(HELPERS) | loops_here | set(module_names) | set(params[f.name])
                    | {s.targets[0].id for s in local_decls[f.name]}
                    | {d.name for d in inner[f.name] if d is not n}
                )
                if n.name in others_named:
                    errors.append(f"{line} 段階の中に定義した段階の名前が、ほかの名前と同じ: {n.name}")
            if isinstance(n, ast.For) and not (isinstance(n.target, ast.Name) and isinstance(n.iter, ast.Name)):
                errors.append(f"{line} for が「for 名前 in 名前:」の形でない")
            if isinstance(n, ast.For):
                for x in (n.target, n.iter):
                    if getattr(x, "id", None) in names or getattr(x, "id", None) in HELPERS:
                        errors.append(f"{line} for の名前が、段階や補助関数の名前と同じ: {x.id}")
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
                if callee in ONE_STRING:
                    one_string = len(n.args) == 1 and not n.keywords and is_string(n.args[0])
                    if not one_string:
                        errors.append(f"{line} {callee} の引数が文字列 1 つでない")
                    if callee == "condition" and id(n) not in in_test:
                        errors.append(f"{line} if / while の条件の外に condition がある")
                    if callee == "condition" and one_string:
                        first = re.split(r"[。\n]", n.args[0].value.strip())[0]
                        if re.search(r"(ない|ず|ぬ|なかった)$", first):
                            notes.append(f"{line} condition の述語が否定形かもしれない: {first}")
                    if callee == "do" and one_string:
                        if sentence_count(n.args[0].value) != 1:
                            errors.append(f"{line} do の文が 1 文でない（{sentence_count(n.args[0].value)} 文）")
                        if any(re.match(r"(- |\* |・|\d+[.)] )", x.strip()) for x in n.args[0].value.splitlines()):
                            errors.append(f"{line} do の文に箇条書きがある")
                    if callee == "define" and id(n) not in decl_calls:
                        errors.append(f"{line} define が「名前 = define(…)」の形の宣言になっていない")
                elif callee == "interrupt":
                    if id(n) not in with_items:
                        errors.append(f"{line} with の外に interrupt がある")
                    parts = interrupt_parts(n)
                    target = interrupt_target(n)
                    here = {d.name for d in inner[f.name]}
                    takes_stage = parts is not None and is_string(parts[0]) and (target in names or target in here)
                    if not takes_stage:
                        errors.append(f"{line} interrupt の引数が、この順に名前を付けて渡した、when= の文字列 1 つと run= の段階の名前 1 つでない")
                    elif target not in here and params[target]:
                        errors.append(f"{line} interrupt に渡した段階が引数を取る: {target}")
                    elif target not in handlers:
                        handlers.append(target)
                elif callee in names:
                    if n.keywords or not all(isinstance(x, ast.Name) for x in n.args):
                        errors.append(f"{line} 段階の呼び出しに、名前以外の引数がある")
                    elif len(n.args) != len(params[callee]):
                        errors.append(f"{line} 段階の呼び出しの引数の数が、定義と合わない: {callee}")
                else:
                    errors.append(f"{line} 定義されていない呼び出し: {callee}")
            if isinstance(n, ast.With):
                for item in n.items:
                    callee = getattr(getattr(item.context_expr, "func", None), "id", None)
                    if callee not in ("constraint", "context", "interrupt") or item.optional_vars:
                        errors.append(f"{line} with に constraint / context / interrupt 以外がある")
                if len(n.body) == 1 and isinstance(n.body[0], ast.With):
                    errors.append(f"{line} 効く範囲が同じ with の入れ子")
            if isinstance(n, (ast.For, ast.While)) and n.orelse:
                errors.append(f"{line} ループの else")
            if isinstance(n, ast.Name) and n.id not in known_names:
                errors.append(f"{line} 定義されていない名前: {n.id}")
            if isinstance(n, ast.BoolOp):
                for v in n.values:
                    if isinstance(v, ast.BoolOp):
                        same_start = (v.lineno, v.col_offset) == (n.lineno, n.col_offset)
                        if same_start or token_before(v) != "(":
                            errors.append(f"{at(v.lineno)} and と or を混ぜるところに括弧が無い")

    def check_arguments(stmts, usable):
        """stmts の中で、usable に無い名前を段階へ渡している呼び出しを違反にする。ほかの段階の中で宣言した名前と同じ名前を対象にする for は注意にする。"""
        for s in stmts:
            if isinstance(s, ast.Expr) and callee_of(s.value) in names:
                for x in s.value.args:
                    if isinstance(x, ast.Name) and x.id not in usable:
                        errors.append(
                            f"{at(s.lineno)} 渡した名前が、その場所で使える名前（ループ変数、宣言した名前、その段階の引数）でない: {x.id}"
                        )
            if isinstance(s, ast.For):
                source = getattr(s.iter, "id", None)
                if source in local_only and source not in usable:
                    notes.append(f"{at(s.lineno)} for の対象が、ほかの段階の中で宣言した名前と同じ: {source}")
                check_arguments(s.body, usable | {getattr(s.target, "id", None)})
            elif isinstance(s, (ast.If, ast.While)):
                check_arguments(s.body, usable)
                check_arguments(s.orelse, usable)
            elif isinstance(s, (ast.With, ast.FunctionDef)):
                check_arguments(s.body, usable)

    passed_right_after = set()

    def check_inner(stmts):
        """stmts の中の def が、それを interrupt に渡す with の直前にあるかを調べ、その with の中の渡している所を passed_right_after に足す。"""
        for i, s in enumerate(stmts):
            if isinstance(s, ast.FunctionDef):
                following = [x for x in stmts[i + 1:] if not isinstance(x, ast.FunctionDef)][:1]
                between = stmts[i + 1: stmts.index(following[0])] if following else stmts[i + 1:]
                passed = set()
                if following and isinstance(following[0], ast.With) and all(isinstance(x, ast.FunctionDef) for x in between):
                    for item in following[0].items:
                        call = item.context_expr
                        target = interrupt_target(call)
                        if target is not None:
                            passed.add(target)
                            if target == s.name:
                                passed_right_after.add(id(call))
                if s.name not in passed:
                    errors.append(f"{at(s.lineno)} 段階の中の def が、それを interrupt に渡す with の直前に無い: {s.name}")
            else:
                check_inner(getattr(s, "body", []))
                check_inner(getattr(s, "orelse", []))

    for f in stages:
        check_inner(f.body)
        here = {d.name for d in inner[f.name]}
        for n in ast.walk(f):
            target = interrupt_target(n)
            if target in here and id(n) not in passed_right_after:
                errors.append(f"{at(n.lineno)} 段階の中に定義した段階を、定義の直後の with 以外で渡している: {target}")
        own = {s.targets[0].id for s in local_decls[f.name]}
        check_arguments(f.body, set(module_names) | set(params[f.name]) | own)

    def walk_loops(node, depth):
        for c in ast.iter_child_nodes(node):
            if isinstance(c, ast.Break) and depth >= 2:
                errors.append(f"{at(c.lineno)} 入れ子のループの内側に break がある")
            next_depth = 0 if isinstance(c, ast.FunctionDef) else depth + isinstance(c, (ast.For, ast.While))
            walk_loops(c, next_depth)

    walk_loops(tree, 0)
    calls = [callee_of(n) for f in stages for n in ast.walk(f) if isinstance(n, ast.Call)]
    calls += ["define"] * len(module_decls)

    def strings_in(nodes):
        return [c.value for n in nodes for c in ast.walk(n) if is_string(c)]

    def loaded_in(nodes):
        return {c.id for n in nodes for c in ast.walk(n) if isinstance(c, ast.Name) and isinstance(c.ctx, ast.Load)}

    for n in module_decls:
        name = n.targets[0].id
        readers = stages + [d for d in module_decls if d is not n]
        if not any(name in s for s in strings_in(readers)) and name not in loaded_in(stages):
            notes.append(f"{at(n.lineno)} 宣言した名前が、どの文にも出てこない: {name}")
    for f in stages:
        for s in local_decls[f.name]:
            name = s.targets[0].id
            readers = [x for x in f.body if x is not s]
            if not any(name in t for t in strings_in(readers)) and name not in loaded_in(readers):
                notes.append(f"{at(s.lineno)} 宣言した名前が、その段階のどの文にも出てこない: {name}")

    def reached_from(f):
        """段階 f が呼ぶ段階と、interrupt に渡す段階の名前を返す。"""
        found = set()
        for n in ast.walk(f):
            callee = callee_of(n)
            if callee in names:
                found.add(callee)
            if interrupt_target(n) in names:
                found.add(interrupt_target(n))
        return found

    reaches = {f.name: reached_from(f) for f in stages}
    reached, todo = set(), [main_stage.name]
    while todo:
        name = todo.pop()
        if name not in reached:
            reached.add(name)
            todo.extend(reaches.get(name, ()))
    for name in sorted(names - reached):
        errors.append(f"メインの段階から届かない段階: {name}")

    def events_of(f):
        """段階 f の本文を書いてある順にたどり、("call", 呼ぶ段階の名前) と ("pass", interrupt に渡す段階の外の段階の名前) を、出てくる順に返す。f の中に定義した段階の本文は、それを渡した所でたどる。"""
        found = []
        waiting = {d.name: d for d in inner[f.name]}

        def visit(node):
            if isinstance(node, ast.FunctionDef):
                return
            callee = callee_of(node)
            if callee == "interrupt":
                target = interrupt_target(node)
                if target in waiting:
                    for s in waiting.pop(target).body:
                        visit(s)
                elif target in names:
                    found.append(("pass", target))
            elif callee in names:
                found.append(("call", callee))
            for child in ast.iter_child_nodes(node):
                visit(child)

        for s in f.body:
            visit(s)
        return found

    events = {f.name: events_of(f) for f in stages}
    passers = {}
    for f in stages:
        inside = {id(n): d.name for d in inner[f.name] for n in ast.walk(d)}
        for n in ast.walk(f):
            target = interrupt_target(n)
            if target in names:
                passers.setdefault(target, set()).add((f.name, inside.get(id(n))))
    for f in stages:
        inside = {id(n): d.name for d in inner[f.name] for n in ast.walk(d)}
        for n in ast.walk(f):
            if callee_of(n) == "interrupt" and (f.name in passers or id(n) in inside):
                errors.append(f"{at(n.lineno)} interrupt に渡す段階の中で、interrupt を使っている: {inside.get(id(n), f.name)}")
    for handler, users in passers.items():
        if handler == main_stage.name:
            errors.append(f"interrupt に渡す段階を、メインの段階として呼んでいる: {handler}")
        if any(("call", handler) in events[f.name] for f in stages):
            errors.append(f"interrupt に渡す段階を、段階としても呼んでいる: {handler}")
        if len(users) == 1:
            user = next(iter(users))[0]
            errors.append(f"{at(by_name[handler].lineno)} 一つの段階でしか interrupt に渡さない段階を、その段階の外に定義している: {handler}（渡す段階: {user}）")

    def written_in(name):
        """段階 name の ("call", 名前) と ("pass", 名前) の並びを返す。interrupt に渡した段階が呼ぶ段階は、渡した所に入れる。"""
        result = []
        for kind, target in events[name]:
            result.append((kind, target))
            if kind == "pass" and target != name:
                result += [e for e in events[target] if e[0] == "call"]
        return result

    flow = names - set(passers)
    written = {name: written_in(name) for name in flow}
    calls_of = {name: list(dict.fromkeys(x for kind, x in written[name] if kind == "call" and x in flow)) for name in flow}
    passes_of = {name: list(dict.fromkeys(x for kind, x in written[name] if kind == "pass")) for name in flow}

    def distances(root):
        """root から呼び出しをたどる回数を、届く段階について返す。"""
        found, queue = {root: 0}, [root]
        while queue:
            name = queue.pop(0)
            for callee in calls_of.get(name, ()):
                if callee not in found:
                    found[callee] = found[name] + 1
                    queue.append(callee)
        return found

    for f in stages:
        if f.name not in flow:
            continue
        seen, todo = set(), list(calls_of[f.name])
        while todo:
            name = todo.pop()
            if name == f.name:
                errors.append(f"{at(f.lineno)} 段階が、呼び出しをたどって自分へ戻る: {f.name}")
                break
            if name not in seen:
                seen.add(name)
                todo.extend(calls_of.get(name, ()))
    from_main = distances(main_stage.name)
    expected = []

    def place(name):
        """段階 name と、そこから置く段階を、決まりの順で expected に足す。"""
        expected.extend(x for x in passes_of.get(name, ()) if x not in expected)
        expected.append(name)
        for callee in calls_of.get(name, ()):
            if callee not in expected and from_main.get(callee) == from_main[name] + 1:
                place(callee)

    place(main_stage.name)
    actual = [f.name for f in stages if f.name in expected]
    if actual != expected and len(actual) == len(expected):
        i = next(k for k in range(len(expected)) if actual[k] != expected[k])
        errors.append(
            f"{at(by_name[actual[i]].lineno)} 段階の並びが決まりの順と違う。{i + 1} 番目は {expected[i]} のはずが、{actual[i]} になっている。"
            + "決まりの順: " + "、".join(expected)
        )
    return errors, notes, [f.name for f in stages], calls, handlers


def main(paths):
    if not paths:
        print(__doc__.splitlines()[2])
        return 2
    failed = False
    for path in paths:
        errors, notes, stages, calls, handlers = check(path)
        print(f"== {path}")
        if stages:
            print("段階:", "、".join(stages))
            if handlers:
                print("interrupt に渡す段階:", "、".join(handlers))
            print(" / ".join(f"{h} {calls.count(h)}" for h in HELPERS if h in calls))
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
