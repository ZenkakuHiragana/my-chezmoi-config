/** Immutable startup counters; only numeric memo entries survive a count. */
import { createHash } from "node:crypto";
import { GptEncoding } from "gpt-tokenizer/GptEncoding";
import ranks from "gpt-tokenizer/bpeRanks/o200k_base";
import type { ModelIdentity } from "./context.ts";

export const chars4 = Object.freeze({ id: "chars4" as const, count: (text: string) => Math.ceil(text.length / 4) });
// Own this encoder: changing a shared package instance would affect other extensions.
const encoder = GptEncoding.getEncodingApi("o200k_base", () => ranks);
encoder.setMergeCacheSize(0);
const options = { allowedSpecial: new Set<string>(), disallowedSpecial: new Set<string>() };
const counts = new Map<string, number>();
const MAX_COUNTS = 1024;
function countO200k(text: string): number {
	if (!text) return 0;
	const key = createHash("sha256").update(text, "utf16le").digest("hex");
	const cached = counts.get(key);
	if (cached !== undefined) {
		counts.delete(key);
		counts.set(key, cached);
		return cached;
	}
	const tokens = encoder.countTokens(text, options);
	counts.set(key, tokens);
	if (counts.size > MAX_COUNTS) counts.delete(counts.keys().next().value!);
	return tokens;
}
const o200k = Object.freeze({ id: "o200k_base" as const, count: countO200k });
export const TEXT_COUNTERS = Object.freeze([chars4, o200k] as const);
export type CounterId = typeof TEXT_COUNTERS[number]["id"];
export interface TextCounter { readonly id: CounterId; readonly count: (text: string) => number }
export type TokenCounts = Readonly<Record<CounterId, number>>;
export function counterForModel(model: ModelIdentity | undefined): TextCounter {
	return model && /(?:^|\/)(?:gpt-|chatgpt-|o\d+(?:-|$))/i.test(model.id) ? o200k : chars4;
}
export function countText(text: string): TokenCounts {
	return Object.fromEntries(TEXT_COUNTERS.map((counter) => [counter.id, counter.count(text)])) as TokenCounts;
}
export function counted(value: TokenCounts, counter: TextCounter): number { return value[counter.id]; }
