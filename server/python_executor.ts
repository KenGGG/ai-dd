/**
 * Unified Python execution manager with process tracking, timeout, cancellation, and heartbeat.
 *
 * Manages subprocess lifecycle for running Python scripts with full control over:
 * - Process ID tracking
 * - Timeout enforcement
 * - Graceful cancellation (SIGTERM + SIGKILL)
 * - Heartbeat monitoring
 * - Log streaming
 */
import { spawn, ChildProcess, SpawnOptions } from "child_process";
import fs from "fs";
import path from "path";
import { APP_CONFIG } from "./config.ts";
import { AppError } from "./middleware/error-handler.ts";

export type ProcessStatus =
  "pending" | "running" | "timed_out" | "cancelled" | "completed" | "failed";

export interface PythonProcessInfo {
  pid: number;
  cmd: string;
  args: string[];
  proc: ChildProcess;
  stdout: string;
  stderr: string;
  logPath?: string;
  startTime: number;
  lastHeartbeat: number;
  endTime?: number;
  status: ProcessStatus;
  resolve: (value: PythonExecutionResult) => void;
  reject: (reason: unknown) => void;
  abortController?: AbortController;
  heartbeatInterval?: NodeJS.Timeout;
}

export interface PythonExecutionResult {
  pid: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  elapsedTimeMs: number;
}

/**
 * Command builder function for Python subprocess invocation.
 * Allows custom command construction for testing without conda.
 */
export type PythonCommandBuilder = (
  scriptName: string,
  args: string[],
  includeDataDir: boolean,
) => string[];

class PythonExecutor {
  private activeProcesses = new Map<string, PythonProcessInfo>();
  private nextId = 0;

  /**
   * Default heartbeat interval in milliseconds (5 seconds).
   */
  private static readonly DEFAULT_HEARTBEAT_INTERVAL = 5000;

  /**
   * Build the conda command to run a Python script in the specified environment.
   */
  static buildCondaCommand(scriptName: string, args: string[], includeDataDir = true): string[] {
    const scriptPath = path.join(process.cwd(), "scripts", scriptName);
    const commandArgs: string[] = [
      "run",
      "-n",
      APP_CONFIG.condaEnv,
      "python3",
      "-u",
      scriptPath,
      ...args,
    ];
    if (includeDataDir) {
      commandArgs.push("--data-dir", APP_CONFIG.dataDir);
    }
    return ["conda", ...commandArgs];
  }

  constructor(
    private readonly commandBuilder: PythonCommandBuilder = PythonExecutor.buildCondaCommand,
  ) {}

  /**
   * Start a heartbeat monitor for a Python process.
   */
  private startHeartbeat(processInfo: PythonProcessInfo): void {
    const interval = (processInfo.heartbeatInterval ||
      PythonExecutor.DEFAULT_HEARTBEAT_INTERVAL) as number;
    processInfo.heartbeatInterval = setInterval(() => {
      processInfo.lastHeartbeat = Date.now();
    }, interval) as NodeJS.Timeout;
  }

  /**
   * Stop the heartbeat monitor for a Python process.
   */
  private stopHeartbeat(processInfo: PythonProcessInfo): void {
    if (processInfo.heartbeatInterval) {
      clearInterval(processInfo.heartbeatInterval);
      processInfo.heartbeatInterval = undefined;
    }
  }

  /**
   * Execute a Python script with timeout, optional cancellation, and heartbeat monitoring.
   */
  async execute(
    scriptName: string,
    args: string[] = [],
    options: {
      logPath?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
      includeDataDir?: boolean;
      heartbeatInterval?: number; // Optional heartbeat interval in ms
    } = {},
  ): Promise<PythonExecutionResult> {
    const {
      logPath,
      timeoutMs: timeoutOption,
      signal: providedSignal,
      includeDataDir = true,
      heartbeatInterval,
    } = options;

    // Use timeout as configured (already in milliseconds from config)
    const timeoutMs = timeoutOption ?? APP_CONFIG.pythonTimeoutMs;
    const id = `proc_${this.nextId++}`;
    const cmd = this.commandBuilder(scriptName, args, includeDataDir);

    // Check for cancellation before starting
    if (providedSignal?.aborted) {
      throw new AppError("Operation cancelled before start", 499);
    }

    // Create abort controller for internal cancellation if none provided
    let abortController: AbortController | null = null;
    let signal: AbortSignal | null = providedSignal ?? null;
    if (!signal) {
      abortController = new AbortController();
      signal = abortController.signal;
    }

    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;

    // Setup child process
    const spawnOptions: SpawnOptions = {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "development",
      },
    };
    const proc = spawn(cmd[0], cmd.slice(1), spawnOptions);

    const processInfo: PythonProcessInfo = {
      pid: proc.pid!,
      cmd: cmd[0],
      args: cmd.slice(1),
      proc,
      stdout: "",
      stderr: "",
      logPath,
      startTime,
      lastHeartbeat: Date.now(),
      status: "running",
      resolve: () => {},
      reject: () => {},
      abortController: abortController ?? undefined,
      heartbeatInterval: undefined,
    };

    this.activeProcesses.set(id, processInfo);

    // Start heartbeat monitor if interval provided
    if (heartbeatInterval && heartbeatInterval > 0) {
      this.startHeartbeat(processInfo);
    }

    let timeoutTimer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    let settled = false;
    let requestedStopError: Error | null = null;
    let requestedStopStatus: "timed_out" | "cancelled" | null = null;

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener("abort", onAbort);
      this.stopHeartbeat(processInfo);
      this.activeProcesses.delete(id);
    };

    const finishResolve = (result: PythonExecutionResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      processInfo.resolve(result);
    };

    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      processInfo.reject(error);
    };

    const requestStop = (
      status: "timed_out" | "cancelled",
      error: Error,
    ) => {
      if (settled || requestedStopError) return;

      requestedStopError = error;
      requestedStopStatus = status;
      processInfo.status = status;

      if (proc.exitCode === null) {
        proc.kill("SIGTERM");

        forceKillTimer = setTimeout(() => {
          if (proc.exitCode === null) {
            proc.kill("SIGKILL");
          }
        }, 2000);
      }
    };

    proc.once("close", (code) => {
      exitCode = code;
      processInfo.endTime = Date.now();

      const result = {
        pid: processInfo.pid,
        stdout,
        stderr,
        exitCode: code,
        elapsedTimeMs: Date.now() - startTime,
      };

      if (requestedStopError) {
        processInfo.status = requestedStopStatus ?? "cancelled";
        finishReject(requestedStopError);
        return;
      }

      if (code === 0) {
        processInfo.status = "completed";
        finishResolve(result);
      } else {
        processInfo.status = "failed";
        finishReject(
          new Error(
            `Python script exited with code ${code}: ${stderr.trim()}`,
          ),
        );
      }
    });

    proc.once("error", (error) => {
      processInfo.status = "failed";
      finishReject(error);
    });

    const onAbort = () => {
      requestStop(
        "cancelled",
        new AppError("Operation was cancelled", 499),
      );
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        requestStop(
          "timed_out",
          new AppError(
            `Python script timed out after ${timeoutMs}ms`,
            408,
          ),
        );
      }, timeoutMs);
    }

    // Stream stdout to both memory and log file if provided.
    // In-memory buffers are capped to avoid unbounded growth (spawn has no maxBuffer).
    const maxBuf = APP_CONFIG.pythonMaxBufferBytes;
    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (stdout.length < maxBuf) {
        stdout += text.slice(0, maxBuf - stdout.length);
      }
      if (processInfo) {
        processInfo.lastHeartbeat = Date.now();
      }
      if (logPath) {
        fs.appendFileSync(logPath, text, "utf-8");
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (stderr.length < maxBuf) {
        stderr += text.slice(0, maxBuf - stderr.length);
      }
      if (processInfo) {
        processInfo.lastHeartbeat = Date.now();
      }
      if (logPath) {
        fs.appendFileSync(logPath, text, "utf-8");
      }
    });

    // Return a promise that resolves/rejects via the process callbacks
    return new Promise<PythonExecutionResult>((resolve, reject) => {
      processInfo.resolve = resolve;
      processInfo.reject = reject;

      // If the process has already terminated by the time we set up the handlers
      if (exitCode !== null) {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = undefined;
        }
        if (exitCode === 0) {
          finishResolve({
            pid: processInfo.pid,
            stdout,
            stderr,
            exitCode,
            elapsedTimeMs: Date.now() - startTime,
          });
        } else {
          finishReject(
            new Error(
              `Python script exited with code ${exitCode}: ${stderr}`,
            ),
          );
        }
      }
    });
  }

  /**
   * Get information about all currently active Python processes.
   */
  getActiveProcesses(): {
    id: string;
    pid: number;
    cmd: string;
    status: ProcessStatus;
    elapsedMs: number;
    lastHeartbeatMs: number;
  }[] {
    const now = Date.now();
    return Array.from(this.activeProcesses.entries()).map(([id, info]) => ({
      id,
      pid: info.pid,
      cmd: info.cmd,
      status: info.status,
      elapsedMs: now - info.startTime,
      lastHeartbeatMs: now - info.lastHeartbeat,
    }));
  }

  /**
   * Cancel an active Python process by its internal ID.
   */
  cancelProcess(id: string): boolean {
    const processInfo = this.activeProcesses.get(id);
    if (processInfo && processInfo.status === "running") {
      // Abort triggers onAbort -> requestStop("cancelled", ...) which records the
      // stop error/status, so the close handler reports the correct final state.
      processInfo.abortController?.abort();
      // Also send SIGTERM directly as a fallback.
      processInfo.proc.kill("SIGTERM");
      this.stopHeartbeat(processInfo);
      return true;
    }
    return false;
  }

  /**
   * Cancel all active Python processes.
   */
  cancelAll(): number {
    let count = 0;
    for (const id of this.activeProcesses.keys()) {
      if (this.cancelProcess(id)) count++;
    }
    return count;
  }

  /**
   * Wait for all active processes to complete (with timeout).
   */
  async waitForAll(timeoutMs: number = 30000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.activeProcesses.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (this.activeProcesses.size > 0) {
      throw new AppError(
        `WaitForAll timed out with ${this.activeProcesses.size} still running`,
        504,
      );
    }
  }

  /**
   * Clean up all resources and stop any running processes.
   */
  async shutdown(): Promise<void> {
    const count = this.cancelAll();
    if (count > 0) {
      await new Promise((resolve) => setTimeout(resolve, 3000)); // Allow graceful shutdown
    }
    // Stop any remaining heartbeat monitors
    for (const info of this.activeProcesses.values()) {
      this.stopHeartbeat(info);
    }
    this.activeProcesses.clear();
  }
}

// Singleton instance
export const pythonExecutor = new PythonExecutor();

export { PythonExecutor };

export default pythonExecutor;