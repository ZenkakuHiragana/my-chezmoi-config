/**
 * Images in the transcript.
 *
 * pi-crt hides tool results from the transcript (they belong to TOOL LOG), which takes
 * the images a tool returns with them. Instead the assistant writes an image link in its
 * own reply, and this feature draws it: every markdown body pi is about to render has its
 * standalone image links replaced by terminal image lines.
 *
 * Local files only. The transformer returns its result synchronously, so a remote image
 * could not be fetched in time; such links stay as links.
 */

import { readFileSync, statSync } from "node:fs";
import { Image } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FeatureEnv } from "./env.ts";
import { imageType, replaceImageLinks } from "./image-links.ts";

/** Rows an image may take, so one image cannot fill the transcript. */
const MAX_HEIGHT_CELLS = 24;
/** Images kept as rendered lines. A streaming reply re-renders the same body repeatedly. */
const MAX_CACHED = 16;

export function setupImages(pi: ExtensionAPI, env: FeatureEnv): void {
	const cache = new Map<string, string[]>();

	const renderImage = (path: string, width: number): string[] | undefined => {
		if (width <= 0) return undefined;
		let modified: number;
		let size: number;
		try {
			const stats = statSync(path);
			if (!stats.isFile()) return undefined;
			modified = stats.mtimeMs;
			size = stats.size;
		} catch {
			return undefined;
		}
		const key = `${path}\u0000${modified}\u0000${size}\u0000${width}`;
		const cached = cache.get(key);
		if (cached) return cached;
		const mimeType = imageType(path);
		if (!mimeType) return undefined;
		const theme = env.context()?.ui.theme;
		let lines: string[];
		try {
			const base64 = readFileSync(path).toString("base64");
			const image = new Image(
				base64,
				mimeType,
				{ fallbackColor: (text) => theme?.fg("muted", text) ?? text },
				{ maxWidthCells: width, maxHeightCells: MAX_HEIGHT_CELLS, filename: path },
			);
			lines = image.render(width);
		} catch {
			return undefined;
		}
		if (lines.length === 0) return undefined;
		if (cache.size >= MAX_CACHED) {
			const oldest = cache.keys().next();
			if (!oldest.done) cache.delete(oldest.value);
		}
		cache.set(key, lines);
		return lines;
	};

	pi.registerMarkdownTransformer((markdown, context) => {
		const cwd = env.context()?.cwd;
		if (cwd === undefined) return markdown;
		return replaceImageLinks(markdown, { width: context.availableWidth, cwd, renderImage });
	});
}
