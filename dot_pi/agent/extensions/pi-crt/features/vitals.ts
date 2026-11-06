/**
 * The usage numbers STAT shows that pi does not keep for us: cache hits, cost, output
 * speed, and the usage of each response on the branch (DETAIL's HISTORY). The panels
 * read them through `vitals()`.
 *
 * They are read from the session, as Pi's session format defines them
 * (docs/session-format.md, docs/message-types.md): the session's cost is the usage of
 * its assistant messages, tool results with nested model work, usage entries, branch
 * summaries and compactions; usage splits the prompt into input, cacheRead and
 * cacheWrite. The output speed is the output tokens of the latest response on the
 * branch that has a duration, over that duration (`durationMs`, which Pi records from
 * the request to the end of the response, so the wait for the first token is in it).
 *
 * They are read again when a panel draws them and the session or its leaf changed
 * since the last read, or the leaf moved in the tree: every entry Pi adds to a session
 * becomes its leaf, and a move in the tree may come back to a leaf read before, with
 * entries added on another branch meanwhile. Reading walks the whole session, so it
 * runs off the render path, as CONTEXT's measuring does. Pi's events are not used for
 * reading, since Pi tells the extensions of a message before it adds the message to
 * the session (agent-session.js).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CrtState, Versioned } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/** The id of STATUS, the panel with the numbers and the DIFF card (features/git.ts asks whether it is shown). */
export const VITALS_PANEL = "vitals";

export interface Vitals extends Versioned {
	/** Cached share of the prompt of the latest response on the branch; undefined without one. */
	cacheRatio?: number;
	/** Cost of the session so far, in the provider's currency as pi reports it. */
	cost: number;
	/** Output tokens per second of the latest response on the branch that has a duration. */
	outputTokensPerSecond?: number;
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

interface VitalsFeature {
	env: FeatureEnv;
	data: Vitals;
	/** The session and its leaf when `data` was read; empty after a move in the tree. */
	sessionKey: string;
	/** A read is waiting to run. */
	scheduled: boolean;
}

/** Each pi-crt instance's numbers, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, VitalsFeature>();

/** Before setupVitals: nothing counted. Never changed. */
const NONE: Readonly<Vitals> = Object.freeze({ cost: 0, responses: 0, history: [], version: 0 });

/** The numbers read so far; drawing them reads the session again when it changed. */
export function vitals(state: CrtState): Readonly<Vitals> {
	const feature = features.get(state);
	if (!feature) return NONE;
	const ctx = feature.env.context();
	if (ctx && !feature.scheduled && sessionKey(ctx) !== feature.sessionKey) {
		feature.scheduled = true;
		setTimeout(() => {
			feature.scheduled = false;
			const now = feature.env.context();
			if (!now) return;
			feature.sessionKey = sessionKey(now);
			readSession(feature.data, now.sessionManager.getEntries(), now.sessionManager.getBranch());
			feature.env.changed(feature.data);
		}, 0).unref?.();
	}
	return feature.data;
}

function sessionKey(ctx: ExtensionContext): string {
	return `${ctx.sessionManager.getSessionId()}\n${ctx.sessionManager.getLeafId() ?? ""}`;
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
	const feature: VitalsFeature = { env, data: { cost: 0, responses: 0, history: [], version: 0 }, sessionKey: "", scheduled: false };
	features.set(env.state, feature);
	pi.on("session_tree", () => {
		feature.sessionKey = "";
	});
}

/** Cost and responses from every entry of the session; cache hits, the output speed and the history from the branch. */
function readSession(state: Vitals, entries: readonly SessionEntry[], branch: readonly SessionEntry[]): void {
	let cost = 0;
	let responses = 0;
	for (const entry of entries) {
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
	let speed: number | undefined;
	for (const entry of branch) {
		if (entry.type === "compaction") compacted = true;
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		latest = usageOf(entry.message.usage);
		if (!latest) continue;
		// Pi leaves the duration out of old messages and of results fetched later.
		const duration = entry.message.durationMs;
		if (duration !== undefined && duration > 0 && latest.output > 0) speed = latest.output / (duration / 1000);
		const { input, cacheRead, cacheWrite, output } = latest;
		history.push({ input, cacheRead, cacheWrite, output, afterCompaction: compacted });
		compacted = false;
	}
	state.history = history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history;
	const prompt = latest ? latest.input + latest.cacheRead + latest.cacheWrite : 0;
	state.cacheRatio = latest && prompt > 0 ? latest.cacheRead / prompt : undefined;
	state.outputTokensPerSecond = speed;
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
