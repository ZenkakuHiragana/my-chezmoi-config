/** Capture only numeric quantities; measure still-available branch text on demand. */
import type { Tool } from "@earendil-works/pi-ai";
import { convertToLlm, estimateTokens } from "@earendil-works/pi-coding-agent";
import { chars4, counted, counterForModel, TEXT_COUNTERS, type TextCounter, type TokenCounts } from "./tokenizers.ts";
import type { RequestMessage } from "./request-context.ts";

export interface ContextPart { label: string; tokens: number }
export interface ModelIdentity { provider: string; api: string; id: string }
export interface MessageContribution {
	parts: readonly { label: string; tokens: TokenCounts }[];
	thinking?: { model: ModelIdentity; tokens: TokenCounts };
}
/** Transient input to measurement, never retained in a request snapshot or display data. */
export type MessageSource = { message: RequestMessage } | { contribution: MessageContribution };
interface TextPart { label: string; text: string; extra: number }
interface MessageText {
	parts: TextPart[];
	thinking?: { model: ModelIdentity; text: string; reported: number };
}
interface MeasuredMessage { parts: readonly ContextPart[]; thinking?: { model: ModelIdentity; tokens: number } }

export function textTokens(text: string, counter: TextCounter = chars4): number { return counter.count(text); }
/** Shared with INV; prompt-rendered guidelines belong in SYSTEM. */
export function toolTokens(tool: Pick<Tool, "name" | "description" | "parameters">, counter: TextCounter = chars4): number {
	return textTokens(`${tool.name}: ${tool.description ?? ""}\n${JSON.stringify(tool.parameters)}`, counter);
}
export function nextRequestModel(selected: ModelIdentity | undefined, messages: readonly RequestMessage[]): ModelIdentity | undefined {
	if (!selected || selected.api !== "pi-virtual") return selected;
	const latest = messages.findLast((message) => message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted");
	return latest?.role === "assistant" ? { provider: latest.provider, api: latest.api, id: latest.model } : undefined;
}

function contentPart(label: string, message: Extract<RequestMessage, { content: unknown }>): TextPart {
	const text = typeof message.content === "string" ? message.content : message.content.filter((block) => block.type === "text").map((block) => block.type === "text" ? block.text : "").join("");
	return { label, text, extra: estimateTokens(message) - chars4.count(text) };
}
/** One owner for role conversion, per-message boundaries and nontext/image estimates. */
function messageText(message: RequestMessage): MessageText {
	switch (message.role) {
		case "system": return { parts: [] };
		case "assistant": {
			const parts: TextPart[] = [];
			let text = "", thinking = "";
			for (const block of message.content) {
				if (block.type === "text") text += block.text;
				else if (block.type === "thinking") thinking += block.thinking;
				else if (block.type === "toolCall") parts.push({ label: "TOOL CALLS", text: block.name + JSON.stringify(block.arguments), extra: 0 });
			}
			parts.push({ label: "ASSISTANT", text, extra: 0 });
			const reasoning: unknown = message.usage?.reasoning;
			return { parts, thinking: {
				model: { provider: message.provider, api: message.api, id: message.model }, text: thinking,
				reported: typeof reasoning === "number" && Number.isFinite(reasoning) && reasoning >= 0 ? reasoning : 0,
			} };
		}
		case "bashExecution":
		case "branchSummary":
		case "compactionSummary": {
			const converted = convertToLlm([message])[0];
			return { parts: converted ? [contentPart(message.role === "bashExecution" ? "BASH" : "COMPACTED", converted)] : [] };
		}
		default: return { parts: [contentPart(message.role === "user" ? "USER" : message.role === "toolResult" ? "TOOL RESULTS" : "OTHER", message)] };
	}
}
function partTokens(part: TextPart, counter: TextCounter): number { return counter.count(part.text) + part.extra; }
function thoughtTokens(thought: NonNullable<MessageText["thinking"]>, counter: TextCounter): number { return Math.max(counter.count(thought.text), thought.reported); }
function allCounts(count: (counter: TextCounter) => number): TokenCounts {
	return Object.fromEntries(TEXT_COUNTERS.map((counter) => [counter.id, count(counter)])) as TokenCounts;
}
/** Raw request-only payloads do not leave this conversion. */
export function messageContribution(message: RequestMessage): MessageContribution {
	const units = messageText(message);
	return {
		parts: units.parts.map((part) => ({ label: part.label, tokens: allCounts((counter) => partTokens(part, counter)) })),
		...(units.thinking ? { thinking: { model: units.thinking.model, tokens: allCounts((counter) => thoughtTokens(units.thinking!, counter)) } } : {}),
	};
}
function measureSource(source: MessageSource, counter: TextCounter): MeasuredMessage {
	if ("message" in source) {
		const units = messageText(source.message);
		return { parts: units.parts.map((part) => ({ label: part.label, tokens: partTokens(part, counter) })),
			...(units.thinking ? { thinking: { model: units.thinking.model, tokens: thoughtTokens(units.thinking, counter) } } : {}) };
	}
	const contribution = source.contribution;
	return { parts: contribution.parts.map((part) => ({ label: part.label, tokens: counted(part.tokens, counter) })),
		...(contribution.thinking ? { thinking: { model: contribution.thinking.model, tokens: counted(contribution.thinking.tokens, counter) } } : {}) };
}
export class ContextMeter {
	measure(messages: readonly RequestMessage[], prompt: string, tools: readonly Tool[], model: ModelIdentity | undefined): ContextPart[] {
		return this.measureSources(messages.map((message) => ({ message })), prompt, tools, model);
	}
	measureContributions(contributions: Iterable<MessageContribution>, prompt: string, tools: readonly Tool[], model: ModelIdentity | undefined): ContextPart[] {
		return this.measureSources(Array.from(contributions, (contribution) => ({ contribution })), prompt, tools, model);
	}
	measureSources(sources: Iterable<MessageSource>, prompt: string, tools: readonly Tool[], model: ModelIdentity | undefined): ContextPart[] {
		const counter = counterForModel(model), totals = new Map<string, number>();
		const add = (label: string, tokens: number) => totals.set(label, (totals.get(label) ?? 0) + tokens);
		add("SYSTEM", textTokens(prompt, counter));
		add("TOOLS", tools.reduce((sum, tool) => sum + toolTokens(tool, counter), 0));
		for (const source of sources) {
			const contribution = measureSource(source, counter);
			for (const part of contribution.parts) add(part.label, part.tokens);
			const thought = contribution.thinking;
			if (thought && (!model || (thought.model.provider === model.provider && thought.model.api === model.api && thought.model.id === model.id))) add("THINKING", thought.tokens);
		}
		return [...totals].filter(([, tokens]) => tokens > 0).map(([label, tokens]) => ({ label, tokens })).sort((a, b) => b.tokens - a.tokens);
	}
}
