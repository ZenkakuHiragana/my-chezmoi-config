/** Shared current-branch estimate. Observed edits are captured at our context hook, not provider serialization. */
import type { Tool } from "@earendil-works/pi-ai";
import type { ContextUsage, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ContextPart, ContextMeter, nextRequestModel } from "../state/context.ts";
import { prepareRequestCapture, projectContext, type ContextOrigin, type RequestSnapshot, type CapturedContext } from "../state/request-context.ts";
import type { CrtState, Versioned } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

export const CONTEXT_PANEL = "context";
export interface ContextData extends Versioned {
	contextParts: readonly ContextPart[];
	prompt: string;
	tools: readonly Tool[];
	/** Provenance of prompt/tool declarations only; messages may include independent hook edits. */
	origin: ContextOrigin;
	/** Pi's own context estimate, not necessarily provider-reported usage. */
	reportedUsage?: ContextUsage;
	captureWarning?: string;
}
interface ContextFeature {
	pi: ExtensionAPI;
	env: FeatureEnv;
	data: ContextData;
	key?: readonly unknown[];
	snapshot?: CapturedContext;
	runLoadout?: { leafId: string | null; hidden: ReadonlySet<string> };
	pending?: { build: () => RequestSnapshot; sessionId: string; hidden: ReadonlySet<string> };
	timer?: ReturnType<typeof setImmediate>;
}
const features = new WeakMap<CrtState, ContextFeature>();
const NONE: Readonly<ContextData> = Object.freeze({ contextParts: [], prompt: "", tools: [], origin: "built", version: 0 });
/** Only system evidence survives a session switch, not request-only conversation or image bytes. */
const remembered = new Map<string, CapturedContext>();
const MAX_REMEMBERED = 16;
const EMPTY_HIDDEN: ReadonlySet<string> = new Set();
const meter = new ContextMeter();

function invalidate(feature: ContextFeature): void {
	feature.key = undefined;
	feature.env.changed(feature.data);
}
function cancelPending(feature: ContextFeature): void {
	if (feature.timer) clearImmediate(feature.timer);
	feature.timer = undefined;
	feature.pending = undefined;
}
function finishPending(feature: ContextFeature): void {
	const pending = feature.pending;
	if (!pending) return;
	cancelPending(feature);
	try {
		const request = pending.build();
		feature.snapshot = { request, hidden: pending.hidden };
		feature.data.captureWarning = undefined;
		remembered.delete(pending.sessionId);
		remembered.set(pending.sessionId, { request: { ...request, conversation: [] }, hidden: pending.hidden });
		if (remembered.size > MAX_REMEMBERED) remembered.delete(remembered.keys().next().value!);
	} catch {
		feature.snapshot = undefined;
		remembered.delete(pending.sessionId);
		feature.data.captureWarning = "Request capture unavailable; showing session projection";
	}
	invalidate(feature);
}

export function contextData(state: CrtState): Readonly<ContextData> {
	const feature = features.get(state);
	if (!feature) return NONE;
	finishPending(feature);
	read(feature);
	return feature.data;
}
export function contextUsage(state: CrtState): ContextUsage | undefined {
	return contextData(state).reportedUsage;
}

function read(feature: ContextFeature): void {
	const ctx = feature.env.context();
	if (!ctx) return;
	const selected = ctx.model;
	const built = feature.data.origin === "built";
	let fallbackTools: Tool[] = [];
	let fallbackPrompt = "";
	const readFallback = () => {
		const active = new Set(feature.pi.getActiveTools());
		fallbackTools = feature.pi.getAllTools().filter((tool) => active.has(tool.name));
		fallbackPrompt = ctx.getSystemPrompt();
	};
	if (built) readFallback();
	const definitionKey = () => JSON.stringify(fallbackTools.map(({ name, description, parameters }) => ({ name, description, parameters })));
	const key = [ctx.sessionManager.getSessionId(), ctx.sessionManager.getLeafId(), selected?.provider, selected?.api, selected?.id, selected?.contextWindow,
		built ? fallbackPrompt : undefined, built ? definitionKey() : undefined];
	if (feature.key && key.every((value, index) => value === feature.key![index])) return;
	if (!built) readFallback();
	const projection = ctx.sessionManager.buildSessionProjection();
	const branch = new Set(ctx.sessionManager.getBranch().map((entry) => entry.id));
	const captured = feature.snapshot;
	const snapshotApplies = captured && (captured.request.leafId === null ? projection.entries.length === 0 : branch.has(captured.request.leafId));
	const run = feature.runLoadout;
	const runApplies = run && (run.leafId === null || branch.has(run.leafId));
	const current = projectContext(projection, snapshotApplies ? captured : undefined, fallbackPrompt, fallbackTools, runApplies ? run.hidden : undefined);
	const contextParts = meter.measureContributions(current.contributions, current.prompt, current.tools, nextRequestModel(selected, current.branchMessages));
	Object.assign(feature.data, { contextParts, prompt: current.prompt, tools: current.tools, origin: current.origin, reportedUsage: ctx.getContextUsage() });
	feature.data.version++;
	key[6] = current.origin === "built" ? fallbackPrompt : undefined;
	key[7] = current.origin === "built" ? definitionKey() : undefined;
	feature.key = key;
}

export function setupContext(pi: ExtensionAPI, env: FeatureEnv): void {
	const feature: ContextFeature = { pi, env, data: { ...NONE, contextParts: [], tools: [] } };
	features.set(env.state, feature);
	// Pi retains this same settled reference through retry/continue; a new user run replaces it.
	let runOptions: { hiddenTools?: readonly string[]; forceSystemPrompt?: string } | undefined;
	const changed = () => invalidate(feature);
	const forget = (sessionId: string) => {
		cancelPending(feature);
		feature.snapshot = undefined;
		remembered.delete(sessionId);
	};
	pi.on("session_start", (_event, ctx) => {
		feature.snapshot = remembered.get(ctx.sessionManager.getSessionId());
		feature.runLoadout = undefined;
		changed();
	});
	pi.on("before_agent_start", (event) => { runOptions = event.systemPromptOptions; });
	pi.on("agent_start", (_event, ctx) => {
		feature.runLoadout = { leafId: ctx.sessionManager.getLeafId(), hidden: new Set(runOptions?.hiddenTools ?? []) };
		changed();
	});
	pi.on("context_with_system", (event, ctx) => {
		if (!ctx.hasUI) return;
		const sessionId = ctx.sessionManager.getSessionId();
		forget(sessionId);
		try {
			const prompt = ctx.getSystemPrompt();
			const knownPrompt = runOptions ? { forceSystemPrompt: runOptions.forceSystemPrompt === undefined ? undefined : prompt } : undefined;
			const hidden = new Set(runOptions?.hiddenTools ?? feature.runLoadout?.hidden ?? EMPTY_HIDDEN);
			feature.runLoadout = { leafId: ctx.sessionManager.getLeafId(), hidden };
			const build = prepareRequestCapture(ctx.sessionManager.buildSessionProjection(), event.messages, prompt, ctx.sessionManager.getLeafId(), knownPrompt);
			feature.pending = { build, sessionId, hidden };
			feature.timer = setImmediate(() => finishPending(feature));
			feature.timer.unref?.();
		} catch {
			feature.data.captureWarning = "Request capture unavailable; showing session projection";
		}
		changed();
	});
	pi.on("session_compact", (_event, ctx) => {
		forget(ctx.sessionManager.getSessionId());
		feature.runLoadout = undefined;
		changed();
	});
	pi.on("session_tree", () => {
		feature.runLoadout = undefined;
		changed();
	});
	pi.on("message_end", changed);
	pi.on("turn_end", changed);
	pi.on("agent_end", () => { feature.runLoadout = undefined; changed(); });
	pi.on("model_select", changed);
	pi.on("agent_settled", () => { runOptions = undefined; });
	pi.on("session_shutdown", () => {
		cancelPending(feature);
		feature.snapshot = undefined;
		feature.runLoadout = undefined;
		runOptions = undefined;
		features.delete(env.state);
	});
}
