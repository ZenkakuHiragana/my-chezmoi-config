from __future__ import annotations

import copy
import functools
import json
import pathlib
import re
import sys
from typing import Any


PRESERVED_KEYS = ("model", "effortLevel")
PERMISSION_ACTIONS = ("allow", "ask", "deny")
PERMISSION_PRIORITY = {"allow": 1, "ask": 2, "deny": 3}
TARGET_TOOLS = ("PowerShell", "Bash")


class ProjectionError(ValueError):
    pass


def load_json_file(path_text: str) -> dict[str, Any]:
    path = pathlib.Path(path_text).expanduser()
    if not path.exists():
        return {}

    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    if isinstance(value, dict):
        return value
    return {}


def load_managed_settings(json_text: str) -> dict[str, Any]:
    value = json.loads(json_text)
    if not isinstance(value, dict):
        raise ValueError("managed settings must be a JSON object")
    return value


def load_opencode_bash_rules(json_text: str) -> list[tuple[str, str]]:
    value = json.loads(json_text)
    if not isinstance(value, dict):
        raise ValueError("opencode bash permissions must be a JSON object")

    rules: list[tuple[str, str]] = []
    for pattern, action in value.items():
        if not isinstance(pattern, str):
            raise ValueError("opencode bash permission patterns must be strings")
        if action not in PERMISSION_PRIORITY:
            raise ValueError(
                f"unsupported opencode bash permission action for {pattern!r}: {action!r}"
            )
        rules.append((pattern, action))
    return rules


def glob_epsilon_closure(pattern: str, states: frozenset[int]) -> frozenset[int]:
    closed = set(states)
    changed = True
    while changed:
        changed = False
        for state in tuple(closed):
            if (
                state < len(pattern)
                and pattern[state] == "*"
                and state + 1 not in closed
            ):
                closed.add(state + 1)
                changed = True
    return frozenset(closed)


def glob_transition(
    pattern: str, states: frozenset[int], symbol: str | None
) -> frozenset[int]:
    next_states: set[int] = set()
    for state in states:
        if state >= len(pattern):
            continue
        pattern_char = pattern[state]
        if pattern_char == "*":
            next_states.add(state)
        elif symbol is not None and pattern_char == symbol:
            next_states.add(state + 1)
    return glob_epsilon_closure(pattern, frozenset(next_states))


def glob_accepts(pattern: str, states: frozenset[int]) -> bool:
    return len(pattern) in states


@functools.cache
def glob_pattern_covers(broad: str, narrow: str) -> bool:
    alphabet = sorted((set(broad) | set(narrow)) - {"*"})
    symbols: tuple[str | None, ...] = (*alphabet, None)

    narrow_start = glob_epsilon_closure(narrow, frozenset({0}))
    broad_start = glob_epsilon_closure(broad, frozenset({0}))
    queue: list[tuple[frozenset[int], frozenset[int]]] = [(narrow_start, broad_start)]
    seen = {(narrow_start, broad_start)}

    while queue:
        narrow_states, broad_states = queue.pop(0)
        if glob_accepts(narrow, narrow_states) and not glob_accepts(
            broad, broad_states
        ):
            return False

        for symbol in symbols:
            next_narrow = glob_transition(narrow, narrow_states, symbol)
            if not next_narrow:
                continue
            next_broad = glob_transition(broad, broad_states, symbol)
            key = (next_narrow, next_broad)
            if key in seen:
                continue
            seen.add(key)
            queue.append(key)

    return True


def is_projected_default_ask(pattern: str, action: str) -> bool:
    return pattern == "*" and action == "ask"


def assert_portable_rules(rules: list[tuple[str, str]]) -> None:
    projected_rules = [
        (index, pattern, action)
        for index, (pattern, action) in enumerate(rules)
        if not is_projected_default_ask(pattern, action)
    ]

    for left_position, (left_index, left_pattern, left_action) in enumerate(
        projected_rules
    ):
        left_priority = PERMISSION_PRIORITY[left_action]
        for right_index, right_pattern, right_action in projected_rules[
            left_position + 1 :
        ]:
            right_priority = PERMISSION_PRIORITY[right_action]
            if right_priority >= left_priority:
                continue
            if not glob_pattern_covers(left_pattern, right_pattern):
                continue
            raise ProjectionError(
                "opencode permission.bash contains a rule order that Claude "
                "permissions cannot represent: "
                f"#{left_index + 1} {left_pattern!r} => {left_action!r} is "
                f"overridden by #{right_index + 1} {right_pattern!r} => "
                f"{right_action!r}"
            )


def project_opencode_bash_rules(
    rules: list[tuple[str, str]], target_tool: str
) -> dict[str, list[str]]:
    if target_tool not in TARGET_TOOLS:
        raise ValueError(f"unsupported target tool: {target_tool!r}")

    assert_portable_rules(rules)

    projected = {action: [] for action in PERMISSION_ACTIONS}
    for pattern, action in rules:
        if is_projected_default_ask(pattern, action):
            continue
        projected[action].append(f"{target_tool}({pattern})")
    return projected


def merge_unique(left: list[Any], right: list[str]) -> list[Any]:
    merged: list[Any] = []
    seen: set[str] = set()
    for item in [*left, *right]:
        marker = json.dumps(item, ensure_ascii=False, sort_keys=True)
        if marker in seen:
            continue
        seen.add(marker)
        merged.append(item)
    return merged


def merge_projected_permissions(
    settings: dict[str, Any], target_tool: str, projected: dict[str, list[str]]
) -> None:
    permissions_value = settings.setdefault("permissions", {})
    if not isinstance(permissions_value, dict):
        raise ValueError("managed permissions must be a JSON object")

    existing_deny = permissions_value.get("deny", [])
    if existing_deny is None:
        existing_deny = []
    if not isinstance(existing_deny, list):
        raise ValueError("managed permissions.deny must be an array")
    if target_tool in existing_deny:
        raise ProjectionError(
            f"cannot project opencode permission.bash to {target_tool}: "
            f"permissions.deny disables {target_tool!r}"
        )

    for action in PERMISSION_ACTIONS:
        existing = permissions_value.get(action, [])
        if existing is None:
            existing = []
        if not isinstance(existing, list):
            raise ValueError(f"managed permissions.{action} must be an array")
        merged = merge_unique(existing, projected[action])
        if merged:
            permissions_value[action] = merged
        elif action in permissions_value:
            del permissions_value[action]


def load_opencode_mcp(json_text: str) -> dict[str, Any]:
    value = json.loads(json_text)
    if not isinstance(value, dict):
        raise ValueError("opencode mcp must be a JSON object")
    return value


ENV_PLACEHOLDER_PATTERN = re.compile(r"\{env:([^}]+)\}")


def translate_env_placeholders(text: str) -> str:
    return ENV_PLACEHOLDER_PATTERN.sub(r"${\1}", text)


def project_opencode_mcp(opencode_mcp: dict[str, Any]) -> dict[str, Any]:
    projected: dict[str, Any] = {}

    for name, definition in opencode_mcp.items():
        if not isinstance(name, str):
            raise ValueError("opencode mcp server names must be strings")
        if not isinstance(definition, dict):
            raise ValueError(f"opencode mcp {name!r} must be a JSON object")
        if definition.get("enabled") is False:
            continue

        server_type = definition.get("type")
        if server_type == "local":
            command = definition.get("command")
            if not isinstance(command, list) or not command:
                raise ValueError(
                    f"opencode mcp {name!r} local command must be a non-empty array"
                )
            if not all(isinstance(item, str) for item in command):
                raise ValueError(
                    f"opencode mcp {name!r} local command entries must be strings"
                )

            env = definition.get("env", {})
            if not isinstance(env, dict) or not all(
                isinstance(key, str) and isinstance(value, str)
                for key, value in env.items()
            ):
                raise ValueError(
                    f"opencode mcp {name!r} local env must be a string map"
                )

            projected[name] = {
                "type": "stdio",
                "command": command[0],
                "args": command[1:],
                "env": {
                    key: translate_env_placeholders(value) for key, value in env.items()
                },
            }
            continue

        if server_type == "remote":
            url = definition.get("url")
            if not isinstance(url, str) or not url:
                raise ValueError(f"opencode mcp {name!r} remote url must be a string")

            projected_server = {
                "type": "http",
                "url": translate_env_placeholders(url),
            }

            headers = definition.get("headers")
            if headers is not None:
                if not isinstance(headers, dict) or not all(
                    isinstance(key, str) and isinstance(value, str)
                    for key, value in headers.items()
                ):
                    raise ValueError(
                        f"opencode mcp {name!r} remote headers must be a string map"
                    )
                projected_server["headers"] = {
                    key: translate_env_placeholders(value)
                    for key, value in headers.items()
                }

            projected[name] = projected_server
            continue

        raise ValueError(
            f"opencode mcp {name!r} has unsupported type: {server_type!r}"
        )

    return projected


def render_settings(
    existing_path: str,
    managed_json: str,
    target_tool: str,
    opencode_bash_json: str,
    opencode_mcp_json: str,
) -> str:
    managed = load_managed_settings(managed_json)
    existing = load_json_file(existing_path)

    output = copy.deepcopy(managed)
    for key in PRESERVED_KEYS:
        if key in existing:
            output[key] = existing[key]

    opencode_bash_rules = load_opencode_bash_rules(opencode_bash_json)
    projected_permissions = project_opencode_bash_rules(
        opencode_bash_rules, target_tool
    )
    merge_projected_permissions(output, target_tool, projected_permissions)

    opencode_mcp = load_opencode_mcp(opencode_mcp_json)
    projected_mcp = project_opencode_mcp(opencode_mcp)
    if projected_mcp:
        output["mcpServers"] = projected_mcp
    elif "mcpServers" in output:
        del output["mcpServers"]

    return json.dumps(output, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    if len(sys.argv) != 6:
        print(
            "usage: render-settings.py <existing-settings-path> "
            "<managed-settings-json> <target-tool> <opencode-bash-json> "
            "<opencode-mcp-json>",
            file=sys.stderr,
        )
        return 2

    try:
        rendered = render_settings(
            sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
        )
    except (json.JSONDecodeError, OSError, ValueError) as error:
        print(f"render-settings.py: {error}", file=sys.stderr)
        return 1

    sys.stdout.buffer.write(rendered.encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
