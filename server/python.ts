import { execFile, spawn } from "child_process";
import fs from "fs";
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
    const commandArgs = [
      "run",
      "-n",
      APP_CONFIG.condaEnv,
      "python3",
      "-u",
      scriptPath,
      "--data-dir",
      APP_CONFIG.dataDir,
      ...args,
    ];

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

export function buildPythonCommand(scriptName: string, args: string[] = []) {
  const scriptPath = path.join(process.cwd(), "scripts", scriptName);
  return {
    command: "conda",
    args: [
      "run",
      "-n",
      APP_CONFIG.condaEnv,
      "python3",
      "-u",
      scriptPath,
      "--data-dir",
      APP_CONFIG.dataDir,
      ...args,
    ],
  };
}

export function runPythonScriptLogged(
  scriptName: string,
  args: string[] = [],
  logPath: string,
): Promise<PythonRunResult> {
  return new Promise((resolve, reject) => {
    const { command, args: commandArgs } = buildPythonCommand(scriptName, args);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `\n$ ${command} ${commandArgs.join(" ")}\n`, "utf-8");

    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      fs.appendFileSync(logPath, text, "utf-8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      fs.appendFileSync(logPath, text, "utf-8");
    });

    child.on("error", (error) => {
      fs.appendFileSync(logPath, `\n[process error] ${error.message}\n`, "utf-8");
      reject(error);
    });

    child.on("close", (code) => {
      fs.appendFileSync(logPath, `\n[exit code] ${code}\n`, "utf-8");
      if (code && code !== 0) {
        reject(new Error(stderr || stdout || `Python script exited with code ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
