/**
 * Page layouts: the types layout.ts is written in, and the builder that turns a
 * layout into rows and columns whose boundaries the mouse can move.
 */
import {
	type Component,
	HStack,
	type StackEntry,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	VStack,
} from "@earendil-works/pi-tui";
import { Lines, type ThemeRef } from "./lines.ts";

/** A share of the terminal's width (for a node in a row) or height (in a column), such as "30%". */
export type Share = `${number}%`;

/** Layout description. A string is a panel id. */
export type LayoutNode =
	| string
	| { panel: string; size?: Share }
	| { row: LayoutNode[]; size?: Share }
	| { column: LayoutNode[]; size?: Share };

/** The terminal's size in cells. */
export interface TerminalSize {
	width: number;
	height: number;
}

/** A layout, or two layouts chosen by the terminal width. */
export type Arrangement = LayoutNode | { minWidth: number; wide: LayoutNode; narrow: LayoutNode };

export interface PageDef {
	label: string;
	layout: Arrangement;
	/**
	 * Panel that Pi's viewport keys (PageUp / PageDown and the rest) scroll while the
	 * editor has the keys (in panel mode they scroll the selected panel). With a list,
	 * the first one in the current layout is used. Defaults to the transcript, then to
	 * the first panel that scrolls, then to the first panel.
	 */
	primary?: string | string[];
}

/** A tab shows one layout, or inner tabs (`pages`) that each show one. */
export type TabDef = { label: string } & ({ layout: Arrangement; primary?: string | string[] } | { pages: PageDef[] });

/** Vertical rule between the columns of a row. Taller than any screen; the layout clips it. */
class Divider implements Component {
	constructor(
		private readonly theme: ThemeRef,
		private readonly onMouse: (event: TuiMouseEvent) => TuiMouseEventResult | undefined,
	) {}
	render(): string[] {
		return new Array<string>(400).fill(this.theme().fg("borderMuted", "│"));
	}
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		return this.onMouse(event);
	}
	invalidate(): void {}
}

/** Smallest size a drag gives a part, and that the part taking the rest keeps. */
const MIN_PART = 3;

/**
 * Where a moved boundary would go: a vertical line (`row`) at column `x` from row
 * `y`, or a horizontal line (`column`) at row `y` from column `x`, `length` cells
 * long. Terminal cells, zero-based.
 */
export interface Guide {
	axis: "row" | "column";
	x: number;
	y: number;
	length: number;
}

/** What the layout needs from the screen it is shown on. */
export interface ScreenHost {
	size(): TerminalSize;
	/** Show where a dragged boundary would go, or hide it (undefined). */
	preview(guide: Guide | undefined): void;
}

/**
 * A panel's title rule. In a column, the title of every part but the first is
 * the boundary above it, and dragging it moves that boundary.
 */
export class TitleLine extends Lines {
	/** The boundaries this title is the handle of, one per layout tree it is in. */
	private readonly handles: Array<{ split: Split; onMouse: (event: TuiMouseEvent) => TuiMouseEventResult | undefined }> = [];
	private dragging?: (event: TuiMouseEvent) => TuiMouseEventResult | undefined;

	addHandle(split: Split, boundary: number): void {
		this.handles.push({ split, onMouse: split.dividerMouse(boundary) });
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "press" && event.button === "left") {
			// A panel can sit in several layout trees (a page's wide and narrow layouts);
			// the one on screen is the one Pi laid out last.
			const shown = this.handles.reduce<(typeof this.handles)[number] | undefined>(
				(best, handle) => (!best || handle.split.laidOutAt > best.split.laidOutAt ? handle : best),
				undefined,
			);
			this.dragging = shown?.onMouse;
		}
		const result = this.dragging?.(event);
		if (event.type === "release") this.dragging = undefined;
		return result;
	}
}

/** The title rules at the top edge of a component: of a panel, of each part of a row, of a column's first part. */
const topTitles = new WeakMap<Component, TitleLine[]>();

/** Record `title` as the title rule at the top edge of `component` (a framed panel). */
export function setTopTitle(component: Component, title: TitleLine): void {
	topTitles.set(component, [title]);
}

/**
 * The sizes of the parts of one row or column. Every part but one has a share
 * of the terminal's width (row) or height (column); the remaining part takes
 * the rest. Pi's stacks hand spare space to several growing entries unevenly,
 * earlier entries first (pi-tui 1.4.0 components/stack.js `distribute`,
 * earendil-works/pi#10138), so only one entry grows and the others get a fixed
 * basis that follows their share whenever Pi lays the stack out.
 */
class Split {
	private readonly shares: Array<number | undefined>;
	/** When Pi last laid this stack out (performance.now()); the stack on screen has the latest. */
	laidOutAt = 0;

	constructor(
		private readonly axis: "row" | "column",
		shares: ReadonlyArray<number | undefined>,
		private readonly host: ScreenHost,
	) {
		this.shares = [...shares];
	}

	/** Cells of a part that has a share. */
	size(part: number): number {
		return Math.max(1, Math.round((this.shares[part] ?? 0) * this.dimension()));
	}

	/**
	 * Make the basis of each sized part's entry read its size. `entries` are the
	 * stack's entries: the parts in order, with a divider between two parts of a row.
	 * A getter, because Pi reads the basis on every layout and the terminal may
	 * have been resized since the last one.
	 */
	follow(entries: ReadonlyArray<{ basis?: number | "auto" }>): void {
		this.shares.forEach((share, part) => {
			if (share === undefined) return;
			const entry = entries[this.axis === "row" ? part * 2 : part];
			if (!entry) return;
			const read = () => {
				this.laidOutAt = performance.now();
				return this.size(part);
			};
			Object.defineProperty(entry, "basis", { get: read, enumerable: true, configurable: true });
		});
	}

	/**
	 * Mouse handling of the boundary after part `boundary` (a row's divider, or the
	 * title of a column's next part). Dragging shows where the boundary would go and
	 * leaves the layout alone; the release moves it. Changing a part's width makes Pi
	 * wrap the transcript's messages again, which takes time in proportion to the
	 * conversation, so the panels are laid out again once, not on every step.
	 */
	dividerMouse(boundary: number): (event: TuiMouseEvent) => TuiMouseEventResult | undefined {
		let drag: { part: number; sign: 1 | -1; from: number; start: number; size: number; guide: Guide } | undefined;
		return (event) => {
			const at = this.axis === "row" ? event.screenX : event.screenY;
			if (event.type === "press" && event.button === "left") {
				const part = this.shares.indexOf(undefined) > boundary ? boundary : boundary + 1;
				const start = this.size(part);
				const guide: Guide =
					this.axis === "row"
						? { axis: "row", x: event.screenX, y: event.screenY - event.y, length: event.height }
						: { axis: "column", x: event.screenX - event.x, y: event.screenY, length: event.width };
				drag = { part, sign: part === boundary ? 1 : -1, from: at, start, size: start, guide };
				this.host.preview(guide);
				return { capture: true };
			}
			if (!drag) return undefined;
			if (event.type === "drag") {
				// The part that takes the rest keeps MIN_PART cells besides the other parts and a row's rules.
				const others = this.shares.reduce<number>((sum, share, index) => (share === undefined || index === drag!.part ? sum : sum + this.size(index)), 0);
				const largest = this.dimension() - others - (this.axis === "row" ? this.shares.length - 1 : 0) - MIN_PART;
				if (largest >= MIN_PART) {
					drag.size = Math.max(MIN_PART, Math.min(largest, drag.start + drag.sign * (at - drag.from)));
					const moved = drag.sign * (drag.size - drag.start);
					const { guide } = drag;
					this.host.preview(this.axis === "row" ? { ...guide, x: guide.x + moved } : { ...guide, y: guide.y + moved });
				}
				return { handled: true };
			}
			if (event.type === "release") {
				const dimension = this.dimension();
				if (drag.size !== drag.start && dimension > 0) this.shares[drag.part] = drag.size / dimension;
				drag = undefined;
				this.host.preview(undefined);
				return { handled: true, render: true };
			}
			return undefined;
		};
	}

	private dimension(): number {
		const terminal = this.host.size();
		return this.axis === "row" ? terminal.width : terminal.height;
	}
}

/** A row whose sized parts follow a Split. */
class SplitRow extends HStack {
	constructor(children: StackEntry[], split: Split) {
		super(children);
		split.follow(this.entries);
		topTitles.set(
			this,
			children.flatMap((child) => (child.component instanceof Divider ? [] : (topTitles.get(child.component) ?? []))),
		);
	}
}

/** A column whose sized parts follow a Split; the title of each part but the first moves the boundary above it. */
class SplitColumn extends VStack {
	constructor(children: StackEntry[], split: Split) {
		super(children);
		split.follow(this.entries);
		topTitles.set(this, topTitles.get(children[0]!.component) ?? []);
		children.forEach((child, index) => {
			if (index > 0) for (const title of topTitles.get(child.component) ?? []) title.addHandle(split, index - 1);
		});
	}
}

/** The share a `size` asks for, as a fraction; undefined without `size`. */
function shareOf(node: LayoutNode): number | undefined {
	if (typeof node === "string" || node.size === undefined) return undefined;
	const match = /^(\d+(?:\.\d+)?)%$/.exec(node.size);
	const percent = match ? Number(match[1]) : Number.NaN;
	if (!(percent > 0 && percent < 100)) throw new Error(`size "${node.size}" is not a share between 0% and 100%`);
	return percent / 100;
}

/**
 * Build the component tree for one layout and list its panels in order.
 * `resolve` returns the component of a panel id. Throws when the layout names a
 * panel twice or names an unknown one, because one component can only be laid
 * out once per frame, and when a row or column does not have exactly one part
 * without `size`.
 */
function buildLayout(
	node: LayoutNode,
	resolve: (id: string) => Component,
	theme: ThemeRef,
	host: ScreenHost,
): { component: Component; ids: string[] } {
	const ids: string[] = [];
	const build = (n: LayoutNode): Component => {
		if (typeof n === "string" || "panel" in n) {
			const id = typeof n === "string" ? n : n.panel;
			if (ids.includes(id)) throw new Error(`panel "${id}" appears twice in one layout`);
			ids.push(id);
			return resolve(id);
		}
		if ("row" in n) return split("row", n.row);
		if ("column" in n) return split("column", n.column);
		throw new Error(`unknown layout node ${JSON.stringify(n)}`);
	};
	const split = (axis: "row" | "column", parts: LayoutNode[]): Component => {
		const shares = parts.map(shareOf);
		const rest = shares.filter((share) => share === undefined).length;
		if (rest !== 1) throw new Error(`a ${axis} needs exactly one part without "size", to take the rest (it has ${rest})`);
		const sizes = new Split(axis, shares, host);
		const entries: StackEntry[] = [];
		parts.forEach((part, index) => {
			if (axis === "row" && index > 0) {
				entries.push({ component: new Divider(theme, sizes.dividerMouse(index - 1)), basis: 1, grow: 0, shrink: 0, minSize: 1 });
			}
			const component = build(part);
			entries.push(
				shares[index] === undefined
					? { component, basis: 0, grow: 1, shrink: 1, minSize: MIN_PART }
					: { component, basis: sizes.size(index), grow: 0, shrink: 1, minSize: 1 },
			);
		});
		return axis === "row" ? new SplitRow(entries, sizes) : new SplitColumn(entries, sizes);
	};
	return { component: build(node), ids };
}

export interface BuiltArrangement {
	component: Component;
	/** Panels shown at a terminal width, in layout order. */
	panelsAt(width: number): string[];
}

/**
 * Build a page body. A width-dependent arrangement holds both layouts and lets
 * the stack's `visible` test pick one from the terminal width each frame; the
 * hidden one takes no part in layout, so both may name the same panels.
 */
export function buildArrangement(
	arrangement: Arrangement,
	resolve: (id: string) => Component,
	theme: ThemeRef,
	host: ScreenHost,
): BuiltArrangement {
	if (typeof arrangement === "object" && "minWidth" in arrangement) {
		const { minWidth } = arrangement;
		const wide = buildLayout(arrangement.wide, resolve, theme, host);
		const narrow = buildLayout(arrangement.narrow, resolve, theme, host);
		return {
			component: new VStack([
				{ component: wide.component, basis: 0, grow: 1, shrink: 1, minSize: 1, visible: (viewport) => viewport.width >= minWidth },
				{ component: narrow.component, basis: 0, grow: 1, shrink: 1, minSize: 1, visible: (viewport) => viewport.width < minWidth },
			]),
			panelsAt: (width) => (width >= minWidth ? wide.ids : narrow.ids),
		};
	}
	const single = buildLayout(arrangement, resolve, theme, host);
	return { component: single.component, panelsAt: () => single.ids };
}
