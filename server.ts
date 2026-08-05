import express from "express";
import path from "path";
import { APP_CONFIG } from "./server/config.ts";
import { DB_PATH, recoverInterruptedJobs, db } from "./server/db.ts";
import { aiddaRouter } from "./server/routes/aidda.ts";
import { pythonExecutor } from "./server/python_executor.ts";
import { errorHandler } from "./server/middleware/error-handler.ts";
import { aiddaAuthMiddleware } from "./server/middleware/auth-middleware.ts";

const app = express();
const recovery = recoverInterruptedJobs();
if (recovery.jobsRecovered > 0 || recovery.projectsRecovered > 0) {
  console.warn(
    `Recovered interrupted jobs: jobs=${recovery.jobsRecovered}, projects=${recovery.projectsRecovered}`,
  );
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// ── Auth middleware — ONLY apply to /api/aidda routes ────────────────────────
app.use("/api/aidda", aiddaAuthMiddleware);

app.get("/api/aidda/health", (_req, res) => {
  res.json({
    ok: true,
    service: APP_CONFIG.serviceName,
    version: "0.1.0",
    time: new Date().toISOString(),
  });
});

app.use("/api/aidda", aiddaRouter);

// Global error handler (must be registered after routes)
app.use(errorHandler);

// ── Frontend services: registered inside start() per environment ────────────

async function start() {
  if (process.env.NODE_ENV !== "production") {
    // Development: Vite middleware must be mounted BEFORE catch-all
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite development middleware mounted.");
  } else {
    // Production: static files + SPA fallback
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));

    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Production static server configured.");
  }

  app.listen(APP_CONFIG.port, APP_CONFIG.host, () => {
    console.log(`AIDDA Workbench running on http://${APP_CONFIG.host}:${APP_CONFIG.port}`);
    console.log(`SQLite database: ${DB_PATH}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down gracefully...`);
  try {
    await pythonExecutor.shutdown();
  } catch (err) {
    console.error("Error during Python executor shutdown:", err);
  }
  try {
    db.close();
  } catch (err) {
    console.error("Error closing database:", err);
  }
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
