import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
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

test("exits nonzero and writes diagnostics only to stderr when no configuration exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-kb-process-"));
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  try {
    const result = await runServer(workspace, path.join(root, "missing.yml"));
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.match(
      result.stderr,
      /^\[skill-kb\] No knowledge configuration found\./,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
