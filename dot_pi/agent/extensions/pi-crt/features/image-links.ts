/**
 * Markdown image links in a message body, turned into terminal image lines.
 *
 * Pi's markdown rendering never draws an image link: pi-tui's components/markdown.js
 * has no image token case, so the link falls through to plain text and only its alt
 * text shows. Lines that already hold an image do pass through untouched — markdown.js
 * skips wrapping and background fills for them. So a markdown transformer can swap a
 * link for the image lines themselves and pi draws them.
 *
 * This module holds no pi-crt state and calls no pi API: reading the file and encoding
 * the image are passed in, which keeps the rewriting testable on its own.
 */

import { isAbsolute, resolve } from "node:path";

/**
 * MIME type by extension, for the formats pi-tui's Image draws (PNG, JPEG, GIF, WebP).
 * A link to any other file is left as a link.
 */
const IMAGE_TYPES: ReadonlyMap<string, string> = new Map([
	["png", "image/png"],
	["jpg", "image/jpeg"],
	["jpeg", "image/jpeg"],
	["gif", "image/gif"],
	["webp", "image/webp"],
]);

/** The MIME type of an image file, from its extension; undefined for other files. */
export function imageType(path: string): string | undefined {
	return IMAGE_TYPES.get(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
}

/**
 * Matches a line that is nothing but an image link.
 *
 * An image occupies whole rows: pi-tui's compositeTuiLine() drops an overlay onto an
 * image row and mangles an image line placed anywhere but column 0, so an image cannot
 * sit inside a line of prose. Links inside prose stay as they are.
 */
const STANDALONE_IMAGE_RE =
	/^[ \t]*!\[([^\]]*)\]\([ \t]*(<[^>\n]*>|[^()\s]+)(?:[ \t]+"[^"\n]*"|[ \t]+'[^'\n]*')?[ \t]*\)[ \t]*$/;

/**
 * Zero-width space. Pi re-parses the transformed body as markdown, and markdown drops
 * blank lines, so the empty rows pi-tui returns below an image would vanish and the
 * image would overlap whatever follows. A paragraph of zero-width spaces separated by
 * hard breaks keeps those rows: it renders one line per entry, with nothing visible.
 */
const ZERO_WIDTH = "\u200b";

/** Opening or closing fence of a code block. */
const FENCE_RE = /^[ \t]*(```+|~~~+)/;

export interface ImageLinkOptions {
	/** Columns available for the image. */
	width: number;
	/** Directory relative paths resolve against. */
	cwd: string;
	/**
	 * Renders a local image as terminal lines, or undefined when it cannot. The caller
	 * caches: a streaming reply runs the transformer again on every update.
	 */
	renderImage: (path: string, width: number) => string[] | undefined;
}

/**
 * Resolves a link target to a local image file, or undefined when the target is not one
 * (a remote or data URL, or a file that is not an image).
 */
export function localImageTarget(target: string, cwd: string): string | undefined {
	let text = target.trim();
	if (text.startsWith("<") && text.endsWith(">")) text = text.slice(1, -1).trim();
	if (text === "") return undefined;
	// A windows drive letter looks like a URL scheme, so it is checked first.
	const windowsDrive = /^[a-zA-Z]:[\\/]/.test(text);
	// data: and anything fetched over the network cannot be read within the transformer.
	if (!windowsDrive && /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^file:/i.test(text)) return undefined;
	let path: string;
	if (!windowsDrive && /^file:/i.test(text)) {
		try {
			path = fileUrlToPath(text);
		} catch {
			return undefined;
		}
	} else {
		path = decodePercent(text);
	}
	if (path === "") return undefined;
	if (imageType(path) === undefined) return undefined;
	return isAbsolute(path) ? path : resolve(cwd, path);
}

/** A file:// URL as a local path, including the windows `/C:/dir` form. */
function fileUrlToPath(text: string): string {
	const url = new URL(text);
	if (url.hostname !== "" && url.hostname !== "localhost") throw new Error("remote file url");
	const pathname = decodePercent(url.pathname);
	return /^\/[a-zA-Z]:/.test(pathname) ? pathname.slice(1) : pathname;
}

/** Percent-decoded text, or the text itself when it does not decode. */
function decodePercent(text: string): string {
	if (!text.includes("%")) return text;
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

/**
 * The body with every standalone image link replaced by its image lines.
 *
 * A link that cannot be drawn — remote, unreadable, or inside prose or a code block —
 * is left alone, so pi renders it as before and its alt text still shows.
 */
export function replaceImageLinks(markdown: string, options: ImageLinkOptions): string {
	if (!markdown.includes("![")) return markdown;
	const lines = markdown.split("\n");
	let fence: string | undefined;
	let changed = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!;
		const hasCr = line.endsWith("\r");
		const body = hasCr ? line.slice(0, -1) : line;
		const fenceMatch = FENCE_RE.exec(body);
		if (fenceMatch) {
			const marker = fenceMatch[1]!;
			if (fence === undefined) fence = marker[0];
			else if (marker[0] === fence) fence = undefined;
			continue;
		}
		if (fence !== undefined) continue;
		const match = STANDALONE_IMAGE_RE.exec(body);
		if (!match) continue;
		const path = localImageTarget(match[2]!, options.cwd);
		if (path === undefined) continue;
		const rendered = options.renderImage(path, options.width);
		if (rendered === undefined || rendered.length === 0) continue;
		lines[index] = imageBlock(rendered) + (hasCr ? "\r" : "");
		changed = true;
	}
	return changed ? lines.join("\n") : markdown;
}

/**
 * An image as markdown that keeps the rows it needs.
 *
 * pi-tui returns one line per row: the escape sequence, then empty rows. Markdown drops
 * the empty ones, so they are replaced by a following paragraph of zero-width spaces.
 * Markdown puts one blank line between the two paragraphs, which covers one row, so the
 * paragraph holds two rows fewer than the image, and at least one: without a second
 * paragraph there is no blank line either.
 */
function imageBlock(rendered: readonly string[]): string {
	const first = rendered[0]!;
	if (rendered.length <= 1) return first;
	const fillers = Math.max(1, rendered.length - 2);
	return `${first}\n\n${Array.from({ length: fillers }, () => ZERO_WIDTH).join("  \n")}`;
}
