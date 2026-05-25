from __future__ import annotations

import pathlib
import sys


def is_header(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith("[") and stripped.endswith("]")


def is_project_header(line: str) -> bool:
    stripped = line.strip()
    return stripped == "[projects]" or stripped.startswith("[projects.")


def main() -> int:
    if len(sys.argv) != 2:
        return 0

    path = pathlib.Path(sys.argv[1]).expanduser()
    if not path.exists():
        return 0

    lines = path.read_text(encoding="utf-8").splitlines()
    blocks: list[str] = []
    current: list[str] | None = None

    for line in lines:
        if is_header(line):
            if current:
                blocks.append("\n".join(current).rstrip())
                current = None
            if is_project_header(line):
                current = [line]
            continue

        if current is not None:
            current.append(line)

    if current:
        blocks.append("\n".join(current).rstrip())

    output = "\n\n".join(block for block in blocks if block.strip())
    if output:
        sys.stdout.write(output)
        if not output.endswith("\n"):
            sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
