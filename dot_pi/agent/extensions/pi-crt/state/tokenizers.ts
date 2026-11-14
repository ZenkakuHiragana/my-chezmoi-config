/** Immutable startup counters; only numeric memo entries survive a count. */
import { createHash } from "node:crypto";
import { GptEncoding } from "gpt-tokenizer/GptEncoding";
import ranks from "gpt-tokenizer/bpeRanks/o200k_base";
import { CTOK_FAMILIES, ctokContentTokens, ctokFamily, type CtokFamily } from "./ctok.ts";
import type { ModelIdentity } from "./context.ts";

export const chars4 = Object.freeze({ id: "chars4" as const, count: (text: string) => Math.ceil(text.length / 4) });
/** Above the distinct texts of a long branch: a full rescan of more would evict every entry before its reuse. */
const MAX_COUNTS = 8192;
/** A bounded memo keyed by a SHA-256 of the exact UTF-16 input: it keeps numbers, never the text. */
function memoized(count: (text: string) => number): (text: string) => number {
	const counts = new Map<string, number>();
	return (text) => {
		if (!text) return 0;
		const key = createHash("sha256").update(text, "utf16le").digest("hex");
		const cached = counts.get(key);
		if (cached !== undefined) {
			counts.delete(key);
			counts.set(key, cached);
			return cached;
		}
		const tokens = count(text);
		counts.set(key, tokens);
		if (counts.size > MAX_COUNTS) counts.delete(counts.keys().next().value!);
		return tokens;
	};
}
// Own this encoder: changing a shared package instance would affect other extensions.
const encoder = GptEncoding.getEncodingApi("o200k_base", () => ranks);
encoder.setMergeCacheSize(0);
const options = { allowedSpecial: new Set<string>(), disallowedSpecial: new Set<string>() };
const o200k = Object.freeze({ id: "o200k_base" as const, count: memoized((text) => encoder.countTokens(text, options)) });
export type CounterId = typeof chars4.id | typeof o200k.id | `ctok_${CtokFamily}`;
export interface TextCounter { readonly id: CounterId; readonly count: (text: string) => number }
/** One counter per ctok family, so a family ctok.ts adds is counted and selectable without another list. */
const CTOK = Object.freeze(Object.fromEntries(CTOK_FAMILIES.map((family) => [family, Object.freeze({ id: `ctok_${family}` as const, count: memoized((text) => ctokContentTokens(text, family)) })])) as Record<CtokFamily, TextCounter>);
export const TEXT_COUNTERS: readonly TextCounter[] = Object.freeze([chars4, o200k, ...CTOK_FAMILIES.map((family) => CTOK[family])]);
export type TokenCounts = Readonly<Record<CounterId, number>>;
/** A Claude model ID's version: claude-opus-4-8, claude-sonnet-4.6, claude-3-5-haiku, after any vendor prefix; never an 8-digit date. */
const CLAUDE_VERSION = /(?:^|[/.:])claude-(?:[a-z]+-)?(\d{1,2})(?:[-.](\d{1,2})(?!\d))?(?!\d)/i;
export function counterForModel(model: ModelIdentity | undefined): TextCounter {
	if (!model) return chars4;
	if (/(?:^|\/)(?:gpt-|chatgpt-|o\d+(?:-|$))/i.test(model.id)) return o200k;
	const version = CLAUDE_VERSION.exec(model.id);
	const family = version && ctokFamily(Number(version[1]), Number(version[2] ?? 0));
	return family ? CTOK[family] : chars4;
}
export function countText(text: string): TokenCounts {
	return Object.fromEntries(TEXT_COUNTERS.map((counter) => [counter.id, counter.count(text)])) as TokenCounts;
}
export function counted(value: TokenCounts, counter: TextCounter): number { return value[counter.id]; }
