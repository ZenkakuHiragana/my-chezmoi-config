/**
 * STAT › DETAIL › CONTEXT: what the latest request held, and Pi's context usage.
 *
 * The request is only kept when it is sent (context_with_system) and measured once,
 * off the render path, while the CONTEXT panel is shown. Pi's getContextUsage()
 * walks the whole branch, so it is called only when the session, its leaf or the
 * model changes. Pi does not tell when the leaf or the model changes, so reading
 * the data checks them, and a change gives the data a new version there.
 */
import type { ContextUsage, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ContextPart, ContextMeter } from "../state/context.ts";
import type { CrtState, Versioned } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

interface ContextFeature {
	env: FeatureEnv;
	data: ContextData;
	usageKey: string;
	usage?: ContextUsage;
}

interface ContextData extends Versioned {
	contextParts: ContextPart[];
}

/** Each pi-crt instance's context data, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, ContextFeature>();

/** Before setupContext: nothing measured. Never changed. */
const NONE: Readonly<{ contextParts: readonly ContextPart[]; version: number }> = Object.freeze({ contextParts: [], version: 0 });

/** The breakdown of the latest request that was measured; its version covers contextUsage too. */
export function contextData(state: CrtState): Readonly<{ contextParts: readonly ContextPart[]; version: number }> {
	const feature = features.get(state);
	if (!feature) return NONE;
	readUsage(feature);
	return feature.data;
}

/** Pi's context usage, recomputed only when the session, its leaf or the model changes. */
export function contextUsage(state: CrtState): ContextUsage | undefined {
	const feature = features.get(state);
	if (!feature) return undefined;
	readUsage(feature);
	return feature.usage;
}

function readUsage(feature: ContextFeature): void {
	const ctx = feature.env.context();
	if (!ctx) return;
	const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
	const key = `${ctx.sessionManager.getSessionId()}\n${ctx.sessionManager.getLeafId() ?? ""}\n${model}`;
	if (key === feature.usageKey) return;
	feature.usageKey = key;
	feature.usage = ctx.getContextUsage();
	// Read while drawing: the screen is being drawn already.
	feature.data.version++;
}

export function setupContext(pi: ExtensionAPI, env: FeatureEnv): void {
	const feature: ContextFeature = { env, data: { contextParts: [], version: 0 }, usageKey: "" };
	features.set(env.state, feature);
	const meter = new ContextMeter();
	let pending: readonly unknown[] | undefined;
	let scheduled = false;
	let closed = false;

	/** Measure the latest request once, off the render path, while the context panel is shown. */
	const schedule = () => {
		if (scheduled || !pending || !env.shows("context")) return;
		scheduled = true;
		setTimeout(() => {
			scheduled = false;
			const messages = pending;
			const ctx = env.context();
			if (!messages || !ctx || closed) return;
			pending = undefined;
			const activeNames = pi.getActiveTools();
			const activeSet = new Set(activeNames);
			feature.data.contextParts = meter.measure(messages, ctx.getSystemPrompt(), {
				names: activeNames,
				definitions: () => pi.getAllTools().filter((tool) => activeSet.has(tool.name)),
			});
			env.changed(feature.data);
		}, 0).unref?.();
	};

	env.onShownChange(schedule);

	pi.on("session_start", () => {
		feature.usageKey = "";
		feature.data.contextParts = [];
		env.changed(feature.data);
	});

	pi.on("session_tree", () => {
		pending = undefined;
		feature.data.contextParts = [];
		env.changed(feature.data);
	});

	// Only keep the request; it is measured when the context panel is shown.
	pi.on("context_with_system", (event) => {
		pending = event.messages;
		schedule();
	});

	pi.on("session_shutdown", () => {
		closed = true;
		pending = undefined;
	});
}
