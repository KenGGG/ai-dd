import { execFile } from "child_process";
import path from "path";
import { APP_CONFIG } from "./config.ts";

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

export function runPythonScript(scriptName: string, args: string[] = []): Promise<PythonRunResult> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "scripts", scriptName);
    const commandArgs = ["run", "-n", APP_CONFIG.condaEnv, "python3", scriptPath, ...args];

    execFile(
      "conda",
      commandArgs,
      {
        cwd: process.cwd(),
        maxBuffer: APP_CONFIG.pythonMaxBufferBytes,
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr || error.message;
          reject(new Error(message));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}
