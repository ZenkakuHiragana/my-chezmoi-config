/** Current branch plus the latest observed request's edits, as in pi-context-view. */
import { contentText, declarationsEqual, getCurrentSystemMessage, getCurrentSystemPrompt, getSystemMessageText, type SystemMessage, type Tool } from "@earendil-works/pi-ai";
import type { ContextWithSystemEvent, SessionProjection } from "@earendil-works/pi-coding-agent";
import { diffConversation, diffSystemState, trimMatchedEnds } from "./context-diff.ts";
import { messageContribution, type MessageContribution } from "./context.ts";

export type RequestMessage = ContextWithSystemEvent["messages"][number];
export interface BaselineMessage { readonly entryId: string; readonly message: RequestMessage }
export type SystemChange =
	| { readonly type: "content"; readonly text: string }
	| { readonly type: "section"; readonly name: string; readonly text: string | null }
	| { readonly type: "tool"; readonly name: string; readonly declaration: Tool | null };
type ConversationChange =
	| { readonly type: "added"; readonly contribution: MessageContribution }
	| { readonly type: "modified"; readonly entryId: string; readonly contribution: MessageContribution }
	| { readonly type: "deleted"; readonly entryId: string };
export interface RequestSnapshot {
	readonly leafId: string | null;
	readonly baselineSystem?: SystemMessage;
	readonly systemChanges: readonly SystemChange[];
	readonly conversation: readonly ConversationChange[];
	readonly forcedPrompt?: string;
}
export interface CapturedContext { request: RequestSnapshot; hidden: ReadonlySet<string> }
export type ContextOrigin = "built" | "recorded" | "observed";
export interface ProjectedContext {
	contributions: MessageContribution[];
	branchMessages: RequestMessage[];
	prompt: string;
	tools: Tool[];
	/** Provenance of the projected system/declarations, not every conversation message. */
	origin: ContextOrigin;
}

function readProjection(projection: SessionProjection): BaselineMessage[] {
	return projection.entries.flatMap(({ sourceEntry, messages }) => messages.map((message) => ({ entryId: sourceEntry.id, message })));
}

/** Own changed objects at the hook; defer alignment until after the request handler returns. */
export function prepareRequestCapture(projection: SessionProjection, messages: readonly RequestMessage[], effectivePrompt: string, leafId: string | null, promptOptions?: { forceSystemPrompt?: string }): () => RequestSnapshot {
	const baseline = readProjection(projection);
	const unmatched = trimMatchedEnds(baseline, messages);
	const request = structuredClone(unmatched.request);
	const system = getCurrentSystemMessage(messages);
	const requestSystem = system && structuredClone(system);
	const originalSystem = getCurrentSystemMessage(projection.messages);
	const baselineSystem = originalSystem && structuredClone(originalSystem);
	const replayedPrompt = getCurrentSystemPrompt(projection.messages);
	// An observed options object distinguishes known no-force from an unavailable force flag.
	const forcedPrompt = promptOptions ? promptOptions.forceSystemPrompt : effectivePrompt === replayedPrompt ? undefined : effectivePrompt;
	return () => ({
		leafId, baselineSystem,
		systemChanges: diffSystemState(baselineSystem ? [baselineSystem] : [], requestSystem ? [requestSystem] : []),
		conversation: diffConversation(unmatched.baseline, request).map((edit): ConversationChange => {
			if (edit.type === "added") return { type: "added", contribution: messageContribution(edit.message) };
			return edit.type === "deleted"
				? { type: "deleted", entryId: edit.baseline.entryId }
				: { type: "modified", entryId: edit.baseline.entryId, contribution: messageContribution(edit.message) };
		}),
		...(forcedPrompt === undefined ? {} : { forcedPrompt }),
	});
}

/** Synchronous pure convenience for snapshot tests; production schedules the prepared build. */
export function captureRequest(projection: SessionProjection, messages: readonly RequestMessage[], effectivePrompt: string, leafId: string | null, promptOptions?: { forceSystemPrompt?: string }): RequestSnapshot {
	return prepareRequestCapture(projection, messages, effectivePrompt, leafId, promptOptions)();
}

/** Same freshness test as pi-context-view: timestamps do not change system meaning. */
function sameSystemState(a: SystemMessage | undefined, b: SystemMessage | undefined): boolean {
	if (a === undefined || b === undefined) return a === b;
	if (JSON.stringify(a.content) !== JSON.stringify(b.content)) return false;
	if (JSON.stringify(Object.entries(a.sections ?? {})) !== JSON.stringify(Object.entries(b.sections ?? {}))) return false;
	const before = a.toolsAdded ?? [], after = b.toolsAdded ?? [];
	return before.length === after.length && before.every((tool, index) => declarationsEqual(tool, after[index]));
}

/** Replay content, section and declaration deltas; force replaces text only, not tools. */
function applySystemChanges(base: SystemMessage | undefined, changes: readonly SystemChange[]): SystemMessage {
	let content = base ? contentText(base.content) : "";
	const sections = { ...base?.sections };
	const tools = new Map((base?.toolsAdded ?? []).map((tool) => [tool.name, tool]));
	for (const change of changes) {
		switch (change.type) {
			case "content": content = change.text; break;
			case "section":
				if (change.text === null) delete sections[change.name];
				else sections[change.name] = change.text;
				break;
			case "tool":
				if (change.declaration === null) tools.delete(change.name);
				else tools.set(change.name, change.declaration);
				break;
		}
	}
	return { role: "system", content, sections, toolsAdded: [...tools.values()], timestamp: base?.timestamp ?? 0 };
}

/** The caller supplies a snapshot only while its capture leaf is on this branch. */
export function projectContext(projection: SessionProjection, captured: CapturedContext | undefined, fallbackPrompt: string, fallbackTools: readonly Tool[], runHidden?: ReadonlySet<string>): ProjectedContext {
	const snapshot = captured?.request;
	const current = readProjection(projection);
	const branchMessages = current.map(({ message }) => message);
	const replaced = new Map<BaselineMessage, MessageContribution | undefined>();
	const additions: MessageContribution[] = [];
	for (const change of snapshot?.conversation ?? []) {
		if (change.type === "added") { additions.push(change.contribution); continue; }
		const target = current.find((candidate) => candidate.entryId === change.entryId && candidate.message.role !== "system" && !replaced.has(candidate));
		if (target) replaced.set(target, change.type === "deleted" ? undefined : change.contribution);
	}
	const contributions = current.flatMap((entry) => replaced.has(entry) ? (replaced.get(entry) ? [replaced.get(entry)!] : []) : [messageContribution(entry.message)]);
	contributions.push(...additions);
	const base = getCurrentSystemMessage(branchMessages);
	const fresh = snapshot !== undefined && sameSystemState(snapshot.baselineSystem, base);
	const system = fresh ? applySystemChanges(base, snapshot.systemChanges) : base;
	const hidden = runHidden ?? (fresh ? captured!.hidden : new Set<string>());
	return {
		contributions, branchMessages,
		prompt: fresh && snapshot.forcedPrompt !== undefined ? snapshot.forcedPrompt : system ? getSystemMessageText(system) : fallbackPrompt,
		tools: (system?.toolsAdded ?? (system ? [] : fallbackTools)).filter((tool) => !hidden.has(tool.name)),
		origin: fresh ? "observed" : base ? "recorded" : "built",
	};
}
