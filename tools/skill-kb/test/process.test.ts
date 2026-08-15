import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

type ProcessResult = {
  code: number | null;
  stderr: string;
  stdout: string;
};

function runServer(cwd: string, configPath: string): Promise<ProcessResult> {
  const serverPath = path.resolve("dist", "src", "index.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      cwd,
      env: { ...process.env, SKILL_KB_CONFIG: configPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr, stdout }));
  });
}

function runServerUntilIdle(
  cwd: string,
  configPath: string,
  idleMilliseconds = 1000,
): Promise<{ exited: boolean; stdout: string; stderr: string }> {
  const serverPath = path.resolve("dist", "src", "index.js");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      cwd,
      env: { ...process.env, SKILL_KB_CONFIG: configPath },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let exited = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", () => {
      exited = true;
    });
    setTimeout(() => {
      const observed = { exited, stdout, stderr };
      if (exited) {
        resolve(observed);
        return;
      }
      child.once("close", () => resolve(observed));
      child.kill();
    }, idleMilliseconds);
  });
}

test("exits nonzero and writes diagnostics only to stderr when a configuration is invalid", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-process-"));
  const workspace = path.join(root, "workspace");
  const projectDirectory = path.join(workspace, ".opencode");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(path.join(projectDirectory, "KNOWLEDGE.yml"), "sources: [");
  try {
    const result = await runServer(workspace, path.join(root, "missing.yml"));
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^\[skill-kb\] Cannot read YAML configuration/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stays alive and writes nothing to stdout when no configuration exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-process-"));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  try {
    const result = await runServerUntilIdle(
      workspace,
      path.join(root, "missing.yml"),
    );
    assert.equal(result.exited, false);
    assert.equal(result.stdout, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps the server alive and reports invalid sources outside MCP output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-process-"));
  const workspace = path.join(root, "workspace");
  const projectDirectory = path.join(workspace, ".opencode");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(
    path.join(projectDirectory, "KNOWLEDGE.yml"),
    [
      "sources:",
      "  - name: broken",
      "    description: Broken source.",
      "    instructions: Read it.",
      "    unexpected: true",
    ].join("\n"),
  );
  try {
    const result = await runServerUntilIdle(
      workspace,
      path.join(root, "missing.yml"),
    );
    assert.equal(result.exited, false);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Invalid source broken/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps the server alive when a query module cannot be loaded", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-process-"));
  const workspace = path.join(root, "workspace");
  const projectDirectory = path.join(workspace, ".opencode");
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(
    path.join(projectDirectory, "KNOWLEDGE.yml"),
    [
      "sources:",
      "  - name: broken-module",
      "    description: Broken module.",
      "    instructions: Read it.",
      "    query_module: ./missing.mts",
    ].join("\n"),
  );
  try {
    const result = await runServerUntilIdle(
      workspace,
      path.join(root, "missing.yml"),
    );
    assert.equal(result.exited, false);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /query_module cannot be resolved/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
