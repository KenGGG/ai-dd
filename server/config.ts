import dotenv from "dotenv";
import path from "path";

dotenv.config({ quiet: true });

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function readPath(name: string, fallback: string): string {
  const value = process.env[name] || fallback;
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

export const APP_CONFIG = {
  serviceName: "aidda-workbench",
  port: readNumber("PORT", 3871),
  host: process.env.HOST || "0.0.0.0",
  dataDir: readPath("AIDDA_DATA_DIR", "data"),
  dbPath: readPath("AIDDA_DB_PATH", path.join("data", "aidda.sqlite")),
  condaEnv: process.env.AIDDA_CONDA_ENV || "openclaw",
  pythonMaxBufferBytes: readNumber("AIDDA_PYTHON_MAX_BUFFER_MB", 50) * 1024 * 1024,
};
