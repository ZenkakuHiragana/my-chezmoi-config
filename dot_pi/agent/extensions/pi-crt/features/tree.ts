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

import type { ExtensionAPI, SessionTreeNode } from "@earendil-works/pi-coding-agent";
import type { CrtState } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/** /tree's filters, as its treeFilterMode setting names them. */
export type TreeFilterMode = NonNullable<ReturnType<ExtensionAPI["getSettings"]>["treeFilterMode"]>;

/** Name of the command that jumps to an entry. */
const COMMAND = "crt-tree";
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
}

interface TreeFeature {
	pi: ExtensionAPI;
	env: FeatureEnv;
	data: TreeState;
}

/** Each pi-crt instance's tree, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, TreeFeature>();

/** The tree, read again first when it is stale. Called while the panel is drawn. */
export function sessionTree(state: CrtState): Readonly<TreeState> {
	const feature = features.get(state);
	if (!feature) return { tree: [], leafId: null, version: 0, stale: true };
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

/** Jump to an entry, as choosing it in /tree does. */
export function jumpTo(state: CrtState, entryId: string): void {
	const pi = features.get(state)?.pi;
	if (!pi) return;
	// Without the command, the text would go to the model as a message.
	if (!pi.getCommands().some((command) => command.name === COMMAND)) return;
	void pi.sendUserMessage(`/${COMMAND} ${entryId}`, { expandPromptTemplates: true });
}

export function setupTree(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: TreeState = { tree: [], leafId: null, version: 0, stale: true };
	features.set(env.state, { pi, env, data });

	const markStale = (): void => {
		data.stale = true;
		if (env.shows("tree")) env.requestRender();
	};
	pi.on("session_start", markStale);
	pi.on("session_tree", markStale);
	pi.on("message_end", markStale);

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
			if (entryId === ctx.sessionManager.getLeafId()) {
				ctx.ui.notify("Already at this point", "info");
				return;
			}
			if (pi.getSettings().branchSummary?.skipPrompt) {
				await ctx.navigateTree(entryId, { summarize: false });
				return;
			}
			const choice = await ctx.ui.select("Summarize branch?", [NO_SUMMARY, SUMMARIZE, SUMMARIZE_CUSTOM]);
			if (choice === undefined) return;
			let customInstructions: string | undefined;
			if (choice === SUMMARIZE_CUSTOM) {
				customInstructions = await ctx.ui.editor("Custom summarization instructions");
				if (customInstructions === undefined) return;
			}
			await ctx.navigateTree(entryId, { summarize: choice !== NO_SUMMARY, customInstructions });
		},
	});
}
