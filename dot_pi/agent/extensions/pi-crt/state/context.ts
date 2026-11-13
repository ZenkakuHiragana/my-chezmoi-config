/** Display-specific message quantities. Raw conversation is needed only while deriving them. */
import type { Tool } from "@earendil-works/pi-ai";
import { convertToLlm, estimateTokens } from "@earendil-works/pi-coding-agent";
import type { RequestMessage } from "./request-context.ts";

export interface ContextPart { label: string; tokens: number }
export interface ModelIdentity { provider: string; api: string; id: string }
/** Fixed parts preserve per-message rounding and insertion order, including zero values. */
export interface MessageContribution {
	parts: readonly ContextPart[];
	/** Keep identity, not a capture-time eligibility bit: the selected model can change. */
	thinking?: { model: ModelIdentity; tokens: number };
}

export function textTokens(text: string): number {
	return estimateTokens({ role: "user", content: text, timestamp: 0 });
}
/** Same Definition text as pi-context-view; prompt-rendered guidelines count in SYSTEM. */
export function toolTokens(tool: Pick<Tool, "name" | "description" | "parameters">): number {
	return textTokens(`${tool.name}: ${tool.description ?? ""}\n${JSON.stringify(tool.parameters)}`);
}
/** Pi routes from recorded messages, not request-only edits. */
export function nextRequestModel(selected: ModelIdentity | undefined, messages: readonly RequestMessage[]): ModelIdentity | undefined {
	if (!selected || selected.api !== "pi-virtual") return selected;
	const latest = messages.findLast((message) => message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted");
	return latest?.role === "assistant" ? { provider: latest.provider, api: latest.api, id: latest.model } : undefined;
}

/** No text, arguments, images, signatures or rendering metadata leave this conversion. */
export function messageContribution(message: RequestMessage): MessageContribution {
	switch (message.role) {
		case "system": return { parts: [] };
		case "assistant": {
			const parts: ContextPart[] = [];
			let text = "", thinking = "";
			for (const block of message.content) {
				if (block.type === "text") text += block.text;
				else if (block.type === "thinking") thinking += block.thinking;
				else if (block.type === "toolCall") parts.push({ label: "TOOL CALLS", tokens: textTokens(block.name + JSON.stringify(block.arguments)) });
			}
			parts.push({ label: "ASSISTANT", tokens: textTokens(text) });
			const reasoning: unknown = message.usage?.reasoning;
			const reported = typeof reasoning === "number" && Number.isFinite(reasoning) && reasoning >= 0 ? reasoning : 0;
			return { parts, thinking: {
				model: { provider: message.provider, api: message.api, id: message.model },
				tokens: Math.max(textTokens(thinking), reported),
			} };
		}
		case "bashExecution":
		case "branchSummary":
		case "compactionSummary": {
			const converted = convertToLlm([message])[0];
			return { parts: converted ? [{ label: message.role === "bashExecution" ? "BASH" : "COMPACTED", tokens: estimateTokens(converted) }] : [] };
		}
		default: return { parts: [{ label: message.role === "user" ? "USER" : message.role === "toolResult" ? "TOOL RESULTS" : "OTHER", tokens: estimateTokens(message) }] };
	}
}

export class ContextMeter {
	measure(messages: readonly RequestMessage[], prompt: string, tools: readonly Tool[], model: ModelIdentity | undefined): ContextPart[] {
		return this.measureContributions(messages.map(messageContribution), prompt, tools, model);
	}
	measureContributions(contributions: Iterable<MessageContribution>, prompt: string, tools: readonly Tool[], model: ModelIdentity | undefined): ContextPart[] {
		const totals = new Map<string, number>();
		const add = (label: string, tokens: number) => totals.set(label, (totals.get(label) ?? 0) + tokens);
		add("SYSTEM", textTokens(prompt));
		add("TOOLS", tools.reduce((sum, tool) => sum + toolTokens(tool), 0));
		for (const contribution of contributions) {
			for (const part of contribution.parts) add(part.label, part.tokens);
			const thought = contribution.thinking;
			if (thought && (!model || (thought.model.provider === model.provider && thought.model.api === model.api && thought.model.id === model.id))) add("THINKING", thought.tokens);
		}
		return [...totals].filter(([, tokens]) => tokens > 0).map(([label, tokens]) => ({ label, tokens })).sort((a, b) => b.tokens - a.tokens);
	}
}
