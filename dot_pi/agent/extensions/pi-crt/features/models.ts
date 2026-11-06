/**
 * DATA › MODELS: the models Pi can switch to, the one in use and its thinking level.
 *
 * The list is either the session's scoped models (`enabledModels`, or `--models`) or
 * every model with authentication, as Pi's /model shows them. It starts the way /model
 * does: scoped when the session has scoped models, else all; the `s` key switches
 * between the two. pi-crt does not change the scope; /scoped-models does.
 *
 * Pi gives no event when the available or scoped models change, so models() reads
 * them again while the panel draws, and gives a new version when they changed.
 *
 * Switching uses pi.setModel(). It returns false only when the provider has no
 * authentication configured; Pi can still reject the switch with an error (the
 * authentication is configured but cannot be read), which is shown as it is.
 */
import { type Api, getSupportedThinkingLevels, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type CrtState, sanitize, type Versioned } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

export interface ModelItem {
	/** `provider/id`, which identifies the model. */
	key: string;
	provider: string;
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	images: boolean;
	/** Dollars per million tokens. */
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	/** The thinking levels Pi lets this model use. */
	thinkingLevels: readonly string[];
	model: Model<Api>;
}

export type ModelFilter = "scoped" | "all";

export interface ModelData extends Versioned {
	/** Every model with authentication. */
	available: ModelItem[];
	/** The session's scoped models; none when the session has no scope. */
	scoped: ModelItem[];
	/** The model in use, as `provider/id`. */
	current?: string;
	thinkingLevel?: string;
	/** The list shown: none until `s` is pressed, and then the default (see shownModels) applies. */
	filter?: ModelFilter;
	/** The model shown beside the list. */
	picked?: string;
	/** Why the last switch to a model failed, for that model. */
	failure?: { key: string; text: string };
	/** What was read last, to tell when Pi's lists changed (see models()). */
	read: ModelsRead;
}

/** The models read of Pi, and the model and thinking level in use. */
interface ModelsRead {
	available: readonly Model<Api>[];
	scoped: readonly Model<Api>[];
	current: string;
	thinkingLevel: string;
}

const NOTHING_READ: ModelsRead = Object.freeze({ available: [], scoped: [], current: "", thinkingLevel: "" });

interface ModelFeature {
	pi: ExtensionAPI;
	env: FeatureEnv;
	data: ModelData;
}

/** Each pi-crt instance's models, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, ModelFeature>();

/** Before setupModels: nothing read. Never changed. */
const NONE: Readonly<ModelData> = Object.freeze({ version: 0, available: [], scoped: [], read: NOTHING_READ });

function keyOf(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

function itemOf(model: Model<Api>): ModelItem {
	const cost = model.cost as Partial<ModelItem["cost"]> | undefined;
	return {
		key: sanitize(keyOf(model)),
		provider: sanitize(model.provider),
		id: sanitize(model.id),
		name: sanitize(model.name ?? model.id),
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		reasoning: model.reasoning,
		images: model.input.includes("image"),
		cost: { input: cost?.input ?? 0, output: cost?.output ?? 0, cacheRead: cost?.cacheRead ?? 0, cacheWrite: cost?.cacheWrite ?? 0 },
		thinkingLevels: getSupportedThinkingLevels(model),
		model,
	};
}

/**
 * The models, read again from Pi; a new version when they changed. Panels call this while drawing.
 *
 * The model objects are compared, so that a provider registered again (which gives its
 * models new objects with new costs and limits) is seen. Pi keeps the scoped models'
 * objects until the scope is set again, so a scoped model is taken from the available
 * ones when they have it, as Pi takes the scoped models it cycles through.
 */
export function models(state: CrtState): Readonly<ModelData> {
	const feature = features.get(state);
	if (!feature) return NONE;
	const { pi, env, data } = feature;
	const ctx = env.context();
	if (!ctx) return data;
	const available = ctx.modelRegistry.getAvailable();
	const byKey = new Map(available.map((model) => [keyOf(model), model]));
	const scoped = ctx.scopedModels.map(({ model }) => byKey.get(keyOf(model)) ?? model);
	const current = ctx.model ? keyOf(ctx.model) : undefined;
	const thinkingLevel = pi.getThinkingLevel();
	const read: ModelsRead = { available, scoped, current: current ?? "", thinkingLevel };
	if (sameRead(read, data.read)) return data;
	data.read = read;
	data.available = available.map(itemOf);
	data.scoped = scoped.map(itemOf);
	data.current = current && sanitize(current);
	data.thinkingLevel = thinkingLevel;
	unpickHidden(data);
	data.version++;
	return data;
}

/** A picked model that the list shown no longer has is unpicked, as the list no longer offers it. */
function unpickHidden(data: ModelData): void {
	if (data.picked !== undefined && !shownModels(data).some((item) => item.key === data.picked)) data.picked = undefined;
}

function sameRead(a: ModelsRead, b: ModelsRead): boolean {
	const same = (x: readonly Model<Api>[], y: readonly Model<Api>[]) => x.length === y.length && x.every((model, index) => model === y[index]);
	return a.current === b.current && a.thinkingLevel === b.thinkingLevel && same(a.available, b.available) && same(a.scoped, b.scoped);
}

/** The list shown: the chosen one, else scoped when the session has scoped models (as /model starts). */
export function modelFilter(data: Readonly<ModelData>): ModelFilter {
	return data.filter ?? (data.scoped.length ? "scoped" : "all");
}

export function shownModels(data: Readonly<ModelData>): readonly ModelItem[] {
	return modelFilter(data) === "scoped" ? data.scoped : data.available;
}

/** Show the scoped models instead of all, or all instead of the scoped ones. */
export function toggleModelFilter(state: CrtState): void {
	const feature = features.get(state);
	if (!feature) return;
	const { data, env } = feature;
	data.filter = modelFilter(data) === "scoped" ? "all" : "scoped";
	unpickHidden(data);
	env.changed(data);
}

/** Show a model beside the list. */
export function pickModel(state: CrtState, key: string | undefined): void {
	const feature = features.get(state);
	if (!feature || feature.data.picked === key) return;
	feature.data.picked = key;
	feature.env.changed(feature.data);
}

/** Switch the session to a model. Does nothing for the model in use. */
export function switchModel(state: CrtState, item: ModelItem): void {
	const feature = features.get(state);
	if (!feature) return;
	const { pi, env, data } = feature;
	if (item.key === data.current) return;
	if (data.failure) {
		data.failure = undefined;
		env.changed(data);
	}
	pi.setModel(item.model)
		.then((switched) => {
			if (!switched) data.failure = { key: item.key, text: `No authentication is configured for ${item.provider}.` };
		})
		.catch((error: unknown) => {
			data.failure = { key: item.key, text: sanitize(error instanceof Error ? error.message : String(error)) };
		})
		.finally(() => env.changed(data));
}

export function setupModels(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: ModelData = { version: 0, available: [], scoped: [], read: NOTHING_READ };
	features.set(env.state, { pi, env, data });
	const changed = (): void => env.changed(data);
	pi.on("session_start", changed);
	pi.on("model_select", changed);
	pi.on("thinking_level_select", changed);
}
