/**
 * DATA › EXTENSIONS: the extensions Pi finds, under the package or folder they come
 * from. A disabled one (by a filter in the settings) is dimmed and marked ○.
 */
import { relative } from "node:path";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { type ExtensionItem, extensions, refreshExtensions } from "../features/extensions.ts";
import { framed } from "../screen/frame.ts";
import { Lines } from "../screen/lines.ts";
import { type PanelEnv, registerPanel } from "./registry.ts";

registerPanel("extensions", (env) =>
	framed(
		env.theme,
		() => {
			const { items } = extensions(env.state);
			const enabled = items.filter((item) => item.enabled).length;
			return items.length ? `EXTENSIONS  ${enabled} enabled / ${items.length}` : "EXTENSIONS";
		},
		new Lines(
			(width) => extensionLines(env, width),
			() => [extensions(env.state).version],
		),
		"top",
		() => env.focused("extensions"),
	),
);

/** A group's heading: the package source, or where the files without a package are. */
function heading(item: ExtensionItem): string {
	if (item.source === "auto") return `extension folder${item.scope === "project" ? " (project)" : ""}`;
	if (item.source === "local") return `settings${item.scope === "project" ? " (project)" : ""}`;
	return item.source;
}

/** The entry file, relative to its package or folder when it is inside it. */
function shortPath(item: ExtensionItem): string {
	if (!item.baseDir) return item.path;
	const path = relative(item.baseDir, item.path);
	return path && !path.startsWith("..") ? path.replace(/\\/g, "/") : item.path;
}

function extensionLines(env: PanelEnv, width: number): string[] {
	refreshExtensions(env.state);
	const t = env.theme();
	const data = extensions(env.state);
	if (data.error) return [truncateToWidth(t.fg("error", ` ${data.error}`), width)];
	if (!data.items.length) return [t.fg("dim", data.loading || data.stale ? " -- reading --" : " -- no extensions --")];
	// Groups in the order Pi resolves them; the items keep their order within a group.
	const groups = new Map<string, ExtensionItem[]>();
	for (const item of data.items) {
		const key = `${item.source}\0${item.scope}\0${item.baseDir ?? ""}`;
		const group = groups.get(key);
		if (group) group.push(item);
		else groups.set(key, [item]);
	}
	const lines: string[] = [];
	for (const items of groups.values()) {
		const first = items[0]!;
		if (lines.length) lines.push("");
		lines.push(` ${t.fg("accent", t.bold(heading(first)))}  ${t.fg("dim", first.scope)}`);
		for (const item of items) {
			const mark = item.enabled ? t.fg("success", "●") : t.fg("dim", "○");
			lines.push(`   ${mark} ${t.fg(item.enabled ? "text" : "dim", shortPath(item))}`);
		}
	}
	if (data.loading) lines.push("", t.fg("dim", " -- updating --"));
	return lines.map((line) => truncateToWidth(line, width));
}
