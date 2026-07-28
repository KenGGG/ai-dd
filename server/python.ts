import { APP_CONFIG } from "./config.ts";
import { pythonExecutor, PythonExecutor } from "./python_executor";

export interface PythonRunResult {
  stdout: string;
  stderr: string;
}

export function parseLastJSON(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // Keep walking backward until the script's final JSON payload is found.
    }
  }
  return null;
}

/**
 * Execute a Python script with timeout and cancellation support.
 * Uses the unified PythonExecutor for consistent process management.
 */
export async function runPythonScript(
  scriptName: string,
  args: string[] = [],
  includeDataDir = true,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<PythonRunResult> {
  const result = await pythonExecutor.execute(scriptName, args, {
    includeDataDir,
    timeoutMs: timeoutMs || APP_CONFIG.pythonTimeoutMs,
    signal,
  });

  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Execute a Python script with logging to a file.
 * Uses the unified PythonExecutor for consistent process management.
 */
export async function runPythonScriptLogged(
  scriptName: string,
  args: string[],
  logPath: string,
  timeoutMs?: number,
  signal?: AbortSignal,
): Promise<PythonRunResult> {
  const result = await pythonExecutor.execute(scriptName, args, {
    logPath,
    timeoutMs: timeoutMs || APP_CONFIG.pythonTimeoutMs,
    signal,
  });

  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Build the conda command for a Python script (for direct use or debugging).
 */
export function buildPythonCommand(scriptName: string, args: string[] = [], includeDataDir = true) {
  const cmd = PythonExecutor.buildCondaCommand(scriptName, args, includeDataDir);
  return {
    command: cmd[0],
    args: cmd.slice(1),
  };
}

/**
 * Get information about all currently active Python processes.
 */
export function getActivePythonProcesses() {
  return pythonExecutor.getActiveProcesses();
}

/**
 * Cancel an active Python process by its internal ID.
 */
export function cancelPythonProcess(id: string): boolean {
  return pythonExecutor.cancelProcess(id);
}

/**
 * Cancel all active Python processes.
 */
export function cancelAllPythonProcesses(): number {
  return pythonExecutor.cancelAll();
}

/**
 * Gracefully shut down the Python executor.
 */
export async function shutdownPythonExecutor(): Promise<void> {
  await pythonExecutor.shutdown();
}
