/**
 * Pixel art drawn with half blocks: one cell holds two pixels, stacked.
 *
 * The same way pi draws its own logo (modes/interactive/components/pi-logo.js). That
 * module is internal to pi's interactive mode, so the logo's pixels live here instead.
 *
 * Colouring is passed in, which keeps the pixel layout testable without a terminal.
 */

/** Upper pixel only. */
const UPPER = "▀";
/** Lower pixel only. */
const LOWER = "▄";
/** Both pixels. */
const FULL = "█";

/** The character for a pixel that is not painted. */
export const TRANSPARENT = ".";

/**
 * Paints one run of glyphs. `fg` and `bg` are the characters used in the art, which name
 * a colour. Returning the glyph unchanged draws the art without colour.
 */
export type Paint = (glyph: string, colors: { fg?: string; bg?: string }) => string;

/** Draws the art without colour. */
export const plainPaint: Paint = (glyph) => glyph;

export interface PixelArtOptions {
	/** Cells per pixel across. Cells are taller than they are wide, so 2 looks square. */
	scaleX?: number;
	/** Pixel rows per pixel down. */
	scaleY?: number;
	/** Colouring; none by default. */
	paint?: Paint;
}

/**
 * The art as terminal lines.
 *
 * `rows` holds one character per pixel. `.` and a space are not painted; any other
 * character names a colour for `paint`. Rows shorter than the widest one are padded with unpainted pixels.
 */
export function renderPixelArt(rows: readonly string[], options: PixelArtOptions = {}): string[] {
	const scaleX = Math.max(1, Math.floor(options.scaleX ?? 2));
	const scaleY = Math.max(1, Math.floor(options.scaleY ?? 1));
	const paint = options.paint ?? plainPaint;
	const pixels = expand(rows, scaleY);
	const width = pixels.reduce((max, row) => Math.max(max, row.length), 0);
	const lines: string[] = [];
	for (let top = 0; top < pixels.length; top += 2) {
		let line = "";
		for (let column = 0; column < width; column++) {
			const upper = pixels[top]?.[column] ?? TRANSPARENT;
			const lower = pixels[top + 1]?.[column] ?? TRANSPARENT;
			line += cell(upper, lower, paint, scaleX);
		}
		lines.push(line);
	}
	return lines;
}

/** Rows repeated to stretch the art downwards. */
function expand(rows: readonly string[], scaleY: number): string[] {
	if (scaleY === 1) return [...rows];
	const out: string[] = [];
	for (const row of rows) for (let index = 0; index < scaleY; index++) out.push(row);
	return out;
}

/**
 * Two stacked pixels, repeated across. The colour is set once for the whole run rather
 * than per cell, which keeps the line short.
 */
function cell(upper: string, lower: string, paint: Paint, repeat: number): string {
	const hasUpper = upper !== TRANSPARENT && upper !== " ";
	const hasLower = lower !== TRANSPARENT && lower !== " ";
	if (!hasUpper && !hasLower) return " ".repeat(repeat);
	if (hasUpper && !hasLower) return paint(UPPER.repeat(repeat), { fg: upper });
	if (!hasUpper && hasLower) return paint(LOWER.repeat(repeat), { fg: lower });
	if (upper === lower) return paint(FULL.repeat(repeat), { fg: upper });
	return paint(UPPER.repeat(repeat), { fg: upper, bg: lower });
}

/** Cells the art takes across. */
export function pixelArtWidth(rows: readonly string[], scaleX = 2): number {
	const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
	return width * Math.max(1, Math.floor(scaleX));
}

/** Pi's logo, as laid out in pi's own pi-logo.d.ts. */
export const PI_LOGO: readonly string[] = ["ccc.", "b.c.", "bb.y", "b..y"];

export type Rgb = [number, number, number];

/**
 * The logo's three colours as brightnesses of one colour. Pi's own logo is coral, blue
 * and yellow, which clash with a CRT screen, so the theme's colour is shaded instead.
 */
export const PI_LOGO_SHADES: Record<string, number> = { c: 1, y: 0.76, b: 0.52 };

/** The colour at a brightness: 1 keeps it, 0 is black. */
export function shade(color: Rgb, factor: number): Rgb {
	const clamp = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));
	return [clamp(color[0] * factor), clamp(color[1] * factor), clamp(color[2] * factor)];
}

/** Art characters mapped to shades of one colour. */
export function shadePalette(base: Rgb, shades: Record<string, number> = PI_LOGO_SHADES): Record<string, Rgb> {
	const palette: Record<string, Rgb> = {};
	for (const [key, factor] of Object.entries(shades)) palette[key] = shade(base, factor);
	return palette;
}
