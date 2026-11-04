import { createHash } from "node:crypto";
import { readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { allocateImageId, getCapabilities, getCellDimensions, renderImage } from "@earendil-works/pi-tui";
import { type CrtState, sanitize, type Versioned } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/** The extension's folder, next to index.ts, where logo.* is put. */
const DIRECTORY = fileURLToPath(new URL("../", import.meta.url));

// Indexed by the eight dots in row-major order. Unicode 16's BLOCK OCTANT
// characters omit patterns already represented by older block characters.
const OCTANTS = Array.from(" 𜺨𜺫🮂𜴀▘𜴁𜴂𜴃𜴄▝𜴅𜴆𜴇𜴈▀𜴉𜴊𜴋𜴌🯦𜴍𜴎𜴏𜴐𜴑𜴒𜴓𜴔𜴕𜴖𜴗𜴘𜴙𜴚𜴛𜴜𜴝𜴞𜴟🯧𜴠𜴡𜴢𜴣𜴤𜴥𜴦𜴧𜴨𜴩𜴪𜴫𜴬𜴭𜴮𜴯𜴰𜴱𜴲𜴳𜴴𜴵🮅𜺣𜴶𜴷𜴸𜴹𜴺𜴻𜴼𜴽𜴾𜴿𜵀𜵁𜵂𜵃𜵄▖𜵅𜵆𜵇𜵈▌𜵉𜵊𜵋𜵌▞𜵍𜵎𜵏𜵐▛𜵑𜵒𜵓𜵔𜵕𜵖𜵗𜵘𜵙𜵚𜵛𜵜𜵝𜵞𜵟𜵠𜵡𜵢𜵣𜵤𜵥𜵦𜵧𜵨𜵩𜵪𜵫𜵬𜵭𜵮𜵯𜵰𜺠𜵱𜵲𜵳𜵴𜵵𜵶𜵷𜵸𜵹𜵺𜵻𜵼𜵽𜵾𜵿𜶀𜶁𜶂𜶃𜶄𜶅𜶆𜶇𜶈𜶉𜶊𜶋𜶌𜶍𜶎𜶏▗𜶐𜶑𜶒𜶓▚𜶔𜶕𜶖𜶗▐𜶘𜶙𜶚𜶛▜𜶜𜶝𜶞𜶟𜶠𜶡𜶢𜶣𜶤𜶥𜶦𜶧𜶨𜶩𜶪𜶫▂𜶬𜶭𜶮𜶯𜶰𜶱𜶲𜶳𜶴𜶵𜶶𜶷𜶸𜶹𜶺𜶻𜶼𜶽𜶾𜶿𜷀𜷁𜷂𜷃𜷄𜷅𜷆𜷇𜷈𜷉𜷊𜷋𜷌𜷍𜷎𜷏𜷐𜷑𜷒𜷓𜷔𜷕𜷖𜷗𜷘𜷙𜷚▄𜷛𜷜𜷝𜷞▙𜷟𜷠𜷡𜷢▟𜷣▆𜷤𜷥█");

type Image = import("imagescript").Image;
type Frame = { key: string; image: Image; duration: number };

/**
 * One cell of the logo: its glyph, and the brightness (0..1) of the dots it sets and of
 * the dots it leaves; none where those dots are transparent.
 */
export type LogoCell = { glyph: string; fg?: number; bg?: number };

export interface LogoData extends Versioned {
	/** Why logo.* could not be shown; Pi's logo is shown then. */
	error?: string;
	image?: Frame[];
	/** The cells of the logo, by the width they were made for. */
	art: Map<string, LogoCell[][]>;
	/** Composited frames from each scene's image. */
	scenes: Map<LogoScene, Frame[]>;
	errors: Map<LogoScene, string>;
	/**
	 * The Kitty image of the logo, for the last width and colour only: lines kept for
	 * an earlier width would place an image pi-tui counts as sent, which terminals on
	 * libghostty-vt (herdr, Ghostty) free when pi-tui clears the screen for a new size
	 * (as features/image.ts keeps its images). A new image is sent with its data.
	 */
	kitty?: { key: string; pictures: Map<string, LogoPicture | undefined> };
}

/** The logo as a Kitty image: its lines (the image, then the rows it covers) and width in cells. */
export interface LogoPicture {
	lines: string[];
	columns: number;
}

/** The largest logo, in cells. */
const COLUMNS = 40;
const ROWS = 20;
/** A logo.* file in the extension's folder: logo.png, logo.jpg, logo.webp, … */
const LOGO_FILE = /^logo(?:-(standby|thinking|tool|error|done))?\..+$/i;
export type LogoScene = "standby" | "thinking" | "tool" | "error" | "done";
const SCENES: LogoScene[] = ["standby", "thinking", "tool", "error", "done"];

/** Each pi-crt instance's logo, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, { data: LogoData; env: FeatureEnv }>();

/** Before setupLogo: no logo.*. Never changed. */
const NONE: Readonly<LogoData> = Object.freeze({ version: 0, art: new Map(), scenes: new Map(), errors: new Map() });

export function logoData(state: CrtState): Readonly<LogoData> {
	return features.get(state)?.data ?? NONE;
}

export function setupLogo(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: LogoData = { version: 0, art: new Map(), scenes: new Map(), errors: new Map() };
	features.set(env.state, { data, env });
	let watcher: FSWatcher | undefined;
	let reloadTimer: ReturnType<typeof setTimeout> | undefined;
	let generation = 0;

	/** Read all logo files again after an addition, replacement or removal. */
	async function readLogo(): Promise<void> {
		const current = ++generation;
		const scenes = new Map<LogoScene, Frame[]>();
		const errors = new Map<LogoScene, string>();
		let image: Frame[] | undefined;
		let error: string | undefined;
		try {
			const names = readdirSync(DIRECTORY).filter((name) => LOGO_FILE.test(name)).sort();
			if (names.length) {
				const { Animation } = await import("imagescript");
				// Hashes narrow the candidates; a byte comparison makes equality exact.
				const unique = new Map<string, { key: string; pixels: Uint8Array; image: Image }[]>();
				let nextKey = 0;
				const load = async (name: string): Promise<Frame[]> => {
					const animation = await Animation.decode(readFileSync(join(DIRECTORY, name)));
					return animation.frames.map((frame) => {
						const pixels = Uint8Array.from(frame.bitmap);
						for (let i = 0; i < pixels.length; i += 4) if (!pixels[i + 3]) pixels.fill(0, i, i + 3);
						const hash = `${frame.width}x${frame.height}:${createHash("sha256").update(pixels).digest("hex")}`;
						const candidates = unique.get(hash) ?? [];
						let match = candidates.find((item) => item.pixels.every((byte, i) => byte === pixels[i]));
						if (!match) {
							match = { key: String(nextKey++), pixels, image: frame };
							candidates.push(match);
							unique.set(hash, candidates);
						}
						return { key: match.key, image: match.image, duration: frame.duration };
					});
				};
				const fallback = names.find((name) => /^logo\..+$/i.test(name));
				if (fallback) {
					try { image = await load(fallback); }
					catch (e) { error = `logo: cannot read image (${reason(e)})`; }
				}
				for (const scene of SCENES) {
					const name = names.find((name) => new RegExp(`^logo-${scene}\\..+$`, "i").test(name));
					if (!name) continue;
					try { scenes.set(scene, await load(name)); }
					catch (e) { errors.set(scene, `logo-${scene}: cannot read image (${reason(e)})`); }
				}
			}
		} catch (e) {
			error = `logo: cannot read image (${reason(e)})`;
		}
		if (current !== generation) return;
		data.image = image;
		data.error = error;
		data.scenes = scenes;
		data.errors = errors;
		data.art.clear();
		data.kitty = undefined;
		env.changed(data);
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI || watcher) return;
		watcher = watch(DIRECTORY, { persistent: false }, (_event, name) => {
			if (name && !LOGO_FILE.test(name.toString())) return;
			if (reloadTimer) clearTimeout(reloadTimer);
			reloadTimer = setTimeout(() => { reloadTimer = undefined; void readLogo(); }, 50);
		});
		void readLogo();
	});
	pi.on("session_shutdown", () => {
		generation++;
		if (reloadTimer) clearTimeout(reloadTimer);
		watcher?.close();
		watcher = undefined;
		data.image = undefined;
		data.scenes.clear();
		data.art.clear();
		data.kitty = undefined;
	});
}

function reason(error: unknown): string {
	return sanitize(error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ");
}

/**
 * The logo for a panel `width` cells wide: logo.* at most COLUMNS x ROWS cells, made
 * once per width. None when there is no logo.*, or it cannot be made (the error is
 * kept, and Pi's logo is shown). The colours are applied by the panel, from the theme.
 * `elapsed` is the time into the scene: its animation starts with the first frame.
 */
export function logoArt(state: CrtState, width: number, scene: LogoScene = "standby", elapsed = 0): LogoCell[][] | undefined {
	const feature = features.get(state);
	if (!feature) return undefined;
	const { data, env } = feature;
	const columns = Math.max(1, Math.min(COLUMNS, width));
	try {
		const frame = sceneFrame(data, scene, elapsed);
		if (!frame) return undefined;
		const key = `${columns} ${frame.key}`;
		const cached = data.art.get(key);
		if (cached) return cached;
		const rows = octantArt(frame.image, columns);
		data.art.set(key, rows);
		return rows;
	} catch (error) {
		dropImage(data, env, scene, error);
		return undefined;
	}
}

/**
 * The logo as a Kitty image for a panel `width` cells wide, in the colour `accent`, at
 * most COLUMNS x ROWS cells. None when the terminal does not show Kitty images (the
 * panel draws logoArt then), when there is no logo.*, or when it cannot be made.
 * `elapsed` is the time into the scene, as for logoArt.
 */
export function logoPicture(state: CrtState, width: number, accent: readonly [number, number, number], scene: LogoScene = "standby", elapsed = 0): LogoPicture | undefined {
	if (getCapabilities().images !== "kitty") return undefined;
	const feature = features.get(state);
	if (!feature) return undefined;
	const { data, env } = feature;
	const columns = Math.max(1, Math.min(COLUMNS, width));
	// Keep only the last panel width, cell size and colour, including when the logo
	// stays 40 cells wide. The cell size sets the picture's pixels and rows.
	const cell = getCellDimensions();
	const key = `${width} ${cell.widthPx}x${cell.heightPx} ${accent.join(",")}`;
	if (data.kitty?.key !== key) data.kitty = { key, pictures: new Map() };
	try {
		const frame = sceneFrame(data, scene, elapsed);
		if (!frame) return undefined;
		const kitty = data.kitty;
		// Every picture of the scene is made before any is shown, so that an animation
		// does not switch between Kitty images and octants while its pictures are made.
		const frames = data.scenes.get(scene) ?? data.image ?? [];
		for (const each of frames) {
			if (kitty.pictures.has(each.key)) continue;
			kitty.pictures.set(each.key, undefined);
			void kittyPicture(each.image, columns, accent).then((picture) => {
				if (data.kitty !== kitty) return;
				kitty.pictures.set(each.key, picture);
				env.changed(data);
			}).catch((error: unknown) => {
				if (data.kitty === kitty) dropImage(data, env, scene, error);
			});
		}
		if (frames.some((each) => kitty.pictures.get(each.key) === undefined)) return undefined;
		return kitty.pictures.get(frame.key);
	} catch (error) {
		dropImage(data, env, scene, error);
		return undefined;
	}
}

export function logoError(state: CrtState, scene: LogoScene): string | undefined {
	const data = logoData(state);
	// logo.*'s error only where logo.* would be shown.
	return data.errors.get(scene) ?? (data.scenes.has(scene) ? undefined : data.error);
}

/** The composited frame `elapsed` ms into the scene, and the next time (in the same terms) its picture changes. */
function frameAt(data: Readonly<LogoData>, scene: LogoScene, elapsed: number): { frame?: Frame; next?: number } {
	const frames = data.scenes.get(scene) ?? data.image;
	if (!frames?.length) return {};
	const total = frames.reduce((sum, frame) => sum + frame.duration, 0);
	if (!total) return { frame: frames[0] };
	let at = ((elapsed % total) + total) % total;
	let index = 0;
	while (index < frames.length && at >= frames[index]!.duration) at -= frames[index++]!.duration;
	const frame = frames[index] ?? frames[0]!;
	let next = elapsed + frame.duration - at;
	for (let offset = 1; offset < frames.length; offset++) {
		const following = frames[(index + offset) % frames.length]!;
		if (following.duration > 0 && following.key !== frame.key) return { frame, next };
		next += following.duration;
	}
	return { frame };
}

/** The visible picture's identity and its next change, `elapsed` ms into the scene, for scheduling and caching. */
export function logoFrameTime(state: CrtState, scene: LogoScene, elapsed: number): { key?: string; next?: number } {
	const { frame, next } = frameAt(logoData(state), scene, elapsed);
	return { key: frame?.key, next };
}

/** The current composited frame feeds both Kitty and octant rendering. */
function sceneFrame(data: LogoData, scene: LogoScene, elapsed: number): Frame | undefined {
	return frameAt(data, scene, elapsed).frame;
}

/** Discard a failed source and fall back to logo.* or Pi's logo. */
function dropImage(data: LogoData, env: FeatureEnv, scene: LogoScene, error: unknown): void {
	const images = data.scenes.get(scene);
	if (images) {
		data.scenes.delete(scene);
		data.errors.set(scene, `logo-${scene}: cannot draw image (${reason(error)})`);
	} else {
		data.image = undefined;
		data.error = `logo: cannot draw image (${reason(error)})`;
	}
	data.art.clear();
	data.kitty = undefined;
	env.changed(data);
}

/**
 * The picture as a Kitty image fitted into `columns` x ROWS cells: each pixel keeps
 * its brightness and its transparency, in the colour `accent`. The picture is sent
 * at its own size; the terminal scales it to the cells.
 */
async function kittyPicture(image: Image, columns: number, accent: readonly [number, number, number]): Promise<LogoPicture | undefined> {
	// Pi keeps the Kitty images that are off screen only up to 32 MiB sent and 64 MiB
	// decoded, and sends an image pushed out again with its data. A picture larger than
	// the cells show is made as small as the cells to reduce its use of that cache.
	const cell = getCellDimensions();
	const fit = Math.min(1, (columns * cell.widthPx) / image.width, (ROWS * cell.heightPx) / image.height);
	const w = Math.max(1, Math.round(image.width * fit));
	const h = Math.max(1, Math.round(image.height * fit));
	// ImageScript resamples with premultiplied alpha and returns straight RGB.
	const tinted = image.clone();
	if (fit < 1) tinted.resize(w, h);
	const pixels = tinted.bitmap;
	for (let i = 0; i < pixels.length; i += 4) {
		const light = pixels[i]! * 0.299 + pixels[i + 1]! * 0.587 + pixels[i + 2]! * 0.114;
		const brightness = light / 255;
		for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(accent[c]! * brightness);
	}
	const png = await tinted.encode();
	const result = renderImage(Buffer.from(png).toString("base64"), { widthPx: w, heightPx: h }, {
		maxWidthCells: columns,
		maxHeightCells: ROWS,
		imageId: allocateImageId(),
		moveCursor: false,
	});
	if (!result) return undefined;
	return { lines: [result.sequence, ...Array.from({ length: result.rows - 1 }, () => "")], columns: result.columns };
}

/**
 * The picture in octants (2 x 4 dots a cell; a dot is square on screen), fitted into
 * `columns` x ROWS cells. A dot is transparent where the picture is, and otherwise
 * keeps the picture's brightness. A cell sets its opaque dots and leaves its
 * transparent ones, which show the screen; a cell without transparent dots splits
 * them into a bright and a dark set instead.
 */
function octantArt(image: Image, columns: number): LogoCell[][] {
	const scale = Math.min((columns * 2) / image.width, (ROWS * 4) / image.height);
	const w = Math.max(1, Math.round(image.width * scale));
	const h = Math.max(1, Math.round(image.height * scale));
	const pixels = image.clone().resize(w, h).bitmap;
	/** The dot's brightness, or none when it is transparent. */
	const tone = (x: number, y: number): number | undefined => {
		if (x >= w || y >= h) return undefined;
		const i = (y * w + x) * 4;
		const alpha = pixels[i + 3]!;
		if (alpha < 128) return undefined;
		return (pixels[i]! * 0.299 + pixels[i + 1]! * 0.587 + pixels[i + 2]! * 0.114) / 255;
	};
	const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
	const rows: LogoCell[][] = [];
	for (let row = 0; row * 4 < h; row++) {
		const line: LogoCell[] = [];
		for (let col = 0; col * 2 < w; col++) {
			const values = Array.from({ length: 8 }, (_, i) => tone(col * 2 + (i % 2), row * 4 + Math.floor(i / 2)));
			const opaque = values.filter((value) => value !== undefined);
			let mask = 0;
			if (opaque.length < 8) {
				values.forEach((value, i) => {
					if (value !== undefined) mask |= 1 << i;
				});
				line.push({ glyph: OCTANTS[mask]!, fg: opaque.length ? average(opaque) : undefined });
				continue;
			}
			const low = Math.min(...opaque);
			const high = Math.max(...opaque);
			// A cell of one brightness (within a step of the picture's 8 bits) sets all its dots.
			const mid = high - low < 1 / 255 ? low : (low + high) / 2;
			const bright: number[] = [];
			const dark: number[] = [];
			opaque.forEach((value, i) => {
				if (value >= mid) {
					mask |= 1 << i;
					bright.push(value);
				} else {
					dark.push(value);
				}
			});
			line.push({ glyph: OCTANTS[mask]!, fg: average(bright), bg: dark.length ? average(dark) : undefined });
		}
		rows.push(line);
	}
	return rows;
}
