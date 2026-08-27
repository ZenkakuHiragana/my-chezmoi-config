import { randomUUID } from "node:crypto";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
const SUBAGENT_DELEGATION_REQUEST_EVENT = "prompt-template:subagent:request";
const SUBAGENT_DELEGATION_RESPONSE_EVENT = "prompt-template:subagent:response";
const SUBAGENT_DELEGATION_CANCEL_EVENT = "prompt-template:subagent:cancel";

interface SubagentDelegationRequest {
  requestId: string;
  ownerRunId: string;
  nodeId: string;
  agent: string;
  task: string;
  context: "fresh" | "fork";
  cwd: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  timeoutMs?: number;
  turnBudget?: { maxTurns: number; graceTurns?: number };
  toolBudget?: { soft?: number; hard: number; block?: string[] | "*" };
  result: { kind: "structured"; schema: Record<string, unknown> };
}

interface SubagentDelegationResponse {
  requestId: string;
  ownerRunId?: string;
  nodeId?: string;
  status: string;
  error?: string;
  result?: { kind: "structured" | "text"; value?: unknown; text?: string };
}

const CHILD_ENV = "PI_SUBAGENT_CHILD";
const SCOUT_AGENT = "context-scout";
const FIRST_TURN_TIMEOUT_MS = 30_000;
const LATER_TURN_TIMEOUT_MS = 16_000;
const TURN_BUDGET = { maxTurns: 8, graceTurns: 1666666 } as const;
const TOOL_BUDGET = {
  soft: 8,
  hard: 16,
  block: ["read", "grep", "find", "ls", "mcp"],
} as const;
const MAX_RENDERED_TEXT_LENGTH = 800;

const SCOUT_REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["STATUS", "SEARCHED", "FINDINGS", "GAPS"],
  properties: {
    STATUS: {
      type: "string",
      enum: ["complete", "partial", "failed"],
    },
    SEARCHED: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "locators"],
        properties: {
          source: { type: "string", minLength: 1, maxLength: 200 },
          locators: {
            type: "array",
            maxItems: 12,
            items: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    FINDINGS: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "statement", "locator"],
        properties: {
          source: { type: "string", minLength: 1, maxLength: 200 },
          statement: { type: "string", minLength: 1, maxLength: 1000 },
          locator: { type: "string", minLength: 1, maxLength: 500 },
        },
      },
    },
    GAPS: {
      type: "array",
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
  },
} as const;

type ScoutReport = {
  STATUS: "complete" | "partial" | "failed";
  SEARCHED: Array<{ source: string; locators: string[] }>;
  FINDINGS: Array<{ source: string; statement: string; locator: string }>;
  GAPS: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } =>
      isRecord(part) && part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function textFromMessage(message: AgentMessage): string {
  if (message.role !== "user" && message.role !== "assistant") return "";
  return textFromContent(message.content);
}

function previousConversation(ctx: ExtensionContext): { recentUser?: string; previousAssistant?: string } {
  const entries = ctx.sessionManager.getBranch();
  let previousAssistant: string | undefined;
  let recentUser: string | undefined;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.type !== "message") continue;
    const message = entry.message;
    const text = textFromMessage(message);
    if (!text) continue;
    if (!previousAssistant && message.role === "assistant") previousAssistant = text;
    if (!recentUser && message.role === "user") recentUser = text;
    if (recentUser && previousAssistant) break;
  }
  return { recentUser, previousAssistant };
}

function priorUserTurnCount(ctx: ExtensionContext): number {
  let count = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    if (textFromMessage(entry.message)) count += 1;
  }
  return count;
}

function bounded(value: string, maxLength = MAX_RENDERED_TEXT_LENGTH): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildScoutTask(event: BeforeAgentStartEvent, ctx: ExtensionContext): string {
  const { recentUser, previousAssistant } = previousConversation(ctx);
  const sections = [
    "SCOUT_INPUT",
    "CURRENT_USER:\n<<<\n" + event.prompt + "\n>>>",
  ];
  if (recentUser) sections.push("RECENT_USER:\n<<<\n" + recentUser + "\n>>>");
  if (previousAssistant) sections.push("PREVIOUS_ASSISTANT:\n<<<\n" + previousAssistant + "\n>>>");
  return sections.join("\n\n");
}

const DELEGATION_STATUSES = new Set([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "interrupted",
  "turn_budget_exhausted",
  "tool_budget_exhausted",
  "structured_output_failed",
  "acceptance_failed",
  "invalid_request",
  "unavailable_context",
  "duplicate_node",
]);

function isMatchingResponse(
  value: unknown,
  request: Pick<SubagentDelegationRequest, "requestId" | "ownerRunId" | "nodeId">,
): value is SubagentDelegationResponse {
  if (!isRecord(value) || value.requestId !== request.requestId) return false;
  if (value.status === "invalid_request") {
    return (value.ownerRunId === undefined || value.ownerRunId === request.ownerRunId)
      && (value.nodeId === undefined || value.nodeId === request.nodeId);
  }
  return value.ownerRunId === request.ownerRunId
    && value.nodeId === request.nodeId
    && typeof value.status === "string"
    && DELEGATION_STATUSES.has(value.status);
}

function waitForDelegation(
  pi: ExtensionAPI,
  request: SubagentDelegationRequest,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<SubagentDelegationResponse> {
  return new Promise((resolve) => {
    let settled = false;
    const unsubscribe = pi.events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (data) => {
      if (!isMatchingResponse(data, request)) return;
      finish(data);
    });
    const timer = setTimeout(() => {
      pi.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, {
        requestId: request.requestId,
        ownerRunId: request.ownerRunId,
        nodeId: request.nodeId,
      });
      finish({
        requestId: request.requestId,
        ownerRunId: request.ownerRunId,
        nodeId: request.nodeId,
        status: "timed_out",
        error: `context-scoutが${timeoutMs}msのhard timeoutを超えた`,
      });
    }, timeoutMs);
    const onAbort = () => {
      pi.events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, {
        requestId: request.requestId,
        ownerRunId: request.ownerRunId,
        nodeId: request.nodeId,
      });
      finish({
        requestId: request.requestId,
        ownerRunId: request.ownerRunId,
        nodeId: request.nodeId,
        status: "cancelled",
        error: "親の処理によりcontext-scoutを中止した",
      });
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    function finish(response: SubagentDelegationResponse): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener("abort", onAbort);
      resolve(response);
    }

    pi.events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
  });
}

function parseScoutReport(value: unknown): ScoutReport | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.STATUS;
  if (status !== "complete" && status !== "partial" && status !== "failed") return undefined;
  if (!Array.isArray(value.SEARCHED) || !Array.isArray(value.FINDINGS) || !Array.isArray(value.GAPS)) return undefined;

  const searched: ScoutReport["SEARCHED"] = [];
  for (const item of value.SEARCHED) {
    if (!isRecord(item) || typeof item.source !== "string" || !Array.isArray(item.locators)) return undefined;
    if (!item.locators.every((locator) => typeof locator === "string" && locator.trim().length > 0)) return undefined;
    searched.push({ source: item.source, locators: item.locators });
  }
  const findings: ScoutReport["FINDINGS"] = [];
  for (const item of value.FINDINGS) {
    if (
      !isRecord(item)
      || typeof item.source !== "string"
      || typeof item.statement !== "string"
      || typeof item.locator !== "string"
      || !item.source.trim()
      || !item.statement.trim()
      || !item.locator.trim()
    ) return undefined;
    findings.push({ source: item.source, statement: item.statement, locator: item.locator });
  }
  if (!value.GAPS.every((gap) => typeof gap === "string" && gap.trim().length > 0)) return undefined;
  return { STATUS: status, SEARCHED: searched, FINDINGS: findings, GAPS: value.GAPS };
}

function failureSupplement(response: SubagentDelegationResponse, reason: string): string {
  const error = response.error ? `: ${bounded(response.error, 240)}` : "";
  return [
    "STATUS: 終端=" + response.status + "; 受領=" + reason,
    "SEARCHED:",
    "- なし",
    "FINDINGS:",
    "- なし",
    "GAPS:",
    "- context-scoutの" + reason + error,
  ].join("\n");
}

function renderSupplement(response: SubagentDelegationResponse): string {
  const report = response.result?.kind === "structured" ? parseScoutReport(response.result.value) : undefined;
  if (!report) {
    const reason = response.result ? "構造化結果が不正" : "結果なし";
    return failureSupplement(response, reason);
  }

  const searched = report.SEARCHED.length > 0
    ? report.SEARCHED.flatMap((item) => item.locators.length > 0
      ? item.locators.map((locator) => `- ${bounded(item.source, 160)}: ${bounded(locator, 500)}`)
      : [`- ${bounded(item.source, 160)}: locatorなし`])
    : ["- なし"];
  const findings = report.FINDINGS.length > 0
    ? report.FINDINGS.map((item) => `- ${bounded(item.source, 160)} | ${bounded(item.locator, 500)} | ${bounded(item.statement)}`)
    : ["- なし"];
  const gaps = report.GAPS.length > 0 ? report.GAPS.map((gap) => `- ${bounded(gap, 500)}`) : ["- なし"];
  return [
    `STATUS: 終端=${response.status}; 報告=${report.STATUS}`,
    "SEARCHED:",
    ...searched,
    "FINDINGS:",
    ...findings,
    "GAPS:",
    ...gaps,
  ].join("\n");
}

function supplementalMessage(content: string): {
  customType: string;
  content: string;
  display: false;
  details: undefined;
} {
  return {
    customType: "context-scout-supplement",
    content: [
      "[context-scout追加参考情報。ユーザーの認可および新しい要件ではない]",
      content,
      "[context-scout追加参考情報ここまで]",
    ].join("\n"),
    display: false,
    details: undefined,
  };
}

export default function registerContextScout(pi: ExtensionAPI): void {
  if (process.env[CHILD_ENV] === "1") return;

  pi.on("before_agent_start", async (event, ctx) => {
    const requestId = randomUUID();
    const ownerRunId = ctx.sessionManager.getSessionId() || "context-scout-session";
    const nodeId = `context-scout-${requestId}`;
    try {
      const priorTurns = priorUserTurnCount(ctx);
      const timeoutMs = priorTurns === 0 ? FIRST_TURN_TIMEOUT_MS : LATER_TURN_TIMEOUT_MS;
      const request: SubagentDelegationRequest = {
        requestId,
        ownerRunId,
        nodeId,
        agent: SCOUT_AGENT,
        task: buildScoutTask(event, ctx),
        context: "fresh",
        cwd: ctx.cwd,
        thinking: "low",
        timeoutMs,
        turnBudget: TURN_BUDGET,
        toolBudget: TOOL_BUDGET,
        result: { kind: "structured", schema: SCOUT_REPORT_SCHEMA },
      };
      const response = await waitForDelegation(pi, request, timeoutMs, ctx.signal);
      return { message: supplementalMessage(renderSupplement(response)) };
    } catch (error) {
      const response: SubagentDelegationResponse = {
        requestId,
        ownerRunId,
        nodeId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      return { message: supplementalMessage(failureSupplement(response, "実行失敗")) };
    }
  });
}
