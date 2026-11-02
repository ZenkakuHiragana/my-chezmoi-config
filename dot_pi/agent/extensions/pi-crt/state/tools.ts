/**
 * The tool calls and the thinking text, as TOOL, TOOL LOG and THINKING show them.
 * features/tools.ts keeps one ToolData per pi-crt instance and feeds it Pi's events.
 *
 * Work that grows with the session is not repeated on every frame: the thinking
 * text keeps only its tail, the tool lists keep their last MAX_TOOLS calls, the
 * execution log keeps a bounded part of each argument and result (clipValue,
 * clipResult), and the branch walk stops after MAX_WALK entries. Clipping reads a
 * bounded amount, except the keys of a huge object (see clipValue).
 */
import { truncateHead, truncateLine, truncateTail } from "@earendil-works/pi-coding-agent";
import { sanitize } from "./core.ts";

/** One line of the TOOL LOG list. */
export interface ToolEntry {
	id: string;
	name: string;
	summary: string;
	status: "running" | "ok" | "error";
	nested: boolean;
	durationMs?: number;
}

/** A tool result in the shape Pi's ToolExecutionComponent.updateResult takes. */
export interface ToolResult {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	details?: unknown;
	isError: boolean;
	durationMs?: number;
	/**
	 * Part of the details or of the non-text blocks was left out: clipValue cut
	 * something, or there were more than CLIP_ITEMS non-text blocks. Cuts in the
	 * text, including blocks left out between the first and last CLIP_ITEMS, are
	 * marked in the text itself.
	 */
	cut?: boolean;
}

/** One call in the execution log, drawn with Pi's ToolExecutionComponent. */
export interface LogItem {
	id: string;
	name: string;
	args: unknown;
	result?: ToolResult;
	/** `result` is a streamed partial result. */
	partial: boolean;
	/** Part of the arguments was left out (see clipValue), or the result's `cut` is set. */
	cut: boolean;
	expanded: boolean;
	/** Changes whenever `result` or `expanded` changes. */
	version: number;
}

export interface ToolData {
	/** Tail of the latest thinking text (at most 2 × THINKING_TAIL characters). */
	thinking: string;
	/** The start of the latest thinking was dropped to keep only its tail. */
	thinkingTrimmed: boolean;
	tools: ToolEntry[];
	/** Changes whenever `tools`, a tool's status or the thinking text changes. */
	toolsVersion: number;
	/** Older calls exist than `tools` holds. */
	toolsTrimmed: boolean;
	/** Top-level calls with their results, for the execution log. */
	log: LogItem[];
	/** Older calls exist than `log` holds. */
	logTrimmed: boolean;
	/** Successful and failed tool calls among `tools`. */
	ok: number;
	failed: number;
}

export function createToolData(): ToolData {
	return { thinking: "", thinkingTrimmed: false, tools: [], toolsVersion: 0, toolsTrimmed: false, log: [], logTrimmed: false, ok: 0, failed: 0 };
}

export const THINKING_TAIL = 4000;
const MAX_TOOLS = 300;
/** Session entries the branch walk visits at most. */
const MAX_WALK = 5000;
/** Characters of a tool argument looked at for its one-line summary. */
const SUMMARY_SCAN = 1000;
/** The execution log keeps this many lines from the start and from the end of each text. */
const CLIP_LINES = 40;
/** ...and at most this many bytes for each of the two parts. */
const CLIP_BYTES = 8 * 1024;
/**
 * Characters read from each end of a long text. Larger than CLIP_BYTES, so the
 * clipped parts never reach the edge of what was read.
 */
const CLIP_WINDOW = 4 * CLIP_BYTES;
/** Characters kept of a single line that alone exceeds CLIP_BYTES. */
const CLIP_LINE_CHARS = 2000;
/**
 * Array items, object properties and result blocks kept per level (for blocks,
 * from each end), and object depth kept, from tool arguments and results.
 */
const CLIP_ITEMS = 200;
const CLIP_DEPTH = 8;
/** Values, and characters of strings, kept in all from one set of tool arguments or one result. */
const CLIP_VALUES = 1000;
const CLIP_VALUE_CHARS = 4 * CLIP_WINDOW;
/** Characters kept of an object key, and of an image's MIME type. */
const CLIP_KEY_CHARS = 200;
const CLIP_MIME_CHARS = 100;
const SUMMARY_KEYS = ["path", "file_path", "command", "pattern", "query", "url", "name", "description"];

/* ---------------------------------------------------------------- thinking */

/** Append streamed thinking text. Trimming in large steps keeps many small deltas linear. */
export function appendThinking(data: ToolData, text: string): void {
	data.thinking += sanitize(text);
	if (data.thinking.length > THINKING_TAIL * 2) {
		data.thinking = data.thinking.slice(-THINKING_TAIL);
		data.thinkingTrimmed = true;
	}
	data.toolsVersion++;
}

/**
 * The last THINKING_TAIL characters of a message's thinking, read from its last
 * block backwards, and whether anything before them was left out.
 */
export function thinkingTail(message: unknown): { text: string; trimmed: boolean } {
	const msg = message as { role?: string; content?: unknown };
	if (msg?.role !== "assistant" || !Array.isArray(msg.content)) return { text: "", trimmed: false };
	let text = "";
	let trimmed = false;
	for (let index = msg.content.length - 1; index >= 0; index--) {
		const block = msg.content[index] as Record<string, unknown> | undefined;
		if (block?.type !== "thinking" || typeof block.thinking !== "string" || !block.thinking) continue;
		if (text.length >= THINKING_TAIL) {
			trimmed = true;
			break;
		}
		const part = block.thinking.slice(-(THINKING_TAIL - text.length));
		if (part.length < block.thinking.length) trimmed = true;
		text = text ? `${part}\n\n${text}` : part;
	}
	return { text: sanitize(text).trim(), trimmed };
}

/* ---------------------------------------------------------------- clipping */

/** A text clipped to its first and last CLIP_LINES lines; see clipParts. */
export function clipText(text: string): string {
	return clipParts([text]);
}

/**
 * Clip texts that are joined with newlines (the text blocks of one tool result,
 * or one string) to the first and last CLIP_LINES lines, at most CLIP_BYTES each,
 * without control characters. Pi's truncateHead and truncateTail pick the lines.
 * Only CLIP_WINDOW characters from each end are read, so a long text costs no
 * more than a short one; the size of what is left out is then reported in
 * characters. The time grows with the number of texts, which clipResult keeps
 * at most 2 × CLIP_ITEMS.
 */
function clipParts(texts: readonly string[]): string {
	let total = Math.max(0, texts.length - 1);
	for (const text of texts) total += text.length;
	if (total <= 2 * CLIP_WINDOW) {
		const text = texts.join("\n");
		// A text that fits in both parts together is kept whole, so the parts never overlap.
		if (!truncateHead(text, { maxLines: 2 * CLIP_LINES, maxBytes: 2 * CLIP_BYTES }).truncated) return sanitize(text);
		const head = headPart(text);
		const tail = truncateTail(text, { maxLines: CLIP_LINES, maxBytes: CLIP_BYTES });
		const omitted = head.totalLines - head.outputLines - tail.outputLines;
		const marker = omitted > 0 ? `\u2026 ${omitted} lines omitted \u2026` : "\u2026 output cut \u2026";
		return sanitize([head.content, marker, tail.content].filter(Boolean).join("\n"));
	}
	const head = headPart(edge(texts, "start"));
	const tail = truncateTail(edge(texts, "end"), { maxLines: CLIP_LINES, maxBytes: CLIP_BYTES });
	const omitted = total - head.content.length - tail.content.length;
	return sanitize([head.content, `\u2026 ${omitted} characters omitted \u2026`, tail.content].filter(Boolean).join("\n"));
}

/**
 * The start of the texts before a gap and the end of the texts after it, for a
 * result whose middle blocks were left out. The two sides come from different
 * blocks, so they never overlap.
 */
function clipAround(before: readonly string[], after: readonly string[], dropped: number): string {
	const head = before.length ? headPart(edge(before, "start")) : undefined;
	const tail = after.length ? truncateTail(edge(after, "end"), { maxLines: CLIP_LINES, maxBytes: CLIP_BYTES }) : undefined;
	const more = head?.truncated || tail?.truncated ? " and part of the text" : "";
	return sanitize([head?.content, `\u2026 ${dropped} blocks${more} omitted \u2026`, tail?.content].filter(Boolean).join("\n"));
}

/** The first lines (truncateHead), or the start of the first line when that line alone is too long. */
function headPart(text: string): { content: string; totalLines: number; outputLines: number; truncated: boolean } {
	const head = truncateHead(text, { maxLines: CLIP_LINES, maxBytes: CLIP_BYTES });
	if (!head.firstLineExceedsLimit) return head;
	const end = text.indexOf("\n");
	return { ...head, content: truncateLine(end < 0 ? text : text.slice(0, end), CLIP_LINE_CHARS).text, outputLines: 1 };
}

/** The first or last CLIP_WINDOW characters of texts joined with newlines, reading no more than that. */
function edge(texts: readonly string[], side: "start" | "end"): string {
	const parts: string[] = [];
	let size = 0;
	for (let i = 0; i < texts.length; i++) {
		const text = texts[side === "start" ? i : texts.length - 1 - i]!;
		if (parts.length) size += 1;
		const room = CLIP_WINDOW - size;
		if (room <= 0) break;
		parts.push(text.length <= room ? text : side === "start" ? text.slice(0, room) : text.slice(-room));
		size += Math.min(text.length, room);
	}
	return (side === "start" ? parts : parts.reverse()).join("\n");
}

/** What clipValue may still keep of one value, and whether it left anything out. */
export interface ClipBudget {
	values: number;
	chars: number;
	cut: boolean;
}

export function clipBudget(): ClipBudget {
	return { values: CLIP_VALUES, chars: CLIP_VALUE_CHARS, cut: false };
}

/**
 * Clip tool arguments or result details: every string with clipText, at most
 * CLIP_ITEMS array items or object properties per level, CLIP_DEPTH levels, and
 * CLIP_VALUES values and CLIP_VALUE_CHARS string characters in all (strings past
 * that become a one-character "\u2026"); object keys shortened and without control
 * characters. `budget.cut` tells whether anything was left out, including a
 * shortened key or two keys that became the same. Arrays are read only as far as
 * kept; an object's keys are all listed by JavaScript before the first is read,
 * so an object with very many properties costs time in proportion to them.
 */
export function clipValue(value: unknown, budget: ClipBudget = clipBudget(), depth = 0): unknown {
	if (budget.values <= 0) {
		budget.cut = true;
		return undefined;
	}
	budget.values--;
	if (typeof value === "string") {
		if (budget.chars <= 0) {
			budget.cut = true;
			return "\u2026";
		}
		let text = clipText(value);
		if (text.length > budget.chars) {
			budget.cut = true;
			text = `${text.slice(0, budget.chars - 1)}\u2026`;
		}
		budget.chars -= text.length;
		return text;
	}
	if (!value || typeof value !== "object") return value;
	if (depth >= CLIP_DEPTH) {
		budget.cut = true;
		return undefined;
	}
	if (Array.isArray(value)) {
		if (value.length > CLIP_ITEMS) budget.cut = true;
		return value.slice(0, CLIP_ITEMS).map((item) => clipValue(item, budget, depth + 1));
	}
	const out: Record<string, unknown> = {};
	let count = 0;
	for (const key in value) {
		if (!Object.hasOwn(value, key)) continue;
		if (++count > CLIP_ITEMS) {
			budget.cut = true;
			break;
		}
		const short = sanitize(key.slice(0, CLIP_KEY_CHARS));
		if (short.length < key.length) budget.cut = true;
		// Keys that become the same keep the first value.
		if (Object.hasOwn(out, short)) {
			budget.cut = true;
			continue;
		}
		out[short] = clipValue((value as Record<string, unknown>)[key], budget, depth + 1);
	}
	return out;
}

/**
 * A tool result as the execution log keeps it: its text blocks joined and
 * clipped as one text, so the whole result keeps its first and last lines (when
 * there are more than 2 × CLIP_ITEMS blocks, only the first and last CLIP_ITEMS
 * are read, and the text says how many were left out between them); image blocks without their data, since the log
 * does not draw images; other blocks and the
 * details clipped with clipValue. `cut` tells whether clipValue left anything out.
 */
export function clipResult(result: { content?: unknown; details?: unknown }, isError: boolean, durationMs?: number): ToolResult {
	const blocks = Array.isArray(result?.content) ? (result.content as Array<Record<string, unknown>>) : [];
	const dropped = Math.max(0, blocks.length - 2 * CLIP_ITEMS);
	const budget = clipBudget();
	const before: string[] = [];
	const after: string[] = [];
	const others: ToolResult["content"] = [];
	const take = (block: Record<string, unknown> | undefined, texts: string[]) => {
		if (typeof block?.text === "string" && (block.type === undefined || block.type === "text")) texts.push(block.text);
		else if (others.length >= CLIP_ITEMS) budget.cut = true;
		else if (block?.type === "image") {
			others.push({ type: "image", data: "", mimeType: sanitize(String(block.mimeType ?? "").slice(0, CLIP_MIME_CHARS)) });
		} else others.push(clipValue(block, budget) as ToolResult["content"][number]);
	};
	if (dropped) {
		for (let i = 0; i < CLIP_ITEMS; i++) take(blocks[i], before);
		for (let i = blocks.length - CLIP_ITEMS; i < blocks.length; i++) take(blocks[i], after);
	} else {
		for (const block of blocks) take(block, before);
	}
	const text = dropped ? clipAround(before, after, dropped) : before.length ? clipParts(before) : undefined;
	const content: ToolResult["content"] = text === undefined ? others : [{ type: "text", text }, ...others];
	const details = clipValue(result?.details, budget);
	return { content, details, isError, durationMs, cut: budget.cut };
}

/* ---------------------------------------------------------------- tool lists */

export function pushTool(data: ToolData, entry: ToolEntry): void {
	data.tools.push(entry);
	countTool(data, entry, 1);
	while (data.tools.length > MAX_TOOLS) {
		countTool(data, data.tools.shift()!, -1);
		data.toolsTrimmed = true;
	}
	data.toolsVersion++;
}

export function finishTool(data: ToolData, id: string, isError: boolean, durationMs: number | undefined): void {
	for (let index = data.tools.length - 1; index >= 0; index--) {
		const entry = data.tools[index]!;
		if (entry.id !== id) continue;
		countTool(data, entry, -1);
		entry.status = isError ? "error" : "ok";
		entry.durationMs = durationMs;
		countTool(data, entry, 1);
		data.toolsVersion++;
		return;
	}
}

function countTool(data: ToolData, entry: ToolEntry, sign: 1 | -1): void {
	if (entry.status === "ok") data.ok += sign;
	else if (entry.status === "error") data.failed += sign;
}

export function pushLog(data: ToolData, id: string, name: string, args: unknown): void {
	const budget = clipBudget();
	data.log.push({ id, name, args: clipValue(args, budget), partial: false, cut: budget.cut, expanded: false, version: 0 });
	if (data.log.length > MAX_TOOLS) {
		data.log.splice(0, data.log.length - MAX_TOOLS);
		data.logTrimmed = true;
	}
}

/** Store a (partial) result for a logged call; `result` is clipped with clipResult first. */
export function updateLog(data: ToolData, id: string, result: ToolResult, partial: boolean): void {
	for (let index = data.log.length - 1; index >= 0; index--) {
		const item = data.log[index]!;
		if (item.id !== id) continue;
		item.result = result;
		item.partial = partial;
		if (result.cut) item.cut = true;
		item.version++;
		return;
	}
}

/** Expand or collapse a logged call. */
export function toggleLog(item: LogItem): void {
	item.expanded = !item.expanded;
	item.version++;
}

export function summarizeArgs(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	for (const key of SUMMARY_KEYS) {
		const value = record[key];
		if (typeof value === "string" && /\S/.test(value.slice(0, SUMMARY_SCAN))) return firstLine(value);
	}
	for (const value of Object.values(record)) {
		if (typeof value === "string" && /\S/.test(value.slice(0, SUMMARY_SCAN))) return firstLine(value);
	}
	return "";
}

function firstLine(text: string): string {
	const head = text.slice(0, SUMMARY_SCAN).trimStart();
	const line = sanitize(head.split(/\r?\n/, 1)[0] ?? "").trimEnd();
	return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

interface BranchEntry {
	type: string;
	parentId: string | null;
	message?: unknown;
}

interface BranchReader {
	getLeafEntry(): BranchEntry | undefined;
	getEntry(id: string): BranchEntry | undefined;
}

type BranchMessage = {
	role?: string;
	content?: unknown;
	details?: unknown;
	toolCallId?: string;
	isError?: boolean;
};

/**
 * Rebuild the per-conversation parts of the tool data (thinking, tool lists,
 * counters) from the active branch, so the panels match the conversation after a
 * resume, a new session or a tree jump. Walks back from the leaf and stops once
 * the lists are full and the latest thinking is found, or after MAX_WALK entries.
 * Arguments and results are clipped like those of new calls.
 */
export function rebuildFromBranch(data: ToolData, session: BranchReader): void {
	const results = new Map<string, BranchMessage>();
	const calls: ToolEntry[] = [];
	const log: LogItem[] = [];
	let thinking: { text: string; trimmed: boolean } | undefined;
	let skipped = false;
	let entry = session.getLeafEntry();
	for (let visited = 0; entry && visited < MAX_WALK; visited++) {
		if (entry.type === "message") {
			const msg = entry.message as BranchMessage;
			if (msg?.role === "toolResult" && typeof msg.toolCallId === "string") {
				results.set(msg.toolCallId, msg);
			} else if (msg?.role === "assistant") {
				if (!thinking?.text) thinking = thinkingTail(msg);
				const blocks = Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : [];
				for (let index = blocks.length - 1; index >= 0; index--) {
					const block = blocks[index];
					if (block?.type !== "toolCall" || typeof block.id !== "string") continue;
					if (calls.length >= MAX_TOOLS) {
						skipped = true;
						break;
					}
					const result = results.get(block.id);
					const name = sanitize(String(block.name ?? "?"));
					calls.push({
						id: block.id,
						name,
						summary: summarizeArgs(block.arguments),
						status: result === undefined ? "running" : result.isError ? "error" : "ok",
						nested: false,
					});
					const budget = clipBudget();
					const args = clipValue(block.arguments, budget);
					const clipped = result && clipResult(result, Boolean(result.isError));
					log.push({
						id: block.id,
						name,
						args,
						result: clipped,
						partial: false,
						cut: budget.cut || Boolean(clipped?.cut),
						expanded: false,
						version: 0,
					});
				}
			}
		}
		// Past MAX_TOOLS calls, keep walking only until one more call shows that older calls exist.
		if (calls.length >= MAX_TOOLS && thinking?.text && skipped) break;
		entry = entry.parentId ? session.getEntry(entry.parentId) : undefined;
	}
	// Older calls were left out, or the walk stopped (MAX_WALK) before it could tell.
	const trimmed = skipped || entry !== undefined;
	data.thinking = thinking?.text ?? "";
	data.thinkingTrimmed = thinking?.trimmed ?? false;
	data.tools = calls.reverse();
	data.toolsTrimmed = trimmed;
	data.log = log.reverse();
	data.logTrimmed = trimmed;
	data.ok = 0;
	data.failed = 0;
	for (const call of data.tools) countTool(data, call, 1);
	data.toolsVersion++;
}
