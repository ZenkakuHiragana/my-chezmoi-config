import { readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type CrtState, sanitize, type Versioned } from "../state/core.ts";
import type { FeatureEnv } from "./env.ts";

/** The extension's folder, next to index.ts, where logo.* is put. */
const DIRECTORY = fileURLToPath(new URL("../", import.meta.url));

// Indexed by the eight dots in row-major order. Unicode 16's BLOCK OCTANT
// characters omit patterns already represented by older block characters.
const OCTANTS = Array.from(" 𜺨𜺫🮂𜴀▘𜴁𜴂𜴃𜴄▝𜴅𜴆𜴇𜴈▀𜴉𜴊𜴋𜴌🯦𜴍𜴎𜴏𜴐𜴑𜴒𜴓𜴔𜴕𜴖𜴗𜴘𜴙𜴚𜴛𜴜𜴝𜴞𜴟🯧𜴠𜴡𜴢𜴣𜴤𜴥𜴦𜴧𜴨𜴩𜴪𜴫𜴬𜴭𜴮𜴯𜴰𜴱𜴲𜴳𜴴𜴵🮅𜺣𜴶𜴷𜴸𜴹𜴺𜴻𜴼𜴽𜴾𜴿𜵀𜵁𜵂𜵃𜵄▖𜵅𜵆𜵇𜵈▌𜵉𜵊𜵋𜵌▞𜵍𜵎𜵏𜵐▛𜵑𜵒𜵓𜵔𜵕𜵖𜵗𜵘𜵙𜵚𜵛𜵜𜵝𜵞𜵟𜵠𜵡𜵢𜵣𜵤𜵥𜵦𜵧𜵨𜵩𜵪𜵫𜵬𜵭𜵮𜵯𜵰𜺠𜵱𜵲𜵳𜵴𜵵𜵶𜵷𜵸𜵹𜵺𜵻𜵼𜵽𜵾𜵿𜶀𜶁𜶂𜶃𜶄𜶅𜶆𜶇𜶈𜶉𜶊𜶋𜶌𜶍𜶎𜶏▗𜶐𜶑𜶒𜶓▚𜶔𜶕𜶖𜶗▐𜶘𜶙𜶚𜶛▜𜶜𜶝𜶞𜶟𜶠𜶡𜶢𜶣𜶤𜶥𜶦𜶧𜶨𜶩𜶪𜶫▂𜶬𜶭𜶮𜶯𜶰𜶱𜶲𜶳𜶴𜶵𜶶𜶷𜶸𜶹𜶺𜶻𜶼𜶽𜶾𜶿𜷀𜷁𜷂𜷃𜷄𜷅𜷆𜷇𜷈𜷉𜷊𜷋𜷌𜷍𜷎𜷏𜷐𜷑𜷒𜷓𜷔𜷕𜷖𜷗𜷘𜷙𜷚▄𜷛𜷜𜷝𜷞▙𜷟𜷠𜷡𜷢▟𜷣▆𜷤𜷥█");

type Photon = typeof import("@silvia-odwyer/photon-node");
type Image = import("@silvia-odwyer/photon-node").PhotonImage;

/**
 * One cell of the logo: its glyph, and the brightness (0..1) of the dots it sets and of
 * the dots it leaves; none where those dots are transparent.
 */
export type LogoCell = { glyph: string; fg?: number; bg?: number };

export interface LogoData extends Versioned {
	/** Why logo.* could not be shown; Pi's logo is shown then. */
	error?: string;
	image?: Image;
	photon?: Photon;
	/** The cells of the logo, by the width they were made for. */
	art: Map<number, LogoCell[][]>;
}

/** The largest logo, in cells. */
const COLUMNS = 40;
const ROWS = 20;
/** A logo.* file in the extension's folder: logo.png, logo.jpg, logo.webp, … */
const LOGO_FILE = /^logo\..+$/i;

/** Each pi-crt instance's logo, by its CrtState (see FeatureEnv). */
const features = new WeakMap<CrtState, { data: LogoData; env: FeatureEnv }>();

/** Before setupLogo: no logo.*. Never changed. */
const NONE: Readonly<LogoData> = Object.freeze({ version: 0, art: new Map() });

export function logoData(state: CrtState): Readonly<LogoData> {
	return features.get(state)?.data ?? NONE;
}

export function setupLogo(pi: ExtensionAPI, env: FeatureEnv): void {
	const data: LogoData = { version: 0, art: new Map() };
	features.set(env.state, { data, env });
	let watcher: FSWatcher | undefined;
	let generation = 0;

	/** Read logo.* again, after it was added, replaced or removed. */
	async function readLogo(): Promise<void> {
		const current = ++generation;
		let image: Image | undefined;
		try {
			// When several files match, the first by name wins.
			const name = readdirSync(DIRECTORY).filter((entry) => LOGO_FILE.test(entry)).sort()[0];
			if (name) {
				const bytes = readFileSync(join(DIRECTORY, name));
				const photon = await import("@silvia-odwyer/photon-node");
				image = photon.PhotonImage.new_from_byteslice(bytes);
				if (current !== generation) {
					image.free();
					return;
				}
				data.photon = photon;
			}
			if (current !== generation) return;
			data.image?.free();
			data.image = image;
			data.error = undefined;
		} catch (error) {
			image?.free();
			if (current !== generation) return;
			data.image?.free();
			data.image = undefined;
			data.error = `logo: cannot read image (${reason(error)})`;
		}
		data.art.clear();
		env.changed(data);
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || !ctx.hasUI || watcher) return;
		watcher = watch(DIRECTORY, { persistent: false }, (_event, name) => {
			if (!name || LOGO_FILE.test(name.toString())) void readLogo();
		});
		void readLogo();
	});
	pi.on("session_shutdown", () => {
		generation++;
		watcher?.close();
		watcher = undefined;
		data.image?.free();
		data.image = undefined;
		data.art.clear();
	});
}

function reason(error: unknown): string {
	return sanitize(error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ");
}

/**
 * The logo for a panel `width` cells wide: logo.* at most COLUMNS x ROWS cells, made
 * once per width. None when there is no logo.*, or it cannot be made (the error is
 * kept, and Pi's logo is shown). The colours are applied by the panel, from the theme.
 */
export function logoArt(state: CrtState, width: number): LogoCell[][] | undefined {
	const feature = features.get(state);
	if (!feature) return undefined;
	const { data, env } = feature;
	if (!data.image || !data.photon) return undefined;
	const columns = Math.max(1, Math.min(COLUMNS, width));
	const cached = data.art.get(columns);
	if (cached) return cached;
	try {
		const rows = octantArt(data.photon, data.image, columns);
		data.art.set(columns, rows);
		return rows;
	} catch (error) {
		data.image.free();
		data.image = undefined;
		data.error = `logo: cannot draw image (${reason(error)})`;
		data.art.clear();
		env.changed(data);
		return undefined;
	}
}

/**
 * The picture in octants (2 x 4 dots a cell; a dot is square on screen), fitted into
 * `columns` x ROWS cells. A dot is transparent where the picture is, and otherwise
 * keeps the picture's brightness. A cell sets its opaque dots and leaves its
 * transparent ones, which show the screen; a cell without transparent dots splits
 * them into a bright and a dark set instead.
 */
function octantArt(photon: Photon, image: Image, columns: number): LogoCell[][] {
	const scale = Math.min((columns * 2) / image.get_width(), (ROWS * 4) / image.get_height());
	const w = Math.max(1, Math.round(image.get_width() * scale));
	const h = Math.max(1, Math.round(image.get_height() * scale));
	// photon's resize mixes the colour of transparent pixels into their neighbours, so
	// the colours are weighted by alpha before it and divided by alpha after it.
	const source = image.get_raw_pixels();
	for (let i = 0; i < source.length; i += 4) {
		for (let c = 0; c < 3; c++) source[i + c] = Math.round((source[i + c]! * source[i + 3]!) / 255);
	}
	const weighted = new photon.PhotonImage(source, image.get_width(), image.get_height());
	const resized = photon.resize(weighted, w, h, photon.SamplingFilter.Lanczos3);
	weighted.free();
	try {
		const pixels = resized.get_raw_pixels();
		/** The dot's brightness, or none when it is transparent. */
		const tone = (x: number, y: number): number | undefined => {
			if (x >= w || y >= h) return undefined;
			const i = (y * w + x) * 4;
			const alpha = pixels[i + 3]!;
			if (alpha < 128) return undefined;
			return Math.min(1, (pixels[i]! * 0.299 + pixels[i + 1]! * 0.587 + pixels[i + 2]! * 0.114) / alpha);
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
	} finally {
		resized.free();
	}
}
