/**
 * INV reads the shared current-context projection (features/context.ts) for prompt
 * and declarations. It owns only inventory presentation: picks, namespace folds,
 * loaded skill metadata and bounded background reads of skill bodies.
 */
import { open } from "node:fs/promises";
import type { ExtensionAPI, ToolNamespace } from "@earendil-works/pi-coding-agent";
import { textTokens, toolTokens } from "../state/context.ts";
import { type CrtState, sanitize, type Versioned } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";
import { countText, counted, type TokenCounts, type TextCounter } from "../state/tokenizers.ts";
import { contextData, type ContextData } from "./context.ts";
import type { ContextOrigin } from "../state/request-context.ts";

/** A part of the system prompt: its instruction text, or one of its named sections. */
export interface PromptPart {
	label: string;
	text: string;
	tokens: number;
}

export interface PromptInventory {
	counterId: TextCounter["id"];
	/** The text the request carries, or the one Pi would build now. */
	text: string;
	tokens: number;
	/** Empty until a run has rendered the prompt. */
	parts: PromptPart[];
	/** Tokens in no part: the separators and any text outside the sections, which an extension may have written. */
	rest: number;
	origin: Origin;
}

export interface ToolItem {
	name: string;
	description: string;
	/** Declared by the last request (a loadout may hide a registered tool from the declarations). */
	active: boolean;
	exposure: string;
	/** Tokens of the definition the model gets (name, description, parameters). */
	tokens: number;
	/** Where the description and the tokens came from. */
	origin: Origin;
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
	 * In the skill list of the prompt the run sent (Pi writes one block per skill that the
	 * model may load, and another extension may remove that section). Undefined while no
	 * prompt of a run is known.
	 */
	listed?: boolean;
	/** Whether the model may load the skill; undefined until a request's options say it. */
	invocable?: boolean;
	/** Tokens of the skill's block in that list; 0 when the prompt lists no such block. */
	tokens: number;
	/** The skill file, read in the background; at most BODY_BYTES of it. */
	body?: string;
	bodyCut?: boolean;
	bodyTokens?: number;
	bodyError?: string;
}

type LoadedSkill = Omit<SkillItem, "listed" | "tokens" | "bodyTokens"> & { bodyCounts?: TokenCounts };

/** Bytes read of each skill file. */
const BODY_BYTES = 256 * 1024;

/**
 * Evidence for the shared estimate: request edits still applicable to this branch
 * (`observed`), session system replay (`recorded`), or live Pi fallback (`built`).
 * An observed estimate includes current messages, not a frozen prior request.
 */
export type Origin = ContextOrigin;

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
	/** Derived prompt and skill views, not additional sources of context state. */
	prompt?: PromptInventory;
	skillView?: { prompt: PromptInventory; loaded: LoadedSkill[]; version: number; bodiesVersion: number; items: SkillItem[] };
	skills: LoadedSkill[];
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
	/** The fields read of each tool when the items were built. */
	fields: readonly ToolFields[];
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

/** Derive the prompt only when its text or provenance changes. */
function promptView(inv: Inventory, current: Readonly<ContextData>): PromptInventory {
	if (!inv.prompt || inv.prompt.text !== current.prompt || inv.prompt.origin !== current.origin || inv.prompt.counterId !== current.counter.id) {
		inv.prompt = measurePrompt(current.prompt, current.origin, current.counter);
	}
	// Validate before a panel compares its version key, so a removed part cannot reappear selected.
	if (inv.part !== undefined && !inv.prompt.parts.some((part) => part.label === inv.part)) {
		inv.part = undefined;
		inv.version++;
	}
	return inv.prompt;
}

export function prompt(state: CrtState): PromptInventory | undefined {
	const inv = inventories.get(state);
	return inv ? promptView(inv, contextData(state)) : undefined;
}

export function skills(state: CrtState): { known: boolean; items: readonly SkillItem[] } {
	const inv = inventories.get(state);
	if (!inv) return { known: false, items: [] };
	const current = contextData(state);
	const view = promptView(inv, current);
	const cached = inv.skillView;
	if (!cached || cached.prompt !== view || cached.loaded !== inv.skills ||
		cached.version !== inv.version || cached.bodiesVersion !== inv.bodies.version) {
		inv.skillView = {
			prompt: view, loaded: inv.skills, version: inv.version, bodiesVersion: inv.bodies.version,
			items: listedSkills(view, inv.skills, current.counter),
		};
	}
	return { known: inv.skillsKnown, items: inv.skillView!.items };
}

/**
 * The tools, rebuilt when the set of tools, of active tools, the exposures, the
 * namespaces or a tool's definition change. Panels call this while drawing; reading
 * the two lists is cheap next to drawing.
 *
 * Pi's MCP extension registers the tools of a disabled server again as hidden, and
 * the tools of a reconnected server again with a new namespace (whose instructions
 * may differ), so the exposures and the namespaces' fields are compared. The fields
 * are compared, not the objects: Pi does not say whether a namespace object is ever
 * changed or replaced by an equal one. Comparing a string with itself takes no
 * time whatever its length, so long instructions cost nothing while Pi hands the
 * same ones. A tool registered again under its name replaces its definition, so the
 * parts of the definition the items show are compared the same way.
 *
 * A tool's description and parameters are the ones the last request declared, which a
 * loadout can change (Pi appends its own note to codemode's tools, for example), and
 * only those the request declared are active: a loadout may hide declarations that
 * stay registered. Before a run has declared any, the registered definitions stand in.
 */
export function tools(state: CrtState): readonly ToolItem[] {
	const inv = inventories.get(state);
	if (!inv) return NO_TOOLS;
	const current = contextData(state);
	const list = inv.toolList;
	/** What the last request declared of each tool, less the declarations its loadout hid. */
	const declarations = new Map(current.tools.map((tool) => [tool.name, tool]));
	/** The names in the shared declaration set (the registered loadout for a built prompt). */
	const declaredNames = new Set(declarations.keys());
	/** Where the declarations and their tokens come from. */
	const origin = current.origin;
	const registered = inv.pi.getAllTools();
	const registeredNames = new Set(registered.map((tool) => tool.name));
	// Declaration membership is authoritative; the registry only supplies runtime metadata.
	const all = [...registered, ...[...declarations.values()].filter((tool) => !registeredNames.has(tool.name)).map((tool) => ({
		...tool, exposure: "declared", namespace: undefined, promptGuidelines: undefined,
		sourceInfo: { path: "session/request (not registered)" },
	}))];
	const key = `${current.version}\n${origin}\n${all.map((tool) => `${tool.name}\t${tool.exposure}`).join("\n")}\n\n${[...declaredNames].join("\n")}`;
	/** What the request said of a tool, or the registered definition while it said nothing. */
	const said = (tool: (typeof all)[number]) => declarations.get(tool.name) ?? tool;
	const fields = all.map((tool): ToolFields => ({
		description: said(tool).description,
		parameters: said(tool).parameters,
		guidelines: tool.promptGuidelines,
		source: tool.sourceInfo?.path,
		namespace: namespaceFields(tool.namespace),
	}));
	if (key === list.key && fields.every((tool, index) => sameTool(tool, list.fields[index]))) return list.items;
	const groups = toolGroups(all, fields.map((tool) => tool.namespace));
	list.key = key;
	list.fields = fields;
	list.items = all.map((tool) => ({
		name: sanitize(tool.name),
		description: sanitize(said(tool).description ?? ""),
		active: declaredNames.has(tool.name),
		exposure: tool.exposure,
		tokens: toolTokens({ name: tool.name, description: said(tool).description, parameters: said(tool).parameters }, current.counter),
		origin,
		parameters: said(tool).parameters,
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

/** What a ToolItem is built from beside the name and the exposure: the values read of a tool. */
interface ToolFields {
	description?: string;
	parameters: unknown;
	guidelines?: readonly string[];
	source?: string;
	namespace?: NamespaceFields;
}

function sameTool(a: ToolFields, b: ToolFields | undefined): boolean {
	return (
		b !== undefined &&
		a.description === b.description &&
		a.parameters === b.parameters &&
		a.guidelines === b.guidelines &&
		a.source === b.source &&
		sameFields(a.namespace, b.namespace)
	);
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
	const inv = inventories.get(state);
	if (!inv) return 0;
	const current = contextData(state);
	promptView(inv, current);
	return inv.version + current.version;
}

/** Changes whenever a skill file has been read. */
export function bodiesVersion(state: CrtState): number {
	return inventories.get(state)?.bodies.version ?? 0;
}

/** Changes whenever the tools or the picked tool or namespace change; read it after tools(). */
export function toolsVersion(state: CrtState): number {
	tools(state);
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
		pi, env, skills: [], skillsKnown: false,
		toolList: { items: [], key: "", fields: [], version: 0 },
		version: 0, bodies: { version: 0 }, folds: { expanded: new Set(), version: 0 },
	};
	inventories.set(env.state, inv);
	let pending: PromptOptions | undefined;
	pi.on("session_start", () => {
		setSkills(inv, loadedSkills(pi), false);
	});
	pi.on("before_agent_start", (event) => { pending = event.systemPromptOptions as PromptOptions; });
	pi.on("agent_start", () => {
		if (pending) setSkills(inv, pending.skills ?? [], true);
		pending = undefined;
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
	tools: "TOOL LIST",
	rules: "RULES",
	docs: "PI DOCS",
	addendum: "ADDENDUM",
	project_context: "PROJECT CONTEXT",
	skills: "SKILL LIST",
	cwd: "CWD",
};

/** A section of a rendered prompt: the line `<name>` to the line `</name>`, both included. */
interface RenderedSection {
	name: string;
	/** The first character of the line `<name>`. */
	start: number;
	/** Just past the line `</name>`. */
	end: number;
}

/**
 * The prompt's sections in text order. Pi frames each one as `<name>` and `</name>`
 * lines around its body (core/system-prompt.js). The fences of the text before the first
 * section are followed, since a prompt file may show a frame as a fenced example. Inside
 * and between sections they are not: a section ends at its first `</name>` line even when
 * a fence quotes that line, because reading fences there lets one unbalanced fence hide
 * every section after it, while a misjudged end only leaves text outside the parts, where
 * the panel still counts it.
 */
function renderedSections(text: string): RenderedSection[] {
	const sections: RenderedSection[] = [];
	/** The fence of the text before the first section. Never set once a section is found. */
	let fence: string | undefined;
	const pattern = /^<([a-z][a-z0-9_-]*)>$|^ {0,3}(`{3,}|~{3,})([^\n]*)$/gm;
	for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
		const name = match[1];
		if (name === undefined) {
			// A fence line: it opens a block or closes the open one.
			if (sections.length === 0) fence = fenceAfter(fence, match[0]);
			continue;
		}
		if (fence !== undefined) continue;
		const closing = `\n</${name}>`;
		const close = text.indexOf(closing, pattern.lastIndex);
		if (close === -1) continue;
		const end = close + closing.length;
		// The closing line ends its section unless something follows it on the same line.
		if (end < text.length && text[end] !== "\n") continue;
		sections.push({ name, start: match.index, end });
		pattern.lastIndex = end;
	}
	return sections;
}

/** The fence after `line`: a fence line opens one, and a line of the same character and at least its length closes it. */
function fenceAfter(fence: string | undefined, line: string): string | undefined {
	const fenced = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
	if (!fenced) return fence;
	const marker = fenced[1]!;
	if (fence === undefined) return marker;
	return marker[0] === fence[0] && marker.length >= fence.length && fenced[2]!.trim() === "" ? undefined : fence;
}

/** The prompt a request carries, by the sections rendered into it. */
function measurePrompt(text: string, origin: Origin, counter: TextCounter): PromptInventory {
	const tokens = textTokens(text, counter);
	const sections = renderedSections(text);
	/** Tokens up to `end`: a part costs the difference of two prefixes, so the parts and the rest add up to the whole. */
	const prefix = (end: number) => textTokens(text.slice(0, end), counter);
	const parts: PromptPart[] = [];
	const add = (label: string, start: number, end: number) => {
		const part = text.slice(start, end).trimEnd();
		if (!part) return;
		parts.push({ label, text: part, tokens: prefix(end) - prefix(start) });
	};
	// Pi writes the preamble, its own or an extension's, before the first section and without a tag.
	add("PREAMBLE", 0, sections[0]?.start ?? text.length);
	for (const section of sections) add(SECTION_LABELS[section.name] ?? `<${section.name}>`, section.start, section.end);
	const counted = parts.reduce((sum, part) => sum + part.tokens, 0);
	return { counterId: counter.id, text, tokens, parts, rest: Math.max(0, tokens - counted), origin };
}

/**
 * Take a set of skills; read the files of a new set in the background. A request's
 * set also says which skills the model may load and gives their descriptions; the
 * loaded set leaves an unchanged list as it is, since a request may have said it
 * already.
 */
function setSkills(inv: Inventory, given: readonly GivenSkill[], fromRequest: boolean): void {
	const key = given.map((skill) => `${skill.name}\n${skill.filePath}`).join("\n");
	inv.skillsKnown = true;
	if (key === inv.skills.map((skill) => `${skill.name}\n${skill.filePath}`).join("\n")) {
		if (fromRequest) {
			given.forEach((skill, index) => {
				const item = inv.skills[index]!;
				item.description = sanitize(skill.description);
				item.invocable = !skill.disableModelInvocation;
			});
		}
	} else {
		inv.skills = given.map((skill) => {
			const item: LoadedSkill = {
				name: sanitize(skill.name),
				description: sanitize(skill.description),
				filePath: skill.filePath,
				version: 0,
			};
			if (fromRequest) item.invocable = !skill.disableModelInvocation;
			return item;
		});
		if (inv.skill !== undefined && !inv.skills.some((item) => item.name === inv.skill)) inv.skill = undefined;
		void readBodies(inv, inv.skills);
	}
	inv.env.changed(inv);
}

/** One block of Pi's skill list: a `<skill>` element holding the skill's name, description and file. */
const SKILL_BLOCK = / {2}<skill>\n[\s\S]*?\n {2}<\/skill>/g;
const SKILL_BLOCK_NAME = /<name>([^<]*)<\/name>/;

/**
 * Derive listed status and block tokens from the sent prompt. Pi escapes the
 * names in its skill list; loaded metadata and body state remain independent.
 */
function listedSkills(prompt: PromptInventory, skills: readonly LoadedSkill[], counter: TextCounter): SkillItem[] {
	// A prompt no request carried cannot say what the list holds: a handler may keep it or remove it.
	const list = prompt.origin !== "built" ? (prompt.parts.find((part) => part.label === SECTION_LABELS.skills)?.text ?? "") : undefined;
	const blocks = new Map<string, number>();
	for (const [block] of list?.matchAll(SKILL_BLOCK) ?? []) {
		const name = SKILL_BLOCK_NAME.exec(block)?.[1];
		if (name !== undefined) blocks.set(unescapeXml(name), textTokens(block, counter));
	}
	return skills.map((item) => {
		const tokens = list === undefined ? undefined : (blocks.get(item.name) ?? 0);
		const { bodyCounts, ...metadata } = item;
		return { ...metadata, bodyTokens: bodyCounts && counted(bodyCounts, counter), listed: tokens === undefined ? undefined : tokens > 0, tokens: tokens ?? 0 };
	});
}

/** The five characters Pi writes as entities into its skill list (core/skills.js). */
const XML_ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(text: string): string {
	return text.replace(/&(amp|lt|gt|quot|apos);/g, (_match, name: string) => XML_ENTITIES[name]!);
}

async function readBodies(inv: Inventory, items: LoadedSkill[]): Promise<void> {
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
				item.bodyCounts = countText(text);
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
