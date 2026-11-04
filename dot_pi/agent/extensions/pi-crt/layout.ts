/**
 * Tabs, inner tabs and panel placement.
 *
 * A tab has either one layout (`layout`) or inner tabs (`pages`), each with a
 * `label` and a `layout`. A tab with one layout shows its label as its only
 * inner tab, so every tab has the same two tab bars.
 *
 * A layout is a layout node, or two of them chosen by the terminal width:
 *   { minWidth: 160, wide: node, narrow: node }
 * uses `wide` when the terminal is at least `minWidth` columns wide.
 *
 * A layout node is one of:
 *   "panel-id"                    a panel
 *   { panel: "panel-id", size? }  a panel with a size
 *   { row: [nodes], size? }       side by side, divided by a rule
 *   { column: [nodes], size? }    stacked top to bottom
 *
 * `size` is a share of the terminal's width for a node in a row, or of its
 * height for a node in a column, such as "30%". In each row and column exactly
 * one node has no `size`; it takes the rest. A sized node shrinks when the
 * screen is too small for it. `size` is the starting share: moving a boundary
 * with the mouse (a row's rule, or in a column the title of the part below it)
 * changes the share until pi-crt is loaded again.
 * Each panel can appear at most once per layout node tree (`wide` and `narrow`
 * may both use it).
 *
 * `primary` names the panel that Pi's viewport keys (PageUp / PageDown and the rest)
 * scroll while you type (in panel mode they scroll the selected panel); with a list,
 * the first one present in the current layout is used.
 * It defaults to the transcript, then to the first panel that scrolls, then to
 * the first panel. Panel mode on a page starts on the panel last selected there
 * while that panel is still on screen, else on the first panel that lists things
 * (the arrow keys move in it), else on `primary`.
 *
 * Panels: transcript, thinking, tools, toollog, vitals, context, usage, history, git,
 * gitfiles, gitdiff, gitlog, promptparts, prompttext, toollist, tooldetail,
 * skilllist, skilltext, modellist, modeldetail, extensions, tree, location, sessions,
 * stations, radiosearch, radiooutput, nowplaying, nosignal
 *
 * Tabs that show "transcript" at the current width blink when the agent finishes
 * while none of them is shown. When the transcript is narrower than the
 * terminal, Pi does not draw an image whose top row has scrolled out of view,
 * and Mermaid diagrams wider than the transcript fall back to source code.
 */
import type { TabDef } from "./screen/layout.ts";

const tabs: TabDef[] = [
	{
		label: "TERM",
		pages: [
			{
				label: "CHAT",
				layout: {
					minWidth: 160,
					wide: {
						row: [
							{ column: [{ panel: "thinking", size: "20%" }, "transcript"] },
							{ panel: "toollog", size: "43%" },
						],
					},
					narrow: {
						column: [{ row: ["thinking", { panel: "tools", size: "34%" }], size: "20%" }, "transcript"],
					},
				},
			},
			{ label: "LOG", layout: "toollog" },
		],
	},
	{
		label: "STAT",
		pages: [
			{ label: "STATUS", layout: "vitals" },
			{
				label: "DETAIL",
				layout: {
					minWidth: 120,
					wide: { column: [{ row: ["context", { panel: "usage", size: "45%" }], size: "45%" }, "history"] },
					narrow: { column: [{ panel: "context", size: "35%" }, { panel: "usage", size: "20%" }, "history"] },
				},
			},
		],
	},
	{
		label: "INV",
		pages: [
			{
				label: "PROMPT",
				layout: {
					minWidth: 120,
					wide: { row: [{ panel: "promptparts", size: "31%" }, "prompttext"] },
					narrow: { column: [{ panel: "promptparts", size: "25%" }, "prompttext"] },
				},
				primary: "prompttext",
			},
			{
				label: "TOOLS",
				layout: {
					minWidth: 120,
					wide: { row: [{ panel: "toollist", size: "31%" }, "tooldetail"] },
					narrow: { column: [{ panel: "toollist", size: "25%" }, "tooldetail"] },
				},
				primary: "tooldetail",
			},
			{
				label: "SKILLS",
				layout: {
					minWidth: 120,
					wide: { row: [{ panel: "skilllist", size: "31%" }, "skilltext"] },
					narrow: { column: [{ panel: "skilllist", size: "25%" }, "skilltext"] },
				},
				primary: "skilltext",
			},
		],
	},
	{
		label: "DATA",
		pages: [
			{
				label: "GIT",
				layout: {
					minWidth: 120,
					wide: { row: [{ column: ["gitfiles", { panel: "gitlog", size: "30%" }], size: "31%" }, "gitdiff"] },
					narrow: { column: ["git", { panel: "gitlog", size: "20%" }] },
				},
				primary: ["gitdiff", "git"],
			},
			{
				label: "MODELS",
				layout: {
					minWidth: 120,
					wide: { row: [{ panel: "modellist", size: "40%" }, "modeldetail"] },
					narrow: { column: [{ panel: "modellist", size: "50%" }, "modeldetail"] },
				},
				primary: "modellist",
			},
			{ label: "EXTENSIONS", layout: "extensions" },
		],
	},
	{
		label: "MAP",
		pages: [
			{
				label: "TREE",
				layout: {
					minWidth: 120,
					wide: { row: ["tree", { panel: "location", size: "36%" }] },
					narrow: { column: ["tree", { panel: "location", size: "40%" }] },
				},
				primary: "tree",
			},
			{ label: "SESSIONS", layout: "sessions" },
		],
	},
	{
		label: "RADIO",
		pages: [
			{
				label: "STATIONS",
				layout: {
					minWidth: 100,
					wide: { row: [{ panel: "stations", size: "32%" }, "nowplaying"] },
					narrow: { column: [{ panel: "stations", size: "40%" }, "nowplaying"] },
				},
				primary: "stations",
			},
			{
				label: "SEARCH",
				layout: {
					minWidth: 100,
					wide: { row: [{ panel: "radiosearch", size: "32%" }, "nowplaying"] },
					narrow: { column: [{ panel: "radiosearch", size: "50%" }, "nowplaying"] },
				},
				primary: "radiosearch",
			},
			{
				label: "OUTPUT",
				layout: {
					minWidth: 100,
					wide: { row: [{ panel: "radiooutput", size: "32%" }, "nowplaying"] },
					narrow: { column: [{ panel: "radiooutput", size: "40%" }, "nowplaying"] },
				},
				primary: "radiooutput",
			},
		],
	},
];

export default tabs;
