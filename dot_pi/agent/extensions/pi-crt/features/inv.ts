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
import type { ExtensionAPI, ExtensionContext, ToolNamespace } from "@earendil-works/pi-coding-agent";
import { textTokens } from "../state/context.ts";
import { type CrtState, sanitize, type Versioned } from "../state/core.ts";
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
	/**
	 * The heading the tool is listed under: its namespace (such as one MCP server),
	 * shared by the namespace's tools. None when all of them are hidden (see toolGroups).
	 */
	namespace?: ToolGroup;
}

/** A namespace that groups tools (Pi's ToolNamespace). */
export interface ToolGroup {
	name: string;
	/** What the list calls the namespace: its aliases as Pi gives them, or its name (see NamespaceFields). */
	label: string;
	description: string;
	instructions: string;
}

/** A skill; its version changes when its file has been read. */
export interface SkillItem extends Versioned {
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
	toolList: ToolList;
	/** Changes whenever the prompt, the skills or the picked part or skill change. */
	version: number;
	/** Changes whenever a skill file has been read (the skill's own version changes too). */
	bodies: Versioned;
	/** The label of the picked part; none: the whole prompt. */
	part?: string;
	folds: Folds;
	skill?: string;
}

/** The tools and the pick among them, which the tool list and the detail beside it show. */
interface ToolList extends Versioned {
	items: ToolItem[];
	key: string;
	/** The fields read of each tool's namespace when the items were built. */
	namespaces: readonly (NamespaceFields | undefined)[];
	/** The picked tool, one that the tool list shows. */
	tool?: string;
	/** The picked namespace's name; a tool and a namespace are not picked at once. */
	toolGroup?: string;
}

/** Which namespaces list their tools under their heading. Only the tool list reads it. */
export interface Folds extends Versioned {
	/** The names of the namespaces whose tools are listed; none at first. */
	expanded: ReadonlySet<string>;
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
 * The tools, rebuilt when the set of tools, of active tools, the exposures or the
 * namespaces change. Panels call this while drawing; reading the two lists is cheap
 * next to drawing.
 *
 * Pi's MCP extension registers the tools of a disabled server again as hidden, and
 * the tools of a reconnected server again with a new namespace (whose instructions
 * may differ), so the exposures and the namespaces' fields are compared. The fields
 * are compared, not the objects: Pi does not say whether a namespace object is ever
 * changed or replaced by an equal one. Comparing a string with itself takes no
 * time whatever its length, so long instructions cost nothing while Pi hands the
 * same ones.
 */
export function tools(state: CrtState): readonly ToolItem[] {
	const inv = inventories.get(state);
	if (!inv) return NO_TOOLS;
	const list = inv.toolList;
	const active = inv.pi.getActiveTools();
	const all = inv.pi.getAllTools();
	const key = `${all.map((tool) => `${tool.name}\t${tool.exposure}`).join("\n")}\n\n${active.join("\n")}`;
	const namespaces = all.map((tool) => namespaceFields(tool.namespace));
	if (key === list.key && namespaces.every((fields, index) => sameFields(fields, list.namespaces[index]))) return list.items;
	const activeSet = new Set(active);
	const groups = toolGroups(all, namespaces);
	list.key = key;
	list.namespaces = namespaces;
	list.items = all.map((tool) => ({
		name: sanitize(tool.name),
		description: sanitize(tool.description ?? ""),
		active: activeSet.has(tool.name),
		exposure: tool.exposure,
		tokens: textTokens(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })),
		parameters: tool.parameters,
		guidelines: (tool.promptGuidelines ?? []).map(sanitize),
		source: sanitize(tool.sourceInfo?.path ?? ""),
		namespace: tool.namespace && groups.get(tool.namespace.name),
	}));
	// A pick whose row the tool list no longer shows goes: the tool went, or moved under
	// a folded heading; the heading went.
	const listed = (tool: ToolItem) => toolListed(inv.folds, tool);
	if (list.tool !== undefined && !list.items.some((tool) => tool.name === list.tool && listed(tool))) list.tool = undefined;
	if (list.toolGroup !== undefined && !groups.has(list.toolGroup)) list.toolGroup = undefined;
	list.version++;
	return list.items;
}

/** What a ToolGroup is built from: the fields read of a namespace. */
interface NamespaceFields {
	name: string;
	/**
	 * The namespace's aliases as Pi gives them, joined; its name when it has none. An
	 * alias is another name scripts may look the namespace up by; Pi's MCP extension
	 * gives the server's name as one (`knowledge-finder` for `mcp__knowledge_finder`).
	 * No API hands extensions the names of the configured MCP servers.
	 */
	label: string;
	description?: string;
	instructions?: string;
}

function namespaceFields(namespace: ToolNamespace | undefined): NamespaceFields | undefined {
	if (!namespace) return undefined;
	const { name, aliases, description, instructions } = namespace;
	return { name, label: aliases?.length ? aliases.join(", ") : name, description, instructions };
}

function sameFields(a: NamespaceFields | undefined, b: NamespaceFields | undefined): boolean {
	if (!a || !b) return a === b;
	return (Object.keys(a) as (keyof NamespaceFields)[]).every((field) => a[field] === b[field]);
}

/**
 * One ToolGroup per namespace name, shared by its tools, for the namespaces with a
 * tool that is not hidden.
 *
 * A namespace whose tools are all hidden gets no group, since the agent cannot reach
 * any of them: Pi's MCP extension registers the tools of a server disabled in /mcp
 * again as hidden, and the tools do not tell that server from a connected one whose
 * tools are all configured hidden. Tools a server stopped offering stay registered
 * as hidden with the namespace of the connection that offered them, so a name can
 * come with several namespace objects; the group is built from one that a tool which
 * is not hidden carries. `fields` are the namespaces' fields, by tool.
 */
function toolGroups(all: readonly { exposure: string }[], fields: readonly (NamespaceFields | undefined)[]): Map<string, ToolGroup> {
	const chosen = new Map<string, NamespaceFields>();
	all.forEach((tool, index) => {
		const namespace = fields[index];
		if (namespace && tool.exposure !== "hidden") chosen.set(namespace.name, namespace);
	});
	const groups = new Map<string, ToolGroup>();
	for (const [name, namespace] of chosen) {
		groups.set(name, {
			name: sanitize(name),
			label: sanitize(namespace.label),
			description: sanitize(namespace.description ?? ""),
			instructions: sanitize(namespace.instructions ?? ""),
		});
	}
	return groups;
}

/** Changes whenever the prompt, the skills or the picked part or skill change. */
export function version(state: CrtState): number {
	return inventories.get(state)?.version ?? 0;
}

/** Changes whenever a skill file has been read. */
export function bodiesVersion(state: CrtState): number {
	return inventories.get(state)?.bodies.version ?? 0;
}

/** Changes whenever the tools or the picked tool or namespace change; read it after tools(). */
export function toolsVersion(state: CrtState): number {
	return inventories.get(state)?.toolList.version ?? 0;
}

export function picks(state: CrtState): { part?: string; tool?: string; toolGroup?: string; skill?: string } {
	const inv = inventories.get(state);
	return inv ? { part: inv.part, tool: inv.toolList.tool, toolGroup: inv.toolList.toolGroup, skill: inv.skill } : {};
}

/** No namespace expanded, before setupInventory. Never changed. */
const NO_FOLDS: Readonly<Folds> = Object.freeze({ expanded: new Set<string>(), version: 0 });

export function folds(state: CrtState): Readonly<Folds> {
	return inventories.get(state)?.folds ?? NO_FOLDS;
}

/** Whether the tool list has a row for the tool: it is outside namespaces, or its namespace is expanded. */
export function toolListed(folds: Readonly<Folds>, tool: ToolItem): boolean {
	return !tool.namespace || folds.expanded.has(tool.namespace.name);
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
	if (!inv || (inv.toolList.tool === name && inv.toolList.toolGroup === undefined)) return;
	inv.toolList.tool = name;
	inv.toolList.toolGroup = undefined;
	inv.env.changed(inv.toolList);
}

/** Pick a namespace of tools by its name. */
export function pickToolGroup(state: CrtState, name: string | undefined): void {
	const inv = inventories.get(state);
	if (!inv || (inv.toolList.toolGroup === name && inv.toolList.tool === undefined)) return;
	inv.toolList.toolGroup = name;
	inv.toolList.tool = undefined;
	inv.env.changed(inv.toolList);
}

/** List a namespace's tools under its heading, or stop listing them. */
export function toggleToolGroup(state: CrtState, name: string): void {
	const inv = inventories.get(state);
	if (!inv) return;
	const expanded = new Set(inv.folds.expanded);
	if (!expanded.delete(name)) expanded.add(name);
	inv.folds.expanded = expanded;
	inv.env.changed(inv.folds);
}

export function pickSkill(state: CrtState, name: string | undefined): void {
	const inv = inventories.get(state);
	if (!inv || inv.skill === name) return;
	inv.skill = name;
	inv.env.changed(inv);
}

export function setupInventory(pi: ExtensionAPI, env: FeatureEnv): void {
	const inv: Inventory = {
		pi,
		env,
		skills: [],
		skillsKnown: false,
		toolList: { items: [], key: "", namespaces: [], version: 0 },
		version: 0,
		bodies: { version: 0 },
		folds: { expanded: new Set(), version: 0 },
	};
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
				version: 0,
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
		item.version++;
		inv.env.changed(inv.bodies);
	}
}
