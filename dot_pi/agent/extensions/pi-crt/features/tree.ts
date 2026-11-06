/**
 * MAP › TREE: the session's tree of entries, and jumping to one of them.
 *
 * The tree comes from sessionManager.getTree(), which walks every entry of the session.
 * It is read again only while the TREE panel is drawn and the copy is stale, which it
 * becomes whenever an entry is added or pi moves to another point.
 *
 * Jumping works like /tree: pi asks whether to summarize the branch being left, then
 * moves; with /tree's setting to skip that question (branchSummary.skipPrompt), it
 * moves without a summary. navigateTree() is only on the context a command receives,
 * so the panel sends the command `/crt-tree <entry id>` through sendUserMessage(); pi
 * runs an extension command before anything reaches the model.
 */

import { copyToClipboard, type ExtensionAPI, type SessionTreeNode } from "@earendil-works/pi-coding-agent";
import type { CrtState } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/** /tree's filters, as its treeFilterMode setting names them. */
export type TreeFilterMode = NonNullable<ReturnType<ExtensionAPI["getSettings"]>["treeFilterMode"]>;

/** Name of the command that jumps to an entry. */
const COMMAND = "crt-tree";
/** How often a shown TREE looks for entries Pi added without an event. */
const LEAF_CHECK_MS = 1000;
/** Choices of the summary question, as /tree words them. */
const NO_SUMMARY = "No summary";
const SUMMARIZE = "Summarize";
const SUMMARIZE_CUSTOM = "Summarize with custom prompt";

interface TreeState {
	tree: SessionTreeNode[];
	/** The entry pi is at now. */
	leafId: string | null;
	/** Changes whenever `tree` or `leafId` is read again. */
	version: number;
	/** The copy no longer matches the session. */
	stale: boolean;
	/**
	 * The user or custom message pi-crt jumped to, until pi moves otherwise: the jump put
	 * pi before it, at its parent, which is also where any other child of the parent
	 * starts. Pi does not record which child was picked; TREE shows HERE on it.
	 */
	before?: { entryId: string; leafId: string | null };
	/** pi-crt's own jump is under way: the session_tree it causes keeps `before`. */
	jumping: boolean;
}

interface TreeFeature {
	pi: ExtensionAPI;
	env: FeatureEnv;
	data: TreeState;
}

/** Each pi-crt instance's tree, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, TreeFeature>();

/**
 * Whether a jump to an entry puts pi before it rather than after it: Pi's navigateTree
 * moves to the parent of a user or custom message and puts its text in the editor.
 */
export function jumpsBefore(entry: SessionTreeNode["entry"]): boolean {
	return entry.type === "custom_message" || (entry.type === "message" && entry.message.role === "user");
}

/** The user or custom message pi is before after jumping to it, if pi has not moved since. */
export function jumpedBefore(state: CrtState): string | undefined {
	const data = features.get(state)?.data;
	return data?.before && data.before.leafId === data.leafId ? data.before.entryId : undefined;
}

/** The tree, read again first when it is stale. Called while the panel is drawn. */
export function sessionTree(state: CrtState): Readonly<TreeState> {
	const feature = features.get(state);
	if (!feature) return { tree: [], leafId: null, version: 0, stale: true, jumping: false };
	const { data } = feature;
	if (data.stale) {
		const ctx = feature.env.context();
		if (ctx) {
			data.tree = ctx.sessionManager.getTree();
			data.leafId = ctx.sessionManager.getLeafId();
			data.stale = false;
			data.version++;
		}
	}
	return data;
}

/** The filter /tree starts with (the treeFilterMode setting). */
export function initialFilter(state: CrtState): TreeFilterMode {
	return features.get(state)?.pi.getSettings().treeFilterMode ?? "default";
}

/**
 * Whether an entry's label can be changed now. Pi appends the change as an entry
 * after the one it is at, so not while the agent is adding its own; says why not.
 */
export function canLabel(state: CrtState): boolean {
	const feature = features.get(state);
	if (!feature) return false;
	if (!feature.env.state.agentRunning) return true;
	feature.env.context()?.ui.notify("Wait for the agent to finish before changing a label.", "warning");
	return false;
}

/** Set an entry's label, or remove it when `label` is empty, as /tree's label key does. */
export function setEntryLabel(state: CrtState, entryId: string, label: string): void {
	const feature = features.get(state);
	if (!feature || !canLabel(state)) return;
	const { data } = feature;
	const leafId = feature.env.context()?.sessionManager.getLeafId() ?? null;
	feature.pi.setLabel(entryId, label.trim() || undefined);
	// Pi adds the change as an entry after the one it is at and moves there; pi is still
	// before the message it jumped to.
	if (data.before?.leafId === leafId) data.before.leafId = feature.env.context()?.sessionManager.getLeafId() ?? null;
	// Pi gives no event for a label change.
	data.stale = true;
	feature.env.requestRender();
}

/** Put an entry's text on the clipboard, as /tree's copy key does; says how it went. */
export function copyEntry(state: CrtState, text: string | undefined): void {
	const ui = features.get(state)?.env.context()?.ui;
	if (!ui) return;
	if (!text?.trim()) {
		ui.notify("Selected entry has no text to copy", "warning");
		return;
	}
	copyToClipboard(text).then(
		() => ui.notify("Copied selected message to clipboard", "info"),
		(error: unknown) => ui.notify(error instanceof Error ? error.message : String(error), "error"),
	);
}

/** Jump to an entry, as choosing it in /tree does. */
export function jumpTo(state: CrtState, entryId: string): void {
	const pi = features.get(state)?.pi;
	if (!pi) return;
	// Without the command, the text would go to the model as a message.
	if (!pi.getCommands().some((command) => command.name === COMMAND)) return;
	void pi.sendUserMessage(`/${COMMAND} ${entryId}`, { expandPromptTemplates: true });
}

export function setupTree(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: TreeState = { tree: [], leafId: null, version: 0, stale: true, jumping: false };
	features.set(env.state, { pi, env, data });

	const markStale = (): void => {
		data.stale = true;
		if (env.shows("tree")) env.requestRender();
	};
	// Any move but pi-crt's own jump ends what that jump recorded.
	const moved = (): void => {
		if (!data.jumping) data.before = undefined;
		markStale();
	};
	pi.on("session_start", moved);
	pi.on("session_tree", moved);
	pi.on("message_end", moved);
	// Pi adds an entry for a new model or thinking level and moves to it.
	pi.on("model_select", moved);
	pi.on("thinking_level_select", moved);
	// Pi adds some entries without an event (a model set again to the one in use, say).
	// Every entry it adds becomes the leaf, so a shown TREE looks at the leaf every
	// LEAF_CHECK_MS, as the git panels read git again while shown; reading the leaf id
	// costs nothing next to reading the tree, which happens only once it moved.
	let timer: ReturnType<typeof setInterval> | undefined;
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI || timer) return;
		timer = setInterval(() => {
			if (env.shows("tree") && !data.stale && env.context()?.sessionManager.getLeafId() !== data.leafId) moved();
		}, LEAF_CHECK_MS);
		timer.unref?.();
	});
	pi.on("session_shutdown", () => {
		if (timer) clearInterval(timer);
		timer = undefined;
	});

	pi.registerCommand(COMMAND, {
		description: "Jump to a point picked in MAP › TREE",
		handler: async (args, ctx) => {
			const entryId = args.trim();
			if (!entryId) return;
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the agent to finish before moving in the tree.", "warning");
				return;
			}
			if (!ctx.sessionManager.getEntry(entryId)) {
				ctx.ui.notify("That point is not in this session.", "warning");
				return;
			}
			if (entryId === ctx.sessionManager.getLeafId() || (entryId === data.before?.entryId && data.before.leafId === ctx.sessionManager.getLeafId())) {
				ctx.ui.notify("Already at this point", "info");
				return;
			}
			const target = ctx.sessionManager.getEntry(entryId)!;
			const go = async (options: { summarize: boolean; customInstructions?: string }): Promise<void> => {
				// Jumping to a user or custom message puts pi at its parent, with the message
				// in the editor. Recorded before the jump, so that the tree read while Pi moves
				// has it; with a summary pi ends up elsewhere, and jumpedBefore no longer
				// applies. A jump that does not happen leaves what was there.
				const previous = data.before;
				data.before = jumpsBefore(target) ? { entryId, leafId: target.parentId } : undefined;
				data.jumping = true;
				let cancelled = true;
				try {
					cancelled = (await ctx.navigateTree(entryId, options)).cancelled;
				} finally {
					data.jumping = false;
					if (cancelled) data.before = previous;
					markStale();
				}
			};
			if (pi.getSettings().branchSummary?.skipPrompt) {
				await go({ summarize: false });
				return;
			}
			const choice = await ctx.ui.select("Summarize branch?", [NO_SUMMARY, SUMMARIZE, SUMMARIZE_CUSTOM]);
			if (choice === undefined) return;
			let customInstructions: string | undefined;
			if (choice === SUMMARIZE_CUSTOM) {
				customInstructions = await ctx.ui.editor("Custom summarization instructions");
				if (customInstructions === undefined) return;
			}
			await go({ summarize: choice !== NO_SUMMARY, customInstructions });
		},
	});
}
