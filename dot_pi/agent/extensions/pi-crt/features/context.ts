/**
 * STAT › DETAIL › CONTEXT: what the latest request held, and Pi's context usage.
 *
 * The request is only kept when it is sent (context_with_system) and measured once,
 * off the render path, while the CONTEXT panel is shown. Pi's getContextUsage()
 * walks the whole branch, so it is called only when the session, its leaf or the
 * model changes.
 */
import type { ContextUsage, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ContextPart, ContextMeter } from "../state/context.ts";
import type { CrtState } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

interface ContextFeature {
	env: FeatureEnv;
	data: { contextParts: ContextPart[] };
	usageKey: string;
	usage?: ContextUsage;
}

/** Each pi-crt instance's context data, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, ContextFeature>();

/** Before setupContext: nothing measured. Never changed. */
const NONE: Readonly<{ contextParts: readonly ContextPart[] }> = Object.freeze({ contextParts: [] });

/** The breakdown of the latest request that was measured. */
export function contextData(state: CrtState): Readonly<{ contextParts: readonly ContextPart[] }> {
	return features.get(state)?.data ?? NONE;
}

/** Pi's context usage, recomputed only when the session, its leaf or the model changes. */
export function contextUsage(state: CrtState): ContextUsage | undefined {
	const feature = features.get(state);
	const ctx = feature?.env.context();
	if (!feature || !ctx) return undefined;
	const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
	const key = `${ctx.sessionManager.getSessionId()}\n${ctx.sessionManager.getLeafId() ?? ""}\n${model}`;
	if (key !== feature.usageKey) {
		feature.usageKey = key;
		feature.usage = ctx.getContextUsage();
	}
	return feature.usage;
}

export function setupContext(pi: ExtensionAPI, env: FeatureEnv): void {
	const feature: ContextFeature = { env, data: { contextParts: [] }, usageKey: "" };
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
			env.requestRender();
		}, 0).unref?.();
	};

	env.onShownChange(schedule);

	pi.on("session_start", () => {
		feature.usageKey = "";
		feature.data.contextParts = [];
	});

	pi.on("session_tree", () => {
		pending = undefined;
		feature.data.contextParts = [];
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
