import express from "express";
import path from "path";
import { APP_CONFIG } from "./server/config.ts";
import { DB_PATH, recoverInterruptedJobs } from "./server/db.ts";
import { aiddaRouter } from "./server/routes/aidda.ts";
import { errorHandler } from "./server/middleware/error-handler.ts";

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
app.use("/api/aidda", (req, res, next) => {
  if (req.path === "/health") return next();
  if (!APP_CONFIG.authToken) return next(); // no token configured → allow all
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  if (token === APP_CONFIG.authToken) return next();
  res.status(401).json({ error: "未授权" });
});

app.get("/api/aidda/health", (_req, res) => {
  res.json({
    ok: true,
    service: APP_CONFIG.serviceName,
    database: DB_PATH,
    condaEnv: APP_CONFIG.condaEnv,
    time: new Date().toISOString(),
  });
});

app.use("/api/aidda", aiddaRouter);

// Global error handler (must be registered after routes)
app.use(errorHandler);

// ── Static assets — PUBLIC after auth middleware but before catch-all ────────
if (process.env.NODE_ENV !== "production") {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
  console.log("Vite development middleware mounted.");
} else {
  const distPath = path.join(process.cwd(), "dist");
  // Serve static assets publicly — no auth required
  app.use(express.static(distPath));
}

// ── Catch-all SPA route ────────────────────────────────────────────────────
app.get("*", (_req, res) => {
  if (process.env.NODE_ENV === "production") {
    const distPath = path.join(process.cwd(), "dist");
    res.sendFile(path.join(distPath, "index.html"));
  } else {
    // In dev, Vite handles the SPA routing
  }
});

async function start() {
  if (process.env.NODE_ENV !== "production") {
    // Vite middleware already mounted above
  } else {
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
