/**
 * Claude token counts, ported from ctok v1.4.0 (https://github.com/sanderland/ctok, MIT;
 * see THIRD_PARTY_NOTICES.md). ctok reconstructs Claude's counts from recorded count_tokens
 * responses; it does not know Anthropic's token boundaries, and neither does this port. Only
 * the count is ported: ctok's tie-breaks between equal-cost tilings never change the cost.
 * The rules below follow ctok's constants.py, normalize.py, engine.py and main.py.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---- marker notation (ctok constants.py) ----
const BOW = "\uFDD0", EOW = "\uFDD1", SHIFT = "\uFDD3", CAPS = "\uFDD4", HUMAN = "\uFDD5", ASSISTANT = "\uFDD6";
const MARKERS = new Set([BOW, EOW, SHIFT, CAPS, HUMAN, ASSISTANT]);
const MARKER_CPS = new Set(Array.from(MARKERS, (marker) => marker.charCodeAt(0)));
const TURN_GLYPHS = new Set([HUMAN, ASSISTANT]);
const ATOM_TO_GLYPH: Record<string, string> = { "⟨bow⟩": BOW, "⟨eow⟩": EOW, "⟨shift⟩": SHIFT, "⟨caps⟩": CAPS, "⟨human⟩": HUMAN, "⟨assistant⟩": ASSISTANT };
// Literal marker codepoints in text are escaped after NFC into private use, in ctok's GLYPH_TO_ATOM order.
const LITERAL_GLYPHS = [BOW, EOW, "\uFDD2", SHIFT, CAPS, HUMAN, ASSISTANT];
const ESCAPE_OF = new Map(LITERAL_GLYPHS.map((glyph, i) => [glyph, String.fromCharCode(0xE000 + i)]));
const LITERAL_OF = new Map(LITERAL_GLYPHS.map((glyph, i) => [String.fromCharCode(0xE000 + i), glyph]));
const LITERAL_GLYPH_RE = /[\uFDD0-\uFDD6]/g;

const WORDY = "wordy", HARD = "hard", DIGIT = "digit", PUNCT = "punct", SPACE = "space", STRAY = "stray_mark", TURN = "turn";
type RunClass = typeof WORDY | typeof HARD | typeof DIGIT | typeof PUNCT | typeof SPACE | typeof STRAY | typeof TURN;
interface Run { cls: RunClass; body: string }

const PUNCT_SYMS = new Set("\u2014\xbb\xab\u2022\xb0\u201e\u2013\u2212\xa3\xa7\u20ac\u2026\u221a\u2192\uff08\u2116\u2020\u2514\u2502\u0f0d\xb7\u2500\u2550\u2588");
const IDEOGRAPHIC_SYMBOLS = new Set("\u3004\u3012\u3013\u3020\u3036\u3037\u303e\u303f");
const SYMBOL_LETTERS: readonly (readonly [number, number])[] = [[0x16EE, 0x16F0], [0x2160, 0x2188], [0x24B6, 0x24E9], [0xA6E6, 0xA6EF]];
const STRIP_CONTROL = /[\x01-\x08\x0B-\x1F\x7F\x80-\x9F]/g;
const STRIP_PRIVATE = /[\uE000-\uF8FF]/g;
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;
const FUNNY_SPACE = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F]/g;
const QUOTE_FOLD = /[\u2018\u2019\u201C\u201D]/g;
const QUOTE_ASCII: Record<string, string> = { "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"' };
const CONTRACTION_SUFFIXES = new Set(["s", "t", "d", "m", "ll", "re", "ve"]);
// ctok's SEAM_RE: its "." stops only at LF.
const SEAM_RE = /([^\n])\uFDD1 ([\uFDD3\uFDD4]*)\uFDD0/gu;
const NAMESPACE_RE = /(?<=<)(\/?)\/?antml:(?:\/?antml:)*(?=[^<>])/gi;
const TURN_RE = /(?<=\n\n)(human|assistant):/i;

// ---- Unicode data (ctok normalize.py) ----
// Unicode 16.0 cased pairs ctok adds for its older Python data; the same mapping as current JavaScript.
const NEW_CASE_PAIRS: Record<string, string> = { "\u1c89": "\u1c8a", "\ua7cb": "\u0264", "\ua7cc": "\ua7cd", "\ua7da": "\ua7db", "\ua7dc": "\u019b" };
const NEW_CASED = new Set([...Object.keys(NEW_CASE_PAIRS), ...Object.values(NEW_CASE_PAIRS)]);
const NEW_LOWER = new Set(Object.values(NEW_CASE_PAIRS));
const UNCASED = "\u03f4";
/**
 * Canonical combining classes other than 0, from Python's unicodedata 16.0.0 (JavaScript exposes
 * none): `unicodedata.combining(chr(o))` over every codepoint, as ranges of equal class.
 */
const CCC = new Map<number, number>();
for (const entry of "300-314:230 315:232 316-319:220 31A:232 31B:216 31C-320:220 321-322:202 323-326:220 327-328:202 329-333:220 334-338:1 339-33C:220 33D-344:230 345:240 346:230 347-349:220 34A-34C:230 34D-34E:220 350-352:230 353-356:220 357:230 358:232 359-35A:220 35B:230 35C:233 35D-35E:234 35F:233 360-361:234 362:233 363-36F:230 483-487:230 591:220 592-595:230 596:220 597-599:230 59A:222 59B:220 59C-5A1:230 5A2-5A7:220 5A8-5A9:230 5AA:220 5AB-5AC:230 5AD:222 5AE:228 5AF:230 5B0:10 5B1:11 5B2:12 5B3:13 5B4:14 5B5:15 5B6:16 5B7:17 5B8:18 5B9-5BA:19 5BB:20 5BC:21 5BD:22 5BF:23 5C1:24 5C2:25 5C4:230 5C5:220 5C7:18 610-617:230 618:30 619:31 61A:32 64B:27 64C:28 64D:29 64E:30 64F:31 650:32 651:33 652:34 653-654:230 655-656:220 657-65B:230 65C:220 65D-65E:230 65F:220 670:35 6D6-6DC:230 6DF-6E2:230 6E3:220 6E4:230 6E7-6E8:230 6EA:220 6EB-6EC:230 6ED:220 711:36 730:230 731:220 732-733:230 734:220 735-736:230 737-739:220 73A:230 73B-73C:220 73D:230 73E:220 73F-741:230 742:220 743:230 744:220 745:230 746:220 747:230 748:220 749-74A:230 7EB-7F1:230 7F2:220 7F3:230 7FD:220 816-819:230 81B-823:230 825-827:230 829-82D:230 859-85B:220 897-898:230 899-89B:220 89C-89F:230 8CA-8CE:230 8CF-8D3:220 8D4-8E1:230 8E3:220 8E4-8E5:230 8E6:220 8E7-8E8:230 8E9:220 8EA-8EC:230 8ED-8EF:220 8F0:27 8F1:28 8F2:29 8F3-8F5:230 8F6:220 8F7-8F8:230 8F9-8FA:220 8FB-8FF:230 93C:7 94D:9 951:230 952:220 953-954:230 9BC:7 9CD:9 9FE:230 A3C:7 A4D:9 ABC:7 ACD:9 B3C:7 B4D:9 BCD:9 C3C:7 C4D:9 C55:84 C56:91 CBC:7 CCD:9 D3B-D3C:9 D4D:9 DCA:9 E38-E39:103 E3A:9 E48-E4B:107 EB8-EB9:118 EBA:9 EC8-ECB:122 F18-F19:220 F35:220 F37:220 F39:216 F71:129 F72:130 F74:132 F7A-F7D:130 F80:130 F82-F83:230 F84:9 F86-F87:230 FC6:220 1037:7 1039-103A:9 108D:220 135D-135F:230 1714-1715:9 1734:9 17D2:9 17DD:230 18A9:228 1939:222 193A:230 193B:220 1A17:230 1A18:220 1A60:9 1A75-1A7C:230 1A7F:220 1AB0-1AB4:230 1AB5-1ABA:220 1ABB-1ABC:230 1ABD:220 1ABF-1AC0:220 1AC1-1AC2:230 1AC3-1AC4:220 1AC5-1AC9:230 1ACA:220 1ACB-1ACE:230 1B34:7 1B44:9 1B6B:230 1B6C:220 1B6D-1B73:230 1BAA-1BAB:9 1BE6:7 1BF2-1BF3:9 1C37:7 1CD0-1CD2:230 1CD4:1 1CD5-1CD9:220 1CDA-1CDB:230 1CDC-1CDF:220 1CE0:230 1CE2-1CE8:1 1CED:220 1CF4:230 1CF8-1CF9:230 1DC0-1DC1:230 1DC2:220 1DC3-1DC9:230 1DCA:220 1DCB-1DCC:230 1DCD:234 1DCE:214 1DCF:220 1DD0:202 1DD1-1DF5:230 1DF6:232 1DF7-1DF8:228 1DF9:220 1DFA:218 1DFB:230 1DFC:233 1DFD:220 1DFE:230 1DFF:220 20D0-20D1:230 20D2-20D3:1 20D4-20D7:230 20D8-20DA:1 20DB-20DC:230 20E1:230 20E5-20E6:1 20E7:230 20E8:220 20E9:230 20EA-20EB:1 20EC-20EF:220 20F0:230 2CEF-2CF1:230 2D7F:9 2DE0-2DFF:230 302A:218 302B:228 302C:232 302D:222 302E-302F:224 3099-309A:8 A66F:230 A674-A67D:230 A69E-A69F:230 A6F0-A6F1:230 A806:9 A82C:9 A8C4:9 A8E0-A8F1:230 A92B-A92D:220 A953:9 A9B3:7 A9C0:9 AAB0:230 AAB2-AAB3:230 AAB4:220 AAB7-AAB8:230 AABE-AABF:230 AAC1:230 AAF6:9 ABED:9 FB1E:26 FE20-FE26:230 FE27-FE2D:220 FE2E-FE2F:230 101FD:220 102E0:220 10376-1037A:230 10A0D:220 10A0F:230 10A38:230 10A39:1 10A3A:220 10A3F:9 10AE5:230 10AE6:220 10D24-10D27:230 10D69-10D6D:230 10EAB-10EAC:230 10EFD-10EFF:220 10F46-10F47:220 10F48-10F4A:230 10F4B:220 10F4C:230 10F4D-10F50:220 10F82:230 10F83:220 10F84:230 10F85:220 11046:9 11070:9 1107F:9 110B9:9 110BA:7 11100-11102:230 11133-11134:9 11173:7 111C0:9 111CA:7 11235:9 11236:7 112E9:7 112EA:9 1133B-1133C:7 1134D:9 11366-1136C:230 11370-11374:230 113CE-113D0:9 11442:9 11446:7 1145E:230 114C2:9 114C3:7 115BF:9 115C0:7 1163F:9 116B6:9 116B7:7 1172B:9 11839:9 1183A:7 1193D-1193E:9 11943:7 119E0:9 11A34:9 11A47:9 11A99:9 11C3F:9 11D42:7 11D44-11D45:9 11D97:9 11F41-11F42:9 1612F:9 16AF0-16AF4:1 16B30-16B36:230 16FF0-16FF1:6 1BC9E:1 1D165-1D166:216 1D167-1D169:1 1D16D:226 1D16E-1D172:216 1D17B-1D182:220 1D185-1D189:230 1D18A-1D18B:220 1D1AA-1D1AD:230 1D242-1D244:230 1E000-1E006:230 1E008-1E018:230 1E01B-1E021:230 1E023-1E024:230 1E026-1E02A:230 1E08F:230 1E130-1E136:230 1E2AE:230 1E2EC-1E2EF:230 1E4EC-1E4ED:232 1E4EE:220 1E4EF:230 1E5EE:230 1E5EF:220 1E8D0-1E8D6:220 1E944-1E949:230 1E94A:7".split(" ")) {
	const [range, ccc] = entry.split(":");
	const [a, b = a] = range!.split("-").map((hex) => parseInt(hex, 16));
	for (let o = a!; o <= b!; o++) CCC.set(o, Number(ccc));
}
/** Class-0 characters whose decomposition starts with a nonzero class. */
const LEADING_NONSTARTERS = new Set([0x0F73, 0x0F75, 0x0F81]);
/** Longer runs of nonzero classes are put in canonical order here: the engine's reordering is quadratic in a run's length. */
const LONG_RUN = 32;
const CATEGORIES = ["Lu", "Ll", "Lt", "Lm", "Lo", "Mn", "Mc", "Me", "Nd", "Nl", "No", "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po", "Sm", "Sc", "Sk", "So", "Zs", "Zl", "Zp", "Cc", "Cf", "Cs", "Co", "Cn"];
const ALPHABETIC = /^\p{Alphabetic}$/u, MARK = /^\p{M}$/u, UPPERCASE = /^\p{Uppercase}$/u, LOWERCASE = /^\p{Lowercase}$/u;
/**
 * General category, Mark and Alphabetic for every BMP codepoint, read once from the engine's Unicode
 * data. Built from the code space, not from counted text, so no counted character stays in memory.
 */
let bmp: { readonly category: Uint8Array; readonly mark: Uint8Array; readonly alphabetic: Uint8Array } | undefined;
function bmpTables(): NonNullable<typeof bmp> {
	if (!bmp) {
		const category = new Uint8Array(0x10000).fill(CATEGORIES.indexOf("Cn")), mark = new Uint8Array(0x10000), alphabetic = new Uint8Array(0x10000);
		category.fill(CATEGORIES.indexOf("Cs"), 0xD800, 0xE000);
		// Surrogates are left out: adjacent ones would read as one astral codepoint.
		let all = "";
		for (let o = 0; o < 0x10000; o++) if (o < 0xD800 || o > 0xDFFF) all += String.fromCharCode(o);
		const scan = (re: RegExp, table: Uint8Array, value: number) => { for (const [c] of all.matchAll(re)) table[c.charCodeAt(0)] = value; };
		CATEGORIES.forEach((gc, i) => { if (gc !== "Cs" && gc !== "Cn") scan(new RegExp("\\p{gc=" + gc + "}", "gu"), category, i); });
		scan(/\p{M}/gu, mark, 1);
		scan(/\p{Alphabetic}/gu, alphabetic, 1);
		bmp = { category, mark, alphabetic };
	}
	return bmp;
}
function category(c: string): string {
	const o = cp(c);
	return o < 0x10000 ? CATEGORIES[bmpTables().category[o]!]! : ASTRAL_CATEGORIES.find(([, re]) => re.test(c))?.[0] ?? "Cn";
}
const ASTRAL_CATEGORIES = CATEGORIES.filter((gc) => gc !== "Cn").map((gc) => [gc, new RegExp("^\\p{gc=" + gc + "}$", "u")] as const);
const isMark = (c: string) => { const o = cp(c); return o < 0x10000 ? bmpTables().mark[o] === 1 : MARK.test(c); };
const isAlphabetic = (c: string) => { const o = cp(c); return o < 0x10000 ? bmpTables().alphabetic[o] === 1 : ALPHABETIC.test(c); };
const cp = (c: string) => c.codePointAt(0)!;
const first = (s: string) => String.fromCodePoint(s.codePointAt(0)!);
function last(s: string): string {
	const low = s.charCodeAt(s.length - 1);
	return low >= 0xDC00 && low <= 0xDFFF && s.length > 1 ? s.slice(-2) : s.slice(-1);
}

function lower(text: string): string {
	let out = "";
	for (const c of text) out += c === UNCASED ? c : NEW_CASE_PAIRS[c] ?? c.toLowerCase();
	return out;
}
function isUpper(c: string): boolean {
	if (c === UNCASED) return false;
	return c in NEW_CASE_PAIRS || (UPPERCASE.test(c) && lower(c) !== c);
}
const isLower = (c: string) => NEW_LOWER.has(c) || LOWERCASE.test(c);
function spanIsUpper(text: string): boolean {
	let cased = false;
	for (const c of text) {
		if (isUpper(c)) cased = true;
		else if (isLower(c)) return false;
	}
	return cased;
}

/**
 * Canonically equivalent text whose long runs of nonzero classes are already in canonical order:
 * each character decomposed, each run stable-sorted by class. NFC of it equals NFC of the input.
 */
function canonicalOrder(text: string): string {
	let run = 0, long = false;
	for (const c of text) {
		const o = cp(c);
		if (!CCC.has(o) && !LEADING_NONSTARTERS.has(o)) run = 0;
		else if (++run > LONG_RUN) { long = true; break; }
	}
	if (!long) return text;
	const out: string[] = [];
	let marks: { c: string; ccc: number }[] = [];
	const flush = () => { for (const mark of marks.sort((x, y) => x.ccc - y.ccc)) out.push(mark.c); marks = []; };
	for (const c of text) for (const d of c.normalize("NFD")) {
		const ccc = CCC.get(cp(d));
		if (ccc) marks.push({ c: d, ccc });
		else { flush(); out.push(d); }
	}
	flush();
	return out.join("");
}

function nfc(text: string, foldQuotes: boolean): string {
	text = canonicalOrder(text.replace(LONE_SURROGATE, "\uFFFD")).normalize("NFC").replace(STRIP_CONTROL, "").replaceAll("\0", " ");
	// Claude composes decomposed Thai SARA AM.
	text = text.replaceAll("\u0E4D\u0E32", "\u0E33").replace(STRIP_PRIVATE, "");
	if (foldQuotes) text = text.replace(QUOTE_FOLD, (q) => QUOTE_ASCII[q]!);
	return text.replace(FUNNY_SPACE, " ");
}

function isHardCp(o: number): boolean {
	return o >= 0x10000 || (o >= 0x4E00 && o <= 0x9FFF) || (o >= 0x3400 && o <= 0x4DBF) || (o >= 0xF900 && o <= 0xFAFF) || (o >= 0xAC00 && o <= 0xD7A3)
		|| [0x3005, 0x3006, 0x3031, 0x3032, 0x3033, 0x3034, 0x3035, 0x303B, 0x303C].includes(o);
}
function classify(c: string): RunClass {
	if (TURN_GLYPHS.has(c)) return TURN;
	if (NEW_CASED.has(c)) return WORDY;
	const o = cp(c), cat = category(c);
	if (cat[0] === "Z" || "\t\n\r\f\v".includes(c)) return SPACE;
	if (SYMBOL_LETTERS.some(([lo, hi]) => lo <= o && o <= hi)) return WORDY;
	if (cat === "Nd" && (o < 0x80 || (o >= 0x0660 && o <= 0x0669) || (o >= 0x06F0 && o <= 0x06F9))) return DIGIT;
	if (o < 0x80 && (cat[0] === "P" || cat[0] === "S")) return PUNCT;
	if (PUNCT_SYMS.has(c)) return PUNCT;
	if (o >= 0xFE00 && o <= 0xFE0F) return HARD;
	if (isMark(c)) return o < 0x10000 && isAlphabetic(c) ? WORDY : HARD;
	if (cat[0] === "L" && !isHardCp(o)) return WORDY;
	return HARD;
}

function markCase(span: string, allcapsMin: number | null, headMark: boolean): string {
	if (headMark) return span;
	const chars = Array.from(span);
	const head = chars[0]!, tail = chars.slice(1);
	if (span.includes("İ") || span.includes("ẞ")) {
		const keep = (c: string) => c === "İ" || c === "ẞ";
		if (isUpper(head) && !keep(head) && !tail.some((c) => !keep(c) && isUpper(c))) return SHIFT + lower(head) + tail.map((c) => keep(c) ? c : lower(c)).join("");
		return span;
	}
	const unlowerable = chars.some((c) => (NEW_CASED.has(c) || "LM".includes(category(c)[0]!)) && !isLower(c) && (!isUpper(c) || lower(c) === c));
	if (allcapsMin !== null && spanIsUpper(span) && chars.length >= allcapsMin && !unlowerable) return CAPS + lower(span).replaceAll("ς", "σ");
	if (lower(head) === head) return span;
	if (isUpper(head) && !tail.some(isUpper)) return SHIFT + lower(span);
	return span;
}
undefined
const isSelector = (ch: string) => { const o = cp(ch); return o >= 0xFE00 && o <= 0xFE0F; };
const hardBow = (body: string) => body !== "" && (isSelector(first(body)) || marksLikePunct(first(body)) || digitBorder(first(body)));
const hardEow = (body: string) => body !== "" && (isSelector(last(body)) || marksLikePunct(last(body)) || digitBorder(last(body)));
const opensWord = (runs: readonly Run[], i: number) => runs[i]!.body === "'" && i + 1 < runs.length && (runs[i + 1]!.cls === WORDY || runs[i + 1]!.cls === STRAY);
const takesRightBorder = (run: Run) => run.cls === PUNCT || hardEow(run.body);
function contractionSeam(runs: readonly Run[], i: number): boolean {
	if (!CONTRACTION_SUFFIXES.has(runs[i]!.body) || i === 0) return false;
	const prev = runs[i - 1]!;
	if (prev.cls !== PUNCT || prev.body !== "'") return false;
	return i < 2 || !takesRightBorder(runs[i - 2]!);
}
function digitBorder(ch: string): boolean {
	const cat = category(ch);
	return (cat === "No" || (cat === "Nd" && cp(ch) >= 0x80)) && cp(ch) < 0x10000;
}
const isSeparator = (c: string) => cp(c) < 0x10000 && isMark(c) && !isSelector(c) && !isAlphabetic(c);
const syriacVowel = (c: string) => { const o = cp(c); return o === 0x0711 || (o >= 0x0730 && o <= 0x073F); };
const strayMark = (c: string) => !syriacVowel(c) && CCC.has(cp(c)) && !isSeparator(c);

function runsOf(norm: string): Run[] {
	const out: Run[] = [];
	let cur = "", curCls: RunClass = HARD;
	for (const ch of norm) {
		const c = classify(ch);
		if (!cur) { cur = ch; curCls = c === WORDY && strayMark(ch) ? STRAY : c; }
		else if (curCls === STRAY && c === WORDY && strayMark(ch)) cur += ch;
		else if (c === curCls) cur += ch;
		else if (c === WORDY && strayMark(ch) && curCls !== WORDY) {
			out.push({ cls: curCls, body: cur });
			cur = ch; curCls = STRAY;
		} else {
			out.push({ cls: curCls, body: cur });
			cur = ch; curCls = c;
		}
	}
	if (cur) out.push({ cls: curCls, body: cur });
	const split: Run[] = [];
	for (let { cls, body } of out) {
		if (cls === TURN) { cls = PUNCT; body += ":"; }
		if (cls !== HARD || body === first(body)) { split.push({ cls, body }); continue; }
		let piece = "", kind = "";
		for (const ch of body) {
			if (!piece) { piece = ch; kind = hardKind(ch); }
			else if (isSelector(ch) || hardKind(ch) === kind) piece += ch;
			else { split.push({ cls, body: piece }); piece = ch; kind = hardKind(ch); }
		}
		split.push({ cls, body: piece });
	}
	return split;
}
const hardKind = (ch: string) => marksLikePunct(ch) ? "punct" : digitBorder(ch) ? "number" : "letter";
function marksLikePunct(ch: string): boolean {
	ch = LITERAL_OF.get(ch) ?? ch;
	const o = cp(ch);
	if (o >= 0x10000 || NEW_CASED.has(ch)) return false;
	if (o >= 0xD7A4 && o <= 0xD7AF) return false;
	const cat = category(ch);
	const ideographicPunct = o >= 0x3001 && o <= 0x303F && (cat[0] === "P" || cat[0] === "M" || IDEOGRAPHIC_SYMBOLS.has(ch));
	return !ideographicPunct && (isSeparator(ch) || cat[0] === "P" || cat[0] === "S" || cat === "Cf" || cat === "Cn");
}

// ---- families and vocabularies (ctok main.py, engine.py) ----

/** The reconstructed tokenizer generations: v3 is Claude 3 to Opus 4.6, v4.7 is Opus 4.7, v4.8 is Opus 4.8 and later. */
export const CTOK_FAMILIES = Object.freeze(["v3", "v4.7", "v4.8"] as const);
export type CtokFamily = typeof CTOK_FAMILIES[number];

interface FamilySpec {
	/** The vocabulary file under vendor/ctok/; v4.8 reads v4.7's. */
	readonly file: string;
	/** ctok's measured overrides on that file's meta. */
	readonly frame?: { readonly message_overhead: number; readonly frame_bow: boolean; readonly turn_markers: boolean };
}
const FAMILIES: Readonly<Record<CtokFamily, FamilySpec>> = {
	"v3": { file: "pieces_v3.json" },
	"v4.7": { file: "pieces_v4_7.json" },
	"v4.8": { file: "pieces_v4_7.json", frame: { message_overhead: 6, frame_bow: false, turn_markers: false } },
};

/** ctok's version routing: [3.0, 4.7) is v3, [4.7, 4.8) is v4.7, 4.8 and later is v4.8; older Claude has no family. */
export function ctokFamily(major: number, minor: number): CtokFamily | undefined {
	const at = (m: number, n: number) => major > m || (major === m && minor >= n);
	return at(4, 8) ? "v4.8" : at(4, 7) ? "v4.7" : at(3, 0) ? "v3" : undefined;
}

/**
 * The tokens text costs as a single user message, without the message frame (ctok's
 * token_count minus message_overhead). The first count of a family loads its vocabulary.
 */
export function ctokContentTokens(text: string, family: CtokFamily): number {
	return model(family).content(text);
}

/** The measured single-message frame of a family, which ctokContentTokens leaves out. */
export function ctokMessageOverhead(family: CtokFamily): number {
	return model(family).messageOverhead;
}

interface VocabularyFile {
	readonly meta: { readonly message_overhead: number; readonly fold_quotes: boolean; readonly allcaps_min: number | null };
	/** Pieces in ctok's public notation, by provenance group, each with its witness record. */
	readonly tokens: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}
interface TrieNode { end: boolean; readonly next: Map<number, TrieNode> }

/** One vocabulary file, indexed for the tiling: shared by the families that read it. */
class Vocabulary {
	readonly meta: VocabularyFile["meta"];
	/** The tiling vocabulary stored backwards, since the tiling ends a piece at each position and scans its start leftwards. */
	readonly root: TrieNode = { end: false, next: new Map() };
	private readonly unitPieces = new Set<string>();
	/** Hex UTF-8 prefixes of one codepoint that are tokens. */
	private readonly byteTokens = new Set<string>();

	constructor(file: VocabularyFile) {
		this.meta = file.meta;
		const vocab = new Set<string>();
		for (const [group, pieces] of Object.entries(file.tokens)) {
			if (group === "bytes_fallback") continue;
			for (const piece of Object.keys(pieces)) {
				const parsed = parseMarked(piece);
				vocab.add(parsed);
				if (Array.from(parsed).length === 1 && !MARKERS.has(parsed)) this.unitPieces.add(parsed);
			}
		}
		// The file stores 't, the stream writes 't⟨eow⟩.
		for (const contraction of Object.keys(file.tokens.contractions ?? {})) vocab.add(contraction + EOW);
		for (const prefix of Object.keys(file.tokens.bytes_fallback ?? {})) this.byteTokens.add(prefix);
		for (const c of this.unitPieces) this.byteTokens.add(hex(utf8(c)));
		for (const piece of vocab) {
			let node = this.root;
			const chars = Array.from(piece);
			for (let i = chars.length - 1; i >= 0; i--) {
				const o = cp(chars[i]!);
				let child = node.next.get(o);
				if (!child) node.next.set(o, child = { end: false, next: new Map() });
				node = child;
			}
			node.end = true;
		}
	}

	/** One codepoint no piece covers: 1 for a unit piece, else its longest UTF-8 prefix token plus one per remaining byte. */
	charCost(ch: string): number {
		ch = LITERAL_OF.get(ch) ?? ch;
		if (this.unitPieces.has(ch)) return 1;
		const bytes = utf8(ch);
		let end = 0;
		for (let i = 1; i <= bytes.length; i++) if (this.byteTokens.has(hex(bytes.subarray(0, i)))) end = i;
		return (end ? 1 : 0) + bytes.length - end;
	}

	/** Minimum-cost tiling over cost-1 pieces plus a one-codepoint floor (ctok min_vocab_tile, cost only). */
	tile(text: Uint32Array, floor: (at: number) => number): number {
		const best = new Float64Array(text.length + 1).fill(Infinity);
		best[text.length] = 0;
		for (let end = text.length; end > 0; end--) {
			const suffix = best[end]!;
			let node = this.root.next.get(text[end - 1]!);
			const single = suffix + (node?.end ? 1 : floor(end - 1));
			if (single < best[end - 1]!) best[end - 1] = single;
			for (let start = end - 2; node && start >= 0; start--) {
				node = node.next.get(text[start]!);
				if (node?.end && suffix + 1 < best[start]!) best[start] = suffix + 1;
			}
		}
		return best[0]!;
	}
}

/** A family: a vocabulary with the frame scalars the encoder reads. */
class FamilyModel {
	readonly messageOverhead: number;
	private readonly foldQuotes: boolean;
	private readonly allcapsMin: number | null;
	/** Whether the frame ends in a ⟨bow⟩ that absorbs one leading space. */
	private readonly frameBow: boolean;
	private readonly turnMarkers: boolean;
	private readonly vocabulary: Vocabulary;

	constructor(vocabulary: Vocabulary, frame: FamilySpec["frame"]) {
		this.vocabulary = vocabulary;
		this.messageOverhead = frame?.message_overhead ?? vocabulary.meta.message_overhead;
		this.foldQuotes = vocabulary.meta.fold_quotes;
		this.allcapsMin = vocabulary.meta.allcaps_min;
		this.frameBow = frame?.frame_bow ?? true;
		this.turnMarkers = frame?.turn_markers ?? true;
	}

	content(text: string): number {
		const norm = this.prepare(text);
		// The frame appends two newlines after the content, and a content-final newline run tiles into them.
		let end = norm.length;
		while (end > 0 && norm.charCodeAt(end - 1) === 10) end--;
		const tail = norm.length - end;
		const tailCost = tail ? this.vocabulary.tile(new Uint32Array(tail + 2).fill(10), () => 1) - 1 : 0;
		const stream = codePoints(this.stream(norm.slice(0, end), text.startsWith(" ")));
		if (!stream.length) return tailCost;
		return this.vocabulary.tile(stream, (at) => MARKER_CPS.has(stream[at]!) ? 1 : this.vocabulary.charCost(String.fromCodePoint(stream[at]!))) + tailCost;
	}

	/** Reserved strings are recognized in raw text, then the rest is normalized and literal marker codepoints escaped. */
	private prepare(text: string): string {
		text = text.replace(NAMESPACE_RE, "$1");
		const parts = this.turnMarkers ? text.split(TURN_RE) : [text];
		return parts.map((part, i) => i % 2 ? (part.toLowerCase() === "human" ? HUMAN : ASSISTANT)
			: nfc(part, this.foldQuotes).replace(LITERAL_GLYPH_RE, (glyph) => ESCAPE_OF.get(glyph)!)).join("");
	}

	/** Normalized text without its content-final newline run to the marked stream the tiling covers (ctok stream_norm). */
	private stream(norm: string, rawHeadSpace: boolean): string {
		// A frame ending in ⟨bow⟩ stands for one raw leading space; two or more stay a whitespace run.
		if (this.frameBow && rawHeadSpace && norm[0] === " " && norm[1] !== " ") norm = norm.slice(1);
		const runs = runsOf(norm);
		if (!runs.length) return this.frameBow ? BOW : "";
		const n = runs.length;
		/** Whether a side of run i touches a space; the message start counts as one where the frame ends in ⟨bow⟩. */
		const bordersSpace = (i: number, side: -1 | 1): boolean => {
			const j = i + side;
			if (j < 0) return this.frameBow;
			if (j >= n || runs[j]!.cls !== SPACE) return false;
			const body = runs[j]!.body;
			if (side < 0) return body.endsWith(" ");
			return body[0] === " " && !body.startsWith("  ");
		};
		const head = runs[0]!;
		const headQuote = opensWord(runs, 0);
		const hasOwnBow = !headQuote && (head.cls === WORDY || head.cls === PUNCT || head.cls === STRAY || hardBow(head.body) || (head.cls === SPACE && head.body[0] === " "));
		const out: string[] = hasOwnBow || !this.frameBow ? [] : [headQuote ? " " : BOW];
		runs.forEach(({ cls, body }, i) => {
			if (cls === WORDY) {
				const fused = i > 0 && runs[i - 1]!.cls === STRAY;
				let marked = markCase(body, this.allcapsMin, fused), pre = "";
				while (marked[0] === SHIFT || marked[0] === CAPS) { pre += marked[0]; marked = marked.slice(1); }
				out.push(pre + (fused || contractionSeam(runs, i) ? "" : BOW) + marked + EOW);
			} else if (cls === STRAY) {
				out.push(BOW + body + (i + 1 < n && runs[i + 1]!.cls === WORDY ? "" : EOW));
			} else if (cls === PUNCT || hardBow(body) || hardEow(body)) {
				const takesBow = bordersSpace(i, -1) && !opensWord(runs, i) && (cls === PUNCT || hardBow(body));
				out.push((takesBow ? BOW : "") + body + (bordersSpace(i, 1) && (cls === PUNCT || hardEow(body)) ? EOW : ""));
			} else out.push(body);
		});
		return out.join("").replace(SEAM_RE, "$1" + EOW + "$2" + BOW);
	}
}

const vocabularies = new Map<string, Vocabulary>();
const models = new Map<CtokFamily, FamilyModel>();
function model(family: CtokFamily): FamilyModel {
	let found = models.get(family);
	if (!found) {
		const spec = FAMILIES[family];
		let vocabulary = vocabularies.get(spec.file);
		if (!vocabulary) {
			const path = fileURLToPath(new URL("../vendor/ctok/" + spec.file, import.meta.url));
			vocabularies.set(spec.file, vocabulary = new Vocabulary(JSON.parse(readFileSync(path, "utf8")) as VocabularyFile));
		}
		models.set(family, found = new FamilyModel(vocabulary, spec.frame));
	}
	return found;
}

/** The codepoints of a string, without an array of one-character strings. */
function codePoints(s: string): Uint32Array {
	const out = new Uint32Array(s.length);
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		const o = s.codePointAt(i)!;
		out[n++] = o;
		if (o > 0xFFFF) i++;
	}
	return out.subarray(0, n);
}

const encoder = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
const utf8 = (s: string) => encoder.encode(s);
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const ATOM_RE = /⟨(?:bow|eow|shift|caps|pad|human|assistant|0x[0-9A-Fa-f]{2})⟩|./gsu;
/** A vocabulary key in ctok's public notation to the stream's glyph form (ctok notation.parse_marked). */
function parseMarked(publicForm: string): string {
	let out = "";
	const bytes: number[] = [];
	const flush = () => { if (bytes.length) { out += decoder.decode(Uint8Array.from(bytes)); bytes.length = 0; } };
	for (const [atom] of publicForm.matchAll(ATOM_RE)) {
		if (atom.length > 1 && atom.startsWith("⟨0x")) { bytes.push(parseInt(atom.slice(3, 5), 16)); continue; }
		flush();
		out += ATOM_TO_GLYPH[atom] ?? atom;
	}
	flush();
	return out;
}
