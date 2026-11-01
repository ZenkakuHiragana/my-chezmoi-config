/**
 * What the shell and several features share about the running pi-crt instance.
 * Each feature keeps its own data in its own file, keyed by this object (see
 * features/env.ts).
 */

export interface CrtState {
	agentRunning: boolean;
	agentStartedAt?: number;
	/** The agent finished while no page with the transcript was shown. */
	termAttention: boolean;
}

export function createState(): CrtState {
	return { agentRunning: false, termAttention: false };
}

/**
 * Remove control characters from text that comes from the model, tools, git or
 * HTTP headers. Panels draw it raw, so an embedded escape sequence would
 * otherwise reach the terminal as a command (for example OSC 52 clipboard writes).
 */
export function sanitize(text: string): string {
	return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}
