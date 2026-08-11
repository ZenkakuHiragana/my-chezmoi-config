import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const PI_SKILLS_PROMPT_SECTION =
  /\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?\n<\/available_skills>/g;

const SKILL_DESCRIPTION_INTRO = [
  "スキルの全文を名前で読み込む。",
  "スキルは、特定の作業向けの指示、補助スクリプト、参照資料などをまとめた自己完結型の能力単位。",
  "作業がスキルの説明に一致するときにこのツールを使う。スキルを使う前に全文を読み、結果に含まれるスキルディレクトリのパスを基準に相対パスを解決する。",
].join("\n");

type SkillToolDetails = { skillRoot: string };

function getModelInvocableSkills(skills: Skill[]): Skill[] {
  return skills.filter((skill) => !skill.disableModelInvocation);
}

function formatSkillDescription(skills: Skill[]): string {
  const catalog = skills.length
    ? skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")
    : "（利用可能なスキルなし）";

  return `${SKILL_DESCRIPTION_INTRO}\n\n利用可能なスキル:\n${catalog}`;
}

function formatSkillRoot(baseDir: string): string {
  const absolutePath = resolve(baseDir);
  const relativePath = relative(resolve(homedir()), absolutePath);
  const isWithinHome =
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath));
  if (isWithinHome) {
    const normalizedRelativePath = relativePath.split(sep).join("/");
    return normalizedRelativePath ? `~/${normalizedRelativePath}` : "~";
  }
  return absolutePath.split(sep).join("/");
}

function removePiSkillsPromptSection(systemPrompt: string): string {
  return systemPrompt.replace(PI_SKILLS_PROMPT_SECTION, "");
}

export default function (pi: ExtensionAPI) {
  let availableSkills: Skill[] = [];

  const registerSkillTool = (skills: Skill[]) => {
    availableSkills = getModelInvocableSkills(skills);

    pi.registerTool({
      name: "skill",
      label: "Skill",
      description: formatSkillDescription(availableSkills),
      parameters: Type.Object({
        skill: Type.String({ description: "スキル名" }),
      }),
      renderResult(result, { expanded, isPartial }, theme, context) {
        if (isPartial) {
          return new Text(theme.fg("muted", "読み込み中…"), 0, 0);
        }

        const details = result.details as SkillToolDetails | undefined;
        const content = result.content
          .map((item) => (item.type === "text" ? item.text : ""))
          .filter(Boolean)
          .join("\n");
        if (context.isError) {
          const errorText = content || `スキルの取得に失敗しました: ${context.args.skill}`;
          return new Text(theme.fg("error", errorText), 0, 0);
        }
        const rootPrefixMatch = content.match(/^スキルディレクトリ: (.+)\n\n/);
        const skillRoot = details?.skillRoot ?? rootPrefixMatch?.[1] ?? "（スキルルート不明）";
        const header = [
          theme.fg("toolTitle", theme.bold(`スキル: ${context.args.skill}`)),
          theme.fg("muted", `スキルディレクトリ: ${skillRoot}`),
        ].join("\n");

        if (!expanded) {
          return new Text(header, 0, 0);
        }

        const skillContent = rootPrefixMatch ? content.slice(rootPrefixMatch[0].length) : content;
        return new Text(`${header}\n\n${skillContent}`, 0, 0);
      },
      async execute(_toolCallId, params) {
        const selectedSkill = availableSkills.find((skill) => skill.name === params.skill);
        if (!selectedSkill) {
          throw new Error(`存在しないスキル名: ${params.skill}`);
        }

        const content = await readFile(selectedSkill.filePath, "utf8");
        const skillRoot = formatSkillRoot(selectedSkill.baseDir);
        return {
          content: [{ type: "text", text: `スキルディレクトリ: ${skillRoot}\n\n${content}` }],
          details: { skillRoot } satisfies SkillToolDetails,
        };
      },
    });
  };

  registerSkillTool([]);

  pi.on("before_agent_start", (event) => {
    registerSkillTool(event.systemPromptOptions.skills ?? []);
    return { systemPrompt: removePiSkillsPromptSection(event.systemPrompt) };
  });
}
