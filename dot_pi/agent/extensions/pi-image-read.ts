/**
 * pi-image-read: show an image file to the model.
 *
 * The image half of Pi's read tool, so that read itself is not needed: text is read with
 * bash. The path names the file the bash tool would open. On Windows the bash in use resolves
 * it, so "/tmp/x.png" and "~/x.png" are the files bash sees and not C:/tmp/x.png.
 */
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import {
  createReadToolDefinition,
  detectSupportedImageMimeTypeFromFile,
  type ExtensionAPI,
  getShellConfig,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const parameters = Type.Object({
  path: Type.String({ description: "画像ファイルのパス。bash で使うのと同じ書き方でよい" }),
});

/** Asks the bash in use where a path is: its HOME for "~" and its own mounts, as a Windows path. */
const RESOLVE = 'p=$PI_IMAGE_READ_PATH; case $p in "~") p=$HOME ;; "~/"*) p=$HOME/${p#"~/"} ;; esac; /usr/bin/cygpath -wa -- "$p"';

/** The file the bash tool would open for this path, with the same shell and command prefix. */
function fileOf(path: string, cwd: string, shellPath: string | undefined, prefix: string | undefined): string {
  if (process.platform !== "win32") {
    // Not normalized here: "link/../x" is resolved by the system, as for bash.
    if (path === "~") return homedir();
    if (path.startsWith("~/")) return `${homedir()}/${path.slice(2)}`;
    return isAbsolute(path) ? path : `${cwd}/${path}`;
  }
  const shell = getShellConfig(shellPath);
  // Pi passes commands to the legacy WSL bash on stdin; its paths are not Windows paths.
  if (shell.commandTransport === "stdin") throw new Error(`Cannot resolve ${path} as ${shell.shell} does`);
  const result = spawnSync(shell.shell, ["-c", prefix ? `${prefix}\n${RESOLVE}` : RESOLVE], {
    cwd,
    env: { ...process.env, PI_IMAGE_READ_PATH: path },
    encoding: "utf8",
    windowsHide: true,
  });
  // Only the line end: a file name may end in a space.
  const resolved = result.status === 0 ? result.stdout.replace(/\r?\n$/, "") : "";
  if (!resolved) throw new Error(`Could not resolve ${path} as bash does: ${result.stderr || result.error?.message || "no output"}`);
  return resolved;
}

export default function piImageRead(pi: ExtensionAPI): void {
  const read = createReadToolDefinition(process.cwd());
  pi.registerTool({
    ...read,
    name: "image_read",
    label: "image_read",
    description:
      "画像ファイル（jpg、png、gif、webp、bmp）を読み込んで見る。画像以外のファイルはエラーになる。codemode では画像のブロックを返すので image() で表示する。",
    promptSnippet: "View an image file (jpg, png, gif, webp, bmp)",
    promptGuidelines: [],
    parameters,
    async execute(toolCallId, { path }, signal, onUpdate, ctx) {
      const settings = SettingsManager.inMemory(pi.getSettings());
      const file = fileOf(path, ctx?.cwd || process.cwd(), settings.getShellPath(), settings.getShellCommandPrefix());
      // Decided before reading, from the file itself, so a text file is never read.
      const mimeType = await detectSupportedImageMimeTypeFromFile(file);
      if (!mimeType) throw new Error(`Not an image file: ${path}`);
      // Pi's read rewrites paths (a leading "@", Unicode spaces); these operations open this file only.
      const tool = createReadToolDefinition(process.cwd(), {
        autoResizeImages: settings.getImageAutoResize(),
        operations: {
          access: () => access(file, constants.R_OK),
          readFile: () => readFile(file),
          detectImageMimeType: async () => mimeType,
        },
      });
      return tool.execute(toolCallId, { path: file }, signal, onUpdate, ctx);
    },
  });
}
