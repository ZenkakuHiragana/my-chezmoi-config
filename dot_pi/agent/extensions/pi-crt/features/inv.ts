/**
 * INV: what the agent carries — the system prompt by part, the tools and the
 * skills — with rough token counts (Pi's estimate, characters / 4). The panels in
 * panels/inv.ts read them through the functions here, which take the pi-crt
 * instance's state (see FeatureEnv).
 *
 * The parts of the system prompt are its named sections as the session records
 * them: the first request of a session stores a system message with every section,
 * and later changes patch sections by name (docs/session-format.md). pi-ai's
 * getCurrentSystemMessage replays those messages into the current set. The total is
 * the prompt Pi sends (getSystemPrompt), which an extension may have replaced, so
 * what the sections do not cover is shown as the rest. The prompt is read at
 * session_start, after each turn (the request has stored its system message by
 * then) and after a move in the tree.
 *
 * The skills start as the ones Pi has loaded, read at session_start through
 * getCommands(), so the list is there before the first request. The options of
 * each request then replace them: Pi hands those to extensions only in
 * before_agent_start, and other extensions may still change them after pi-crt's
 * handler, so they are read at agent_start. getCommands() does not say which
 * skills only the user can invoke, so that stays unknown until a request says it.
 */
import { open } from "node:fs/promises";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { textTokens } from "../state/context.ts";
import { type CrtState, sanitize } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/** A part of the system prompt: its instruction text, or one of its named sections. */
export interface PromptPart {
	label: string;
	text: string;
	tokens: number;
}

export interface PromptInventory {
	text: string;
	tokens: number;
	/** Empty before the session's first request has stored the prompt. */
	parts: PromptPart[];
	/** Tokens in no part: what the prompt Pi sends has beyond the recorded parts. */
	rest: number;
}

export interface ToolItem {
	name: string;
	description: string;
	/** Declared to the model in every request. */
	active: boolean;
	exposure: string;
	/** Tokens of the definition the model gets (name, description, parameters). */
	tokens: number;
	parameters: unknown;
	guidelines: readonly string[];
	source: string;
}

export interface SkillItem {
	name: string;
	description: string;
	filePath: string;
	/**
	 * In the skill list of the system prompt (skills that only the user can invoke are
	 * not). Undefined until a request says it.
	 */
	listed?: boolean;
	/** Tokens of the skill's entry in that list, in every request; 0 while `listed` is unknown. */
	tokens: number;
	/** The skill file, read in the background; at most BODY_BYTES of it. */
	body?: string;
	bodyCut?: boolean;
	bodyTokens?: number;
	bodyError?: string;
}

/** Skills listed at most, and bytes read of each skill file. */
const MAX_SKILLS = 200;
const BODY_BYTES = 256 * 1024;

/** A skill as a request's options or Pi's loaded skills give it. */
interface GivenSkill {
	name: string;
	description: string;
	filePath: string;
	/** Absent when the skill comes from getCommands(), which does not carry it. */
	disableModelInvocation?: boolean;
}

/** The part of the request options that INV reads (Pi's NormalizedBuildSystemPromptOptions). */
interface PromptOptions {
	skills?: GivenSkill[];
}

/** One pi-crt instance's inventory. */
interface Inventory {
	pi: ExtensionAPI;
	env: FeatureEnv;
	prompt?: PromptInventory;
	skills: SkillItem[];
	/** Whether the skills have been given yet. */
	skillsKnown: boolean;
	tools: ToolItem[];
	toolsKey: string;
	/** Changes whenever the prompt, the skills, the tools or a pick change. */
	version: number;
	/** The label of the picked part; none: the whole prompt. */
	part?: string;
	tool?: string;
	skill?: string;
}

/** Each pi-crt instance's inventory, by its CrtState (see FeatureEnv). */
const inventories = new WeakMap<CrtState, Inventory>();

/** The tools before setupInventory. */
const NO_TOOLS: readonly ToolItem[] = [];

export function prompt(state: CrtState): PromptInventory | undefined {
	return inventories.get(state)?.prompt;
}

export function skills(state: CrtState): { known: boolean; items: readonly SkillItem[] } {
	const inv = inventories.get(state);
	return inv ? { known: inv.skillsKnown, items: inv.skills } : { known: false, items: [] };
}

/**
 * The tools, rebuilt when the set of tools or of active tools changes. Panels
 * call this while drawing; reading the two lists is cheap next to drawing.
 */
export function tools(state: CrtState): readonly ToolItem[] {
	const inv = inventories.get(state);
	if (!inv) return NO_TOOLS;
	const active = inv.pi.getActiveTools();
	const all = inv.pi.getAllTools();
	const key = `${all.map((tool) => tool.name).join("\n")}\n\n${active.join("\n")}`;
	if (key === inv.toolsKey) return inv.tools;
	const activeSet = new Set(active);
	inv.toolsKey = key;
	inv.tools = all.map((tool) => ({
		name: sanitize(tool.name),
		description: sanitize(tool.description ?? ""),
		active: activeSet.has(tool.name),
		exposure: tool.exposure,
		tokens: textTokens(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })),
		parameters: tool.parameters,
		guidelines: (tool.promptGuidelines ?? []).map(sanitize),
		source: sanitize(tool.sourceInfo?.path ?? ""),
	}));
	if (inv.tool !== undefined && !inv.tools.some((tool) => tool.name === inv.tool)) inv.tool = undefined;
	inv.version++;
	return inv.tools;
}

/** Changes whenever the prompt, the skills, the tools or a pick change. */
export function version(state: CrtState): number {
	return inventories.get(state)?.version ?? 0;
}

export function picks(state: CrtState): { part?: string; tool?: string; skill?: string } {
	const inv = inventories.get(state);
	return inv ? { part: inv.part, tool: inv.tool, skill: inv.skill } : {};
}

/** Show one part of the prompt by its label, or the whole prompt (none). */
export function pickPart(state: CrtState, label: string | undefined): void {
	const inv = inventories.get(state);
	if (!inv || inv.part === label) return;
	inv.part = label;
	inv.env.changed(inv);
}

export function pickTool(state: CrtState, name: string | undefined): void {
	const inv = inventories.get(state);
	if (!inv || inv.tool === name) return;
	inv.tool = name;
	inv.env.changed(inv);
}

export function pickSkill(state: CrtState, name: string | undefined): void {
	const inv = inventories.get(state);
	if (!inv || inv.skill === name) return;
	inv.skill = name;
	inv.env.changed(inv);
}

export function setupInventory(pi: ExtensionAPI, env: FeatureEnv): void {
	const inv: Inventory = { pi, env, skills: [], skillsKnown: false, tools: [], toolsKey: "", version: 0 };
	inventories.set(env.state, inv);
	/** The options of the request being started, read once the other extensions are done with them. */
	let pending: PromptOptions | undefined;

	/** Measure the prompt Pi sends now, keeping the picked part when it is still there. */
	const readPrompt = (ctx: ExtensionContext) => {
		inv.prompt = measurePrompt(ctx);
		if (!inv.prompt.parts.some((part) => part.label === inv.part)) inv.part = undefined;
		env.changed(inv);
	};

	pi.on("session_start", (_event, ctx) => {
		readPrompt(ctx);
		setSkills(inv, loadedSkills(pi), false);
	});
	pi.on("turn_end", (_event, ctx) => readPrompt(ctx));
	pi.on("session_tree", (_event, ctx) => readPrompt(ctx));

	pi.on("before_agent_start", (event) => {
		pending = event.systemPromptOptions as PromptOptions;
	});

	pi.on("agent_start", () => {
		const options = pending;
		pending = undefined;
		if (options) setSkills(inv, options.skills ?? [], true);
	});
}

/** The skills Pi has loaded, as its slash commands list them. */
function loadedSkills(pi: ExtensionAPI): GivenSkill[] {
	return pi
		.getCommands()
		.filter((command) => command.source === "skill")
		.map((command) => ({
			name: command.name.replace(/^skill:/, ""),
			description: command.description ?? "",
			filePath: command.sourceInfo.path,
		}));
}

/** Labels of the sections Pi writes itself. */
const SECTION_LABELS: Readonly<Record<string, string>> = {
	preamble: "PREAMBLE",
	tools: "TOOL LIST",
	rules: "RULES",
	docs: "PI DOCS",
	addendum: "ADDENDUM",
	project_context: "PROJECT CONTEXT",
	skills: "SKILL LIST",
	cwd: "CWD",
};

/** The prompt Pi sends, by the parts the session records for it. */
function measurePrompt(ctx: ExtensionContext): PromptInventory {
	const text = ctx.getSystemPrompt();
	const tokens = textTokens(text);
	const system = getCurrentSystemMessage(ctx.sessionManager.buildSessionProjection().messages);
	const parts: PromptPart[] = [];
	const add = (label: string, part: string) => {
		if (part.trim()) parts.push({ label, text: part, tokens: textTokens(part) });
	};
	if (system) {
		const content = typeof system.content === "string" ? system.content : system.content.map((block) => block.text).join("\n");
		add("PROMPT TEXT", content);
		for (const [name, section] of Object.entries(system.sections ?? {})) {
			if (section !== null) add(SECTION_LABELS[name] ?? `<${name}>`, section);
		}
	}
	const counted = parts.reduce((sum, part) => sum + part.tokens, 0);
	return { text, tokens, parts, rest: Math.max(0, tokens - counted) };
}

/**
 * Take a set of skills; read the files of a new set in the background. A request's
 * set also settles which skills are listed; the loaded set leaves an unchanged list
 * as it is, since a request may have settled it already.
 */
function setSkills(inv: Inventory, skillList: readonly GivenSkill[], fromRequest: boolean): void {
	const given = skillList.slice(0, MAX_SKILLS);
	const key = given.map((skill) => `${skill.name}\n${skill.filePath}`).join("\n");
	inv.skillsKnown = true;
	if (key === inv.skills.map((skill) => `${skill.name}\n${skill.filePath}`).join("\n")) {
		if (fromRequest) given.forEach((skill, index) => setListed(inv.skills[index]!, !skill.disableModelInvocation));
	} else {
		inv.skills = given.map((skill) => {
			const item: SkillItem = {
				name: sanitize(skill.name),
				description: sanitize(skill.description),
				filePath: skill.filePath,
				tokens: 0,
			};
			if (fromRequest) setListed(item, !skill.disableModelInvocation);
			return item;
		});
		if (inv.skill !== undefined && !inv.skills.some((item) => item.name === inv.skill)) inv.skill = undefined;
		void readBodies(inv, inv.skills);
	}
	inv.env.changed(inv);
}

/** Whether a skill is in the system prompt's list, and what its entry costs there. */
function setListed(item: SkillItem, listed: boolean): void {
	item.listed = listed;
	item.tokens = listed ? textTokens(`${item.name}\n${item.description}\n${item.filePath}`) : 0;
}

async function readBodies(inv: Inventory, items: SkillItem[]): Promise<void> {
	for (const item of items) {
		// A newer set of skills replaced this one.
		if (inv.skills !== items) return;
		try {
			const handle = await open(item.filePath, "r");
			try {
				const buffer = Buffer.alloc(BODY_BYTES + 1);
				const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
				item.bodyCut = bytesRead > BODY_BYTES;
				const text = buffer.subarray(0, Math.min(bytesRead, BODY_BYTES)).toString("utf8");
				item.body = sanitize(text).replace(/\t/g, "    ");
				item.bodyTokens = textTokens(text);
			} finally {
				await handle.close();
			}
		} catch (error) {
			item.bodyError = sanitize(String((error as Error)?.message ?? error));
		}
		inv.env.changed(inv);
	}
}
