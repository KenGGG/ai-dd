import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { APP_CONFIG } from "../server/config.ts";

const command = process.argv[2] || "stats";
const dbPath = APP_CONFIG.dbPath;

function openDb() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database does not exist: ${dbPath}`);
  }
  return new Database(dbPath);
}

function printStats() {
  const db = openDb();
  try {
    const tables = ["projects", "jobs", "artifacts"];
    const counts = Object.fromEntries(
      tables.map((table) => {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
        return [table, row.count];
      }),
    );
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    console.log(
      JSON.stringify(
        {
          dbPath,
          counts,
          sizeBytes: fs.statSync(dbPath).size,
          walBytes: fs.existsSync(walPath) ? fs.statSync(walPath).size : 0,
          shmBytes: fs.existsSync(shmPath) ? fs.statSync(shmPath).size : 0,
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
}

function backup() {
  const db = openDb();
  const backupDir = path.join(APP_CONFIG.dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `aidda-${stamp}.sqlite`);
  try {
    db.backup(target)
      .then(() => {
        console.log(JSON.stringify({ dbPath, backupPath: target }, null, 2));
        db.close();
      })
      .catch((error) => {
        db.close();
        console.error(error);
        process.exit(1);
      });
  } catch (error) {
    db.close();
    throw error;
  }
}

function vacuum() {
  const db = openDb();
  try {
    db.exec("VACUUM;");
    console.log(JSON.stringify({ dbPath, vacuumed: true }, null, 2));
  } finally {
    db.close();
  }
}

try {
  if (command === "stats") {
    printStats();
  } else if (command === "backup") {
    backup();
  } else if (command === "vacuum") {
    vacuum();
  } else {
    console.error("Usage: tsx scripts/db_maintenance.ts [stats|backup|vacuum]");
    process.exit(1);
  }
} catch (error: any) {
  console.error(error.message || error);
  process.exit(1);
}
