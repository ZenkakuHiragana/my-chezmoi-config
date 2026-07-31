import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 実行時は dist/src/guides.js なので、パッケージ直下の guides/ を2階層上から解決する。
const guideDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "guides",
);

const SERVER_INSTRUCTIONS_FILE = "server-instructions.md";

export class GuideError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GuideError";
  }
}

export type GuideResource = {
  uri: string;
  name: string;
  title: string;
  description: string;
  fileName: string;
};

export const GUIDE_RESOURCES: readonly GuideResource[] = [
  {
    uri: "skill-kb://guide/source-registration",
    name: "source-registration-guide",
    title: "情報源の登録規則",
    description:
      "KNOWLEDGE.yml へ情報源を登録、変更、削除するときの規則。設定ファイルの場所、併合規則、description と instructions の書き方、パス制約、反映に必要な再起動条件を含む。情報源の設定を書き換える前に読む。",
    fileName: "source-registration.md",
  },
];

export async function readGuide(fileName: string): Promise<string> {
  const filePath = path.join(guideDirectory, fileName);
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new GuideError(`Cannot read bundled guide: ${filePath}`, {
      cause: error,
    });
  }
}

export async function buildServerInstructions(): Promise<string> {
  const overview = (await readGuide(SERVER_INSTRUCTIONS_FILE)).trimEnd();
  return `${overview}\n`;
}

export { SERVER_INSTRUCTIONS_FILE, guideDirectory };
