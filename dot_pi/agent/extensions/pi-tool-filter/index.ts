import type {
  ExtensionAPI,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { inspectBash } from "./inspector.ts";
import { readPathDecision, writePathDecision } from "./path-policy.ts";
import type { FilterConfig } from "./types.ts";

function inspectPathTool(event: ToolCallEvent, cwd: string, config: FilterConfig) {
  if (isToolCallEventType("read", event)) {
    return typeof event.input.path === "string" ? readPathDecision(event.input.path, cwd, config) : undefined;
  }
  if (isToolCallEventType("find", event)) return readPathDecision(event.input.path ?? ".", cwd, config);
  if (isToolCallEventType("grep", event)) return readPathDecision(event.input.path ?? ".", cwd, config);
  if (isToolCallEventType("ls", event)) return readPathDecision(event.input.path ?? ".", cwd, config);
  if (isToolCallEventType("edit", event)) return writePathDecision(event.input.path, cwd, config);
  if (isToolCallEventType("write", event)) return writePathDecision(event.input.path, cwd, config);
  return undefined;
}

export default function piToolFilter(pi: ExtensionAPI): void {
  const config = loadConfig();
  pi.on("tool_call", async (event, ctx) => {
    if (!config) return undefined;
    if (isToolCallEventType("bash", event)) return inspectBash(event.input.command, config, ctx.cwd);
    return inspectPathTool(event, ctx.cwd, config);
  });
}
