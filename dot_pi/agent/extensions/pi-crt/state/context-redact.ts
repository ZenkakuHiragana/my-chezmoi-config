/** Retained request estimates need neither image bytes nor opaque provider signatures. */
import type { RequestMessage } from "./request-context.ts";

/** Adapted from pi-context-view 0.8.4 capture/redact.ts; see THIRD_PARTY_NOTICES.md. */
export function redactMessage(message: RequestMessage): RequestMessage {
	if (message.role === "assistant") {
		return { ...message, content: message.content.map((block) => {
			if (block.type === "text") {
				const { textSignature: _signature, ...rest } = block;
				return rest;
			}
			if (block.type === "thinking") {
				const { thinkingSignature: _signature, ...rest } = block;
				return rest;
			}
			const { thoughtSignature: _signature, ...rest } = block;
			return rest;
		}) };
	}
	if (message.role === "user" || message.role === "custom" || message.role === "toolResult") {
		const content = Array.isArray(message.content)
			? message.content.map((block) => block.type === "image" ? { ...block, data: "<image omitted>" } : block)
			: message.content;
		// Rendering metadata is neither sent to the model nor counted by our estimates.
		const { details: _details, ...rest } = message as RequestMessage & { details?: unknown };
		return { ...rest, content } as RequestMessage;
	}
	return message;
}
