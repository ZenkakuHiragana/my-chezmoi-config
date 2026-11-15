/**
 * pi-fix-git-bash: pass bash tool commands to Git Bash in an environment variable.
 *
 * Git for Windows' bash cuts a `bash -c` script at about 8,190 characters and halves runs of
 * backslashes in it, often without an error, and Pi's bash tool passes commands that way.
 * This extension puts the command in an environment variable of the shell and passes
 * `bash -c` only a short line that evals it. Everything else is Pi's built-in bash tool,
 * with the same settings.
 *
 * Processes that Git Bash forks are not children of the shell in Windows' process tree, so
 * Pi's `taskkill /T` misses them when a call is aborted or times out. Every call marks its
 * processes in their environment, and a stopped call kills the marked ones left.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  type BashOperations,
  createBashToolDefinition,
  createLocalBashOperations,
  type ExtensionAPI,
  getShellConfig,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

/** Carries the command. `export -n` keeps it from the command's child processes. */
const CARRIER = "__pi_fix_git_bash_command";
const EVAL_CARRIER = `builtin export -n ${CARRIER}; builtin eval "$${CARRIER}"`;
/**
 * Marks the processes of a call. A call started inside another call adds its mark to the
 * inherited ones, so stopping the outer call reaches it too.
 */
const RUN_MARK = "PI_FIX_GIT_BASH_RUN";
/** Kills the processes whose mark variable holds the mark given as $1. */
const KILL_MARKED =
  'for p in /proc/[0-9]*; do grep -qzE "^' + RUN_MARK + '=(.* )?$1( |$)" "$p/environ" 2>/dev/null && builtin kill -9 "${p#/proc/}" 2>/dev/null; done; true';

function killMarked(shell: string, mark: string, env: NodeJS.ProcessEnv): Promise<void> {
  const { [CARRIER]: _command, [RUN_MARK]: _mark, ...sweepEnv } = env;
  return new Promise((resolve) => {
    const child = spawn(shell, ["-c", KILL_MARKED, "pi-fix-git-bash", mark], { env: sweepEnv, stdio: "ignore", windowsHide: true });
    child.once("error", () => resolve());
    child.once("exit", () => resolve());
  });
}

function operationsFor(shellPath: string | undefined): BashOperations {
  return {
    async exec(command, cwd, options) {
      const shell = getShellConfig(shellPath);
      const local = createLocalBashOperations({ shellPath: shell.shell });
      // Pi passes commands to the legacy WSL bash on stdin, and the environment does not reach WSL.
      if (shell.commandTransport === "stdin") return local.exec(command, cwd, options);
      const env = { ...(options.env ?? process.env) };
      // Windows ignores case in names: another spelling of the carrier would hide the command.
      for (const name of Object.keys(env)) if (name.toUpperCase() === CARRIER.toUpperCase()) delete env[name];
      env[CARRIER] = command;
      const mark = randomBytes(8).toString("hex");
      env[RUN_MARK] = env[RUN_MARK] ? `${env[RUN_MARK]} ${mark}` : mark;

      // Stop at the deadline or on abort, and kill the marked processes at that moment:
      // Pi waits for descendants that still write to the output, and its taskkill misses them.
      const stop = new AbortController();
      stop.signal.addEventListener("abort", () => void killMarked(shell.shell, mark, env), { once: true });
      const onAbort = () => stop.abort();
      if (options.signal?.aborted) stop.abort();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const seconds = options.timeout;
      let timedOut = false;
      const timer =
        seconds !== undefined && Number.isFinite(seconds) && seconds > 0
          ? setTimeout(() => {
              timedOut = true;
              stop.abort();
            }, seconds * 1000)
          : undefined;
      try {
        // Pi still checks the timeout, and its own deadline comes after this one.
        return await local.exec(EVAL_CARRIER, cwd, { ...options, env, signal: stop.signal });
      } catch (error) {
        // The form Pi's bash tool reports as a timeout.
        if (timedOut) throw new Error(`timeout:${seconds}`);
        throw error;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}

export default function piFixGitBash(pi: ExtensionAPI): void {
  if (process.platform !== "win32") return;
  pi.registerTool({
    ...createBashToolDefinition(process.cwd()),
    // Active where the built-in bash would be: by defaultTools and --tools, not by registering.
    defaultActive: false,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      // The settings Pi gives its built-in bash tool, read on each call.
      const settings = SettingsManager.inMemory(pi.getSettings());
      const bash = createBashToolDefinition(process.cwd(), {
        commandPrefix: settings.getShellCommandPrefix(),
        operations: operationsFor(settings.getShellPath()),
      });
      return bash.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  });
}
