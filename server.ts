import express from "express";
import path from "path";
import { APP_CONFIG } from "./server/config.ts";
import { DB_PATH, recoverInterruptedJobs } from "./server/db.ts";
import { aiddaRouter } from "./server/routes/aidda.ts";

const app = express();
const recovery = recoverInterruptedJobs();
if (recovery.jobsRecovered > 0 || recovery.projectsRecovered > 0) {
  console.warn(
    `Recovered interrupted jobs: jobs=${recovery.jobsRecovered}, projects=${recovery.projectsRecovered}`,
  );
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: APP_CONFIG.serviceName,
    database: DB_PATH,
    condaEnv: APP_CONFIG.condaEnv,
    time: new Date().toISOString(),
  });
});

app.use("/api/aidda", aiddaRouter);

async function start() {
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
