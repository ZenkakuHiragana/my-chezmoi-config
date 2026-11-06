/**
 * The CONTEXT breakdown. ContextMeter.measure walks every message of one request
 * (bounded by the model's context window), once per request, from a timer
 * outside rendering (features/context.ts).
 */
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { estimateTokens } from "@earendil-works/pi-coding-agent";

export interface ContextPart {
	label: string;
	tokens: number;
}

type ContextMessage = { role?: string; timestamp?: number; content?: unknown };

/** Pi's estimate for a text, as for the text of a user message. */
export function textTokens(text: string): number {
	return estimateTokens({ role: "user", content: [{ type: "text", text }], timestamp: 0 } as Parameters<typeof estimateTokens>[0]);
}

/**
 * Estimates the parts of a request: the system prompt, tool definitions and the
 * messages by role, with Pi's own estimator (characters / 4). The prompt and the
 * tools are the ones the request's system messages declare (pi-ai replays them).
 * Assistant messages with tool calls are the only messages whose estimate needs JSON
 * serialisation, so their estimates are remembered by a fingerprint that takes no
 * serialisation.
 */
export class ContextMeter {
	private remembered = new Map<string, number>();

	measure(messages: readonly unknown[]): ContextPart[] {
		const totals = new Map<string, number>();
		const add = (label: string, tokens: number) => totals.set(label, (totals.get(label) ?? 0) + tokens);
		const transcript = messages as Parameters<typeof getCurrentTools>[0];
		add("SYSTEM", textTokens(getCurrentSystemPrompt(transcript)));
		add("TOOLS", textTokens(JSON.stringify(getCurrentTools(transcript))));
		const remembered = new Map<string, number>();
		for (const message of messages) {
			const msg = message as ContextMessage;
			// The system messages are measured above, as the prompt and the tools they declare.
			if (!msg || msg.role === "system") continue;
			add(roleLabel(msg.role), this.estimate(msg, remembered));
		}
		this.remembered = remembered;
		return [...totals.entries()]
			.filter(([, tokens]) => tokens > 0)
			.map(([label, tokens]) => ({ label, tokens }))
			.sort((a, b) => b.tokens - a.tokens);
	}

	private estimate(msg: ContextMessage, remembered: Map<string, number>): number {
		const blocks = msg.role === "assistant" && Array.isArray(msg.content) ? (msg.content as Array<Record<string, unknown>>) : undefined;
		if (!blocks?.some((block) => block?.type === "toolCall")) return estimateTokens(msg as Parameters<typeof estimateTokens>[0]);
		const key = fingerprint(msg.timestamp, blocks);
		const tokens = this.remembered.get(key) ?? remembered.get(key) ?? estimateTokens(msg as Parameters<typeof estimateTokens>[0]);
		remembered.set(key, tokens);
		return tokens;
	}
}

function fingerprint(timestamp: number | undefined, blocks: Array<Record<string, unknown>>): string {
	let key = String(timestamp ?? "");
	for (const block of blocks) {
		const size =
			typeof block?.text === "string"
				? block.text.length
				: typeof block?.thinking === "string"
					? block.thinking.length
					: String(block?.id ?? "");
		key += `|${String(block?.type)}:${size}`;
	}
	return key;
}

function roleLabel(role: string | undefined): string {
	switch (role) {
		case "user":
			return "USER";
		case "assistant":
			return "ASSISTANT";
		case "toolResult":
			return "TOOL RESULTS";
		default:
			return "OTHER";
	}
}
