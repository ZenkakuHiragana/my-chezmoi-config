import { readFile } from "node:fs/promises";
import type { ExtensionAPI, Skill } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const PI_SKILLS_PROMPT_SECTION =
  /\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?\n<\/available_skills>/g;

const SKILL_DESCRIPTION_INTRO = [
  "スキルの全文を名前で読み込む。",
  "スキルは、特定の作業向けの指示、補助スクリプト、参照資料などをまとめた自己完結型の能力単位。",
  "作業がスキルの説明に一致するときにこのツールを使う。スキルを使う前に全文を読み、相対パスはスキルディレクトリ（SKILL.mdの親）を基準に解決する。",
].join("\n");

function getModelInvocableSkills(skills: Skill[]): Skill[] {
  return skills.filter((skill) => !skill.disableModelInvocation);
}

function formatSkillDescription(skills: Skill[]): string {
  const catalog = skills.length
    ? skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")
    : "（利用可能なスキルなし）";

  return `${SKILL_DESCRIPTION_INTRO}\n\n利用可能なスキル:\n${catalog}`;
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
      async execute(_toolCallId, params) {
        const selectedSkill = availableSkills.find((skill) => skill.name === params.skill);
        if (!selectedSkill) {
          throw new Error(`存在しないスキル名: ${params.skill}`);
        }

        const content = await readFile(selectedSkill.filePath, "utf8");
        return { content: [{ type: "text", text: content }], details: {} };
      },
    });
  };

  registerSkillTool([]);

  pi.on("before_agent_start", (event) => {
    registerSkillTool(event.systemPromptOptions.skills ?? []);
    return { systemPrompt: removePiSkillsPromptSection(event.systemPrompt) };
  });
}
