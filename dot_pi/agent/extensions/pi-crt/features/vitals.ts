/**
 * The usage numbers STAT shows that pi does not keep for us: cache hits, cost, decode
 * speed, and the usage of each response on the branch (DETAIL's HISTORY). The panels
 * read them through `vitals()`.
 *
 * Cost and cache hits are read from the session, as Pi's session format defines them
 * (docs/session-format.md, docs/message-types.md): the session's cost is the usage of
 * its assistant messages, tool results with nested model work, usage entries, branch
 * summaries and compactions; usage splits the prompt into input, cacheRead and
 * cacheWrite. They are read again when a session starts (opened, resumed, switched to,
 * or reloaded) and whenever the session gets one of those entries, so they are right
 * before the first response too.
 *
 * Decode speed is measured live: it needs the time of the first chunk, which the
 * session does not keep. So pi-crt keeps it: when a run measured one, the last speed
 * is appended to the session as a custom entry (pi.appendEntry, not sent to the
 * model), and a session that starts, or a move in the tree, takes the speed from the
 * latest such entry on the branch.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CrtState } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

export interface Vitals {
	/** Cached share of the prompt of the latest response on the branch; undefined without one. */
	cacheRatio?: number;
	/** Cost of the session so far, in the provider's currency as pi reports it. */
	cost: number;
	/** Output tokens per second of the last response. */
	decodeTokensPerSecond?: number;
	/** Assistant responses in the session. */
	responses: number;
	/** The latest responses on the branch, oldest first (at most MAX_HISTORY). A new array whenever it is read again. */
	history: readonly ResponseUsage[];
}

/** One assistant response's usage, as HISTORY draws it. */
export interface ResponseUsage {
	input: number;
	cacheRead: number;
	cacheWrite: number;
	output: number;
	/** The branch was compacted between the previous response and this one. */
	afterCompaction: boolean;
}

/** Responses kept for HISTORY; more than any terminal is wide. */
const MAX_HISTORY = 400;

/** Each pi-crt instance's numbers, by its CrtState (see FeatureEnv). */
const collected = new WeakMap<CrtState, Vitals>();

/** Before setupVitals: nothing counted. Never changed. */
const NONE: Readonly<Vitals> = Object.freeze({ cost: 0, responses: 0, history: [] });

/** The numbers collected so far. */
export function vitals(state: CrtState): Readonly<Vitals> {
	return collected.get(state) ?? NONE;
}

/** customType of the entries that keep the decode speed. */
const SPEED_ENTRY = "pi-crt.speed";

/** What a speed entry holds. */
interface SpeedRecord {
	/** Output tokens per second of the last response of a run. */
	tokensPerSecond: number;
}

/** The fields of a usage that are read here. */
interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
}

export function setupVitals(pi: ExtensionAPI, env: FeatureEnv): void {
	const state: Vitals = { cost: 0, responses: 0, history: [] };
	collected.set(env.state, state);
	/** When the provider sent the first piece of the current response. */
	let firstChunkAt: number | undefined;
	/** The running agent measured a speed that is not in the session yet. */
	let unsaved = false;

	const read = (ctx: ExtensionContext) => {
		readSession(state, ctx);
		env.requestRender();
	};

	/** Read the session, and take the decode speed from the branch's latest speed entry. */
	const restore = (ctx: ExtensionContext) => {
		firstChunkAt = undefined;
		unsaved = false;
		state.decodeTokensPerSecond = savedSpeed(ctx);
		read(ctx);
	};

	pi.on("session_start", (_event, ctx) => restore(ctx));
	// Moving in the tree changes the branch; a compaction or a branch summary adds usage.
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("session_compact", (_event, ctx) => read(ctx));

	pi.on("turn_start", () => {
		firstChunkAt = undefined;
	});

	pi.on("provider_stream_event", () => {
		firstChunkAt ??= Date.now();
	});

	pi.on("message_end", (event, ctx) => {
		const message = event.message as { role?: unknown; usage?: unknown };
		const usage = usageOf(message.usage);
		if (message.role === "assistant" && usage) {
			// Decoding starts at the first chunk, so the wait before it is left out.
			const elapsed = firstChunkAt === undefined ? 0 : Date.now() - firstChunkAt;
			if (elapsed > 0 && usage.output > 0) {
				state.decodeTokensPerSecond = usage.output / (elapsed / 1000);
				unsaved = true;
			}
			firstChunkAt = undefined;
		}
		if (usage) read(ctx);
	});

	pi.on("agent_end", (_event, ctx) => {
		// One entry per run, after its last message, so a resumed session or a move in
		// the tree finds the speed of the latest run on its branch.
		if (unsaved && state.decodeTokensPerSecond !== undefined) {
			const record: SpeedRecord = { tokensPerSecond: state.decodeTokensPerSecond };
			pi.appendEntry(SPEED_ENTRY, record);
		}
		unsaved = false;
		// Usage entries (cache warming, for one) are appended outside a turn; read them when the run ends.
		read(ctx);
	});
}

/** The speed kept by the latest speed entry on the branch, if any. */
function savedSpeed(ctx: ExtensionContext): number | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index]!;
		if (entry.type !== "custom" || entry.customType !== SPEED_ENTRY) continue;
		const speed = (entry.data as Partial<SpeedRecord> | undefined)?.tokensPerSecond;
		return typeof speed === "number" && Number.isFinite(speed) && speed > 0 ? speed : undefined;
	}
	return undefined;
}

/** Cost and responses from every entry of the session; cache hits and the history from the branch. */
function readSession(state: Vitals, ctx: ExtensionContext): void {
	let cost = 0;
	let responses = 0;
	for (const entry of ctx.sessionManager.getEntries()) {
		const usage = usageOf(entryUsage(entry));
		if (!usage) continue;
		cost += usage.cost.total;
		if (entry.type === "message" && entry.message.role === "assistant") responses++;
	}
	state.cost = cost;
	state.responses = responses;
	const history: ResponseUsage[] = [];
	let compacted = false;
	/** The latest assistant message on the branch, with or without usage. */
	let latest: Usage | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "compaction") compacted = true;
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		latest = usageOf(entry.message.usage);
		if (!latest) continue;
		const { input, cacheRead, cacheWrite, output } = latest;
		history.push({ input, cacheRead, cacheWrite, output, afterCompaction: compacted });
		compacted = false;
	}
	state.history = history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history;
	const prompt = latest ? latest.input + latest.cacheRead + latest.cacheWrite : 0;
	state.cacheRatio = latest && prompt > 0 ? latest.cacheRead / prompt : undefined;
}

type SessionEntry = ReturnType<ExtensionContext["sessionManager"]["getEntries"]>[number];

/** The usage an entry adds to the session's totals, if any. */
function entryUsage(entry: SessionEntry): unknown {
	switch (entry.type) {
		case "message":
			return entry.message.role === "assistant" || entry.message.role === "toolResult"
				? (entry.message as { usage?: unknown }).usage
				: undefined;
		case "usage":
		case "branch_summary":
		case "compaction":
			return entry.usage;
		default:
			return undefined;
	}
}

/** A usage with the fields read here, or undefined. */
function usageOf(value: unknown): Usage | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const usage = value as Partial<Usage>;
	const numbers = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.cost?.total];
	return numbers.every((number) => typeof number === "number" && Number.isFinite(number)) ? (usage as Usage) : undefined;
}
