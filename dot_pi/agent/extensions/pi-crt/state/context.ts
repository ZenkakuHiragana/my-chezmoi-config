/** Current/next-request estimates. Pi-reported usage is kept separately by the feature. */
import type { Tool } from "@earendil-works/pi-ai";
import { convertToLlm, estimateTokens } from "@earendil-works/pi-coding-agent";
import type { RequestMessage } from "./request-context.ts";

export interface ContextPart { label: string; tokens: number }
export interface ModelIdentity { provider: string; api: string; id: string }

export function textTokens(text: string): number {
	return estimateTokens({ role: "user", content: text, timestamp: 0 });
}

/** Same Definition text as pi-context-view; prompt-rendered tool guidelines count in SYSTEM. */
export function toolTokens(tool: Pick<Tool, "name" | "description" | "parameters">): number {
	return textTokens(`${tool.name}: ${tool.description ?? ""}\n${JSON.stringify(tool.parameters)}`);
}

/** Pi's virtual selection routes to a physical model; use the latest successful response. */
export function nextRequestModel(selected: ModelIdentity | undefined, messages: readonly RequestMessage[]): ModelIdentity | undefined {
	if (!selected || selected.api !== "pi-virtual") return selected;
	const latest = messages.findLast((message) => message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted");
	return latest?.role === "assistant" ? { provider: latest.provider, api: latest.api, id: latest.model } : undefined;
}

/** Stateless so changed tool arguments or same-length message edits cannot reuse stale estimates. */
export class ContextMeter {
	measure(messages: readonly RequestMessage[], prompt: string, tools: readonly Tool[], model: ModelIdentity | undefined): ContextPart[] {
		const totals = new Map<string, number>();
		const add = (label: string, tokens: number) => totals.set(label, (totals.get(label) ?? 0) + tokens);
		add("SYSTEM", textTokens(prompt));
		add("TOOLS", tools.reduce((sum, tool) => sum + toolTokens(tool), 0));
		for (const message of messages) {
			switch (message.role) {
				case "system": break; // Replayed prompt and declarations are counted above.
				case "assistant": {
					let text = "", thinking = "";
					for (const block of message.content) {
						if (block.type === "text") text += block.text;
						else if (block.type === "thinking") thinking += block.thinking;
						else if (block.type === "toolCall") add("TOOL CALLS", textTokens(block.name + JSON.stringify(block.arguments)));
					}
					add("ASSISTANT", textTokens(text));
					if (!model || (message.provider === model.provider && message.api === model.api && message.model === model.id)) {
						const reasoning: unknown = message.usage?.reasoning;
						const reported = typeof reasoning === "number" && Number.isFinite(reasoning) && reasoning >= 0 ? reasoning : 0;
						add("THINKING", Math.max(textTokens(thinking), reported));
					}
					break;
				}
				case "bashExecution":
				case "branchSummary":
				case "compactionSummary": {
					const converted = convertToLlm([message])[0];
					if (converted) add(message.role === "bashExecution" ? "BASH" : "COMPACTED", estimateTokens(converted));
					break;
				}
				default:
					add(message.role === "user" ? "USER" : message.role === "toolResult" ? "TOOL RESULTS" : "OTHER", estimateTokens(message));
			}
		}
		return [...totals].filter(([, tokens]) => tokens > 0).map(([label, tokens]) => ({ label, tokens })).sort((a, b) => b.tokens - a.tokens);
	}
}
