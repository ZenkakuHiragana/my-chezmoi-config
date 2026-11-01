/**
 * The smallest screen piece: a component that draws the lines a function returns.
 */
import {
	type Component,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

export type ThemeRef = () => Theme;

/**
 * A leaf that renders whatever lines `produce` returns, clipped to the width.
 * With `key`, the clipped lines are reused until the width or any key value
 * changes; long panels use this because the screen redraws several times a second.
 * With `fitted`, `produce` returns lines no wider than the width and they are
 * not clipped again: clipping a long coloured line costs more than making it.
 */
export class Lines implements Component {
	private cache?: { width: number; key: unknown[]; lines: string[] };
	constructor(
		private readonly produce: (width: number) => string[],
		private readonly key?: () => unknown[],
		private readonly fitted = false,
	) {}
	render(width: number): string[] {
		const key = this.key?.();
		const cache = this.cache;
		if (key && cache && cache.width === width && cache.key.length === key.length && cache.key.every((v, i) => v === key[i])) {
			return cache.lines;
		}
		const produced = this.produce(width);
		const lines = this.fitted ? produced : produced.map((line) => truncateToWidth(line, width));
		if (key) this.cache = { width, key, lines };
		return lines;
	}
	invalidate(): void {
		this.cache = undefined;
	}
}
