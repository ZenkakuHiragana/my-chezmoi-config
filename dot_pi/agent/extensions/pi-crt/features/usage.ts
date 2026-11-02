/** Response allowance collection for STAT, through Pi's HTTP and stream events. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type CrtState, sanitize, type Versioned } from "../state/core.ts";
import { codexEventWindows, codexHeaderWindows, type RateLimitWindow } from "../state/usage.ts";
import type { FeatureEnv } from "./env.ts";

export interface UsageData extends Versioned {
	usageHeaders: Array<[string, string]>;
	/** Codex windows from response headers or a codex.rate_limits stream event. */
	usageWindows?: RateLimitWindow[];
	usageAt?: number;
	/** Model whose response the usage data came from. */
	usageModel?: string;
}

/** Each pi-crt instance's usage data, by its CrtState (see FeatureEnv). */
const collected = new WeakMap<CrtState, UsageData>();

/** Before setupUsage: nothing received. Never changed. */
const NONE: Readonly<UsageData> = Object.freeze({ usageHeaders: [], version: 0 });

/** The allowance the last response reported. */
export function usageData(state: CrtState): Readonly<UsageData> {
	return collected.get(state) ?? NONE;
}

export function setupUsage(pi: ExtensionAPI, env: FeatureEnv): void {
	const state: UsageData = { usageHeaders: [], version: 0 };
	collected.set(env.state, state);
	// HTTP headers belong to this request only; a later WebSocket request must
	// not inherit them. A stream update within the same SSE response keeps them.
	let hasResponseHeaders = false;
	pi.on("before_provider_request", () => { hasResponseHeaders = false; });
	pi.on("after_provider_response", (event, ctx) => {
		hasResponseHeaders = true;
		state.usageHeaders = Object.entries(event.headers)
			.filter(([name]) => /ratelimit|rate-limit|usage|x-codex/i.test(name))
			.map(([name, value]): [string, string] => [sanitize(name), sanitize(String(value))])
			.sort(([a], [b]) => a.localeCompare(b));
		state.usageWindows = codexHeaderWindows(state.usageHeaders);
		state.usageAt = Date.now();
		state.usageModel = ctx.model ? sanitize(`${ctx.model.provider}/${ctx.model.id}`) : undefined;
		env.changed(state);
	});

	// Codex WebSocket does not fire after_provider_response. The raw stream
	// carries the allowance before Pi normalizes the response events.
	pi.on("provider_stream_event", (event, ctx) => {
		if (event.provider !== "openai-codex" || ctx.model?.provider !== event.provider || ctx.model.id !== event.model) return;
		const windows = codexEventWindows(event.data);
		if (windows === undefined) return;
		if (!hasResponseHeaders) state.usageHeaders = [];
		state.usageWindows = windows;
		state.usageAt = Date.now();
		state.usageModel = sanitize(`${event.provider}/${event.model}`);
		env.changed(state);
	});

	// Switching to a WebSocket provider must not leave the previous provider's
	// header-only snapshot on screen while waiting for its first stream event.
	pi.on("model_select", () => {
		hasResponseHeaders = false;
		state.usageHeaders = [];
		state.usageWindows = undefined;
		state.usageAt = undefined;
		state.usageModel = undefined;
		env.changed(state);
	});
}
