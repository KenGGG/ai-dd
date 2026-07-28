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
import { spawn, ChildProcess } from "child_process";
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
 * PythonExecutor class manages the lifecycle of Python subprocesses.
 */
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
    const timeoutMs =
      timeoutOption !== undefined ? timeoutOption : APP_CONFIG.pythonTimeoutMs * 1000;
    const id = `proc_${this.nextId++}`;
    const cmd = PythonExecutor.buildCondaCommand(scriptName, args, includeDataDir);

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
    let timedOut = false;
    let cancelled = false;

    // Setup child process
    const proc = spawn(cmd[0], cmd.slice(1), {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || "development",
      },
    });

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

    let timeoutTimer: NodeJS.Timeout | null = null;
    try {
      // Stream stdout to both memory and log file if provided
      proc.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        if (logPath) {
          fs.appendFileSync(logPath, text, "utf-8");
        }
        // Update heartbeat on data arrival
        processInfo.lastHeartbeat = Date.now();
      });

      proc.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        if (logPath) {
          fs.appendFileSync(logPath, text, "utf-8");
        }
        // Update heartbeat on data arrival
        processInfo.lastHeartbeat = Date.now();
      });

      proc.on("close", (code: number) => {
        exitCode = code;
        processInfo.endTime = Date.now();
        processInfo.status = code === 0 ? "completed" : "failed";
        this.activeProcesses.delete(id);
        this.stopHeartbeat(processInfo);

        if (code !== 0 && !timedOut && !cancelled) {
          processInfo.reject(new Error(`Python script exited with code ${code}: ${stderr.trim()}`));
        }
      });

      proc.on("error", (err: Error) => {
        processInfo.endTime = Date.now();
        processInfo.status = "failed";
        this.activeProcesses.delete(id);
        this.stopHeartbeat(processInfo);
        processInfo.reject(err);
      });

      // Set up timeout timer
      if (timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          processInfo.status = "timed_out";
          cancelled = true;

          // Try to terminate the process
          proc.kill("SIGTERM");

          // Give it time to clean up
          setTimeout(() => {
            if (proc.exitCode === null && proc.killed === false) {
              proc.kill("SIGKILL");
            }
            this.stopHeartbeat(processInfo);
            processInfo.resolve({
              pid: processInfo.pid,
              stdout,
              stderr,
              exitCode: exitCode,
              elapsedTimeMs: Date.now() - startTime,
            });
          }, 2000);

          // Reject the promise with timeout error
          processInfo.reject(new AppError(`Python script timed out after ${timeoutMs}ms`, 408));
        }, timeoutMs);
      }

      // Set up signal-based cancellation
      if (signal) {
        signal.addEventListener("abort", () => {
          if (!timedOut && proc.exitCode === null) {
            cancelled = true;
            processInfo.status = "cancelled";

            proc.kill("SIGTERM");

            setTimeout(() => {
              if (proc.exitCode === null && proc.killed === false) {
                proc.kill("SIGKILL");
              }
              this.stopHeartbeat(processInfo);
              processInfo.resolve({
                pid: processInfo.pid,
                stdout,
                stderr,
                exitCode: exitCode,
                elapsedTimeMs: Date.now() - startTime,
              });
            }, 2000);
            processInfo.reject(new AppError("Operation was cancelled", 499));
          }
        });
      }

      // Return a promise that resolves/rejects via the processInfo callbacks
      return new Promise((resolve, reject) => {
        processInfo.resolve = resolve;
        processInfo.reject = reject;

        // If the process has already terminated by the time we set up the handlers
        if (exitCode !== null) {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
            timeoutTimer = null;
          }
          if (exitCode === 0) {
            resolve({
              pid: processInfo.pid,
              stdout,
              stderr,
              exitCode,
              elapsedTimeMs: Date.now() - startTime,
            });
          } else {
            reject(new Error(`Python script exited with code ${exitCode}: ${stderr}`));
          }
        }
      });
    } catch (err) {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      this.stopHeartbeat(processInfo);
      this.activeProcesses.delete(id);
      throw err;
    }
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
      // Signal cancellation
      processInfo.abortController?.abort();
      // Also send SIGTERM directly
      processInfo.proc.kill("SIGTERM");
      processInfo.status = "cancelled";
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
