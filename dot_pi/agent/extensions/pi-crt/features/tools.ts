/**
 * TOOL, TOOL LOG and THINKING: the tool calls of the conversation and the latest
 * thinking text, fed by Pi's message and tool events. On session_start and after a
 * move in the tree they are rebuilt from the active branch, so the panels match the
 * conversation after a resume, a new session or a tree jump.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CrtState } from "../state/core.ts";
import { sanitize } from "../state/core.ts";
import {
	appendThinking,
	clipResult,
	createToolData,
	finishTool,
	pushLog,
	pushTool,
	rebuildFromBranch,
	summarizeArgs,
	thinkingTail,
	type ToolData,
	updateLog,
} from "../state/tools.ts";
import type { FeatureEnv } from "./env.ts";

/** Each pi-crt instance's tool data, by its CrtState (see FeatureEnv). */
const collected = new WeakMap<CrtState, ToolData>();

/** Before setupTools: no calls. Never changed. */
const NONE: Readonly<ToolData> = Object.freeze(createToolData());

/** The tool calls and thinking text collected so far. */
export function toolData(state: CrtState): Readonly<ToolData> {
	return collected.get(state) ?? NONE;
}

export function setupTools(pi: ExtensionAPI, env: FeatureEnv): void {
	const data = createToolData();
	collected.set(env.state, data);
	/** The content block of the thinking being streamed, to separate blocks with a blank line. */
	let thinkingBlock = -1;

	pi.on("session_start", (_event, ctx) => {
		rebuildFromBranch(data, ctx.sessionManager);
	});

	pi.on("session_tree", (_event, ctx) => {
		rebuildFromBranch(data, ctx.sessionManager);
		env.requestRender();
	});

	pi.on("message_start", (event) => {
		if ((event.message as { role?: string }).role !== "assistant") return;
		data.thinking = "";
		data.thinkingTrimmed = false;
		data.toolsVersion++;
		thinkingBlock = -1;
	});

	// Streamed thinking arrives as deltas; append them instead of re-reading the
	// whole message on every update.
	pi.on("message_update", (event) => {
		const update = event.assistantMessageEvent;
		if (update.type !== "thinking_delta") return;
		if (thinkingBlock !== -1 && update.contentIndex !== thinkingBlock) appendThinking(data, "\n\n");
		thinkingBlock = update.contentIndex;
		appendThinking(data, update.delta);
	});

	pi.on("message_end", (event) => {
		const thinking = thinkingTail(event.message);
		if (!thinking.text) return;
		data.thinking = thinking.text;
		data.thinkingTrimmed = thinking.trimmed;
		data.toolsVersion++;
	});

	pi.on("agent_end", () => {
		if (data.active.size) {
			data.active.clear();
			data.toolsVersion++;
		}
	});

	pi.on("tool_execution_start", (event) => {
		data.active.add(event.toolCallId);
		pushTool(data, {
			id: event.toolCallId,
			name: sanitize(event.toolName),
			summary: summarizeArgs(event.args),
			status: "running",
			nested: Boolean(event.parentToolCallId),
		});
		// Calls made by another tool are drawn by that tool, as in Pi's transcript.
		if (!event.parentToolCallId) pushLog(data, event.toolCallId, sanitize(event.toolName), event.args);
	});

	pi.on("tool_execution_update", (event) => {
		if (!event.parentToolCallId) updateLog(data, event.toolCallId, clipResult(event.partialResult, false), true);
	});

	pi.on("tool_execution_end", (event) => {
		if (data.active.delete(event.toolCallId)) data.toolsVersion++;
		if (event.isError) data.lastErrorAt = Date.now();
		finishTool(data, event.toolCallId, event.isError, event.durationMs);
		if (!event.parentToolCallId) {
			updateLog(data, event.toolCallId, clipResult(event.result, event.isError, event.durationMs), false);
		}
	});
}
