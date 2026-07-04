/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { DATA_DIR } from "../db.ts";
import {
  deleteProject,
  getProject,
  listProjects,
  upsertProject,
} from "../db.ts";
import { parseLastJSON, runPythonScript } from "../python.ts";
import { AppError, asyncHandler } from "../middleware/error-handler.ts";
import { createProjectSchema, validate } from "../middleware/validate.ts";

export const projectsRouter = Router();

function readJSON(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

projectsRouter.get("/projects", (_req: Request, res: Response) => {
  res.json({ projects: listProjects() });
});

projectsRouter.get("/projects/:id", (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) {
    throw new AppError("项目不存在", 404);
  }
  res.json({ project });
});

projectsRouter.delete("/projects/:id", (req: Request, res: Response) => {
  deleteProject(req.params.id);
  res.json({ ok: true });
});

projectsRouter.post("/projects", validate({ body: createProjectSchema }), asyncHandler(async (req: Request, res: Response) => {
  const { stockCode, projectName, stockName } = req.body as {
    stockCode: string;
    projectName: string;
    stockName: string;
  };

  const { stdout } = await runPythonScript("notebooklm_create_project.py", [
    "--stock-code",
    stockCode,
    "--project-name",
    projectName,
    "--stock-name",
    stockName,
  ]);
  const payload = parseLastJSON(stdout);
  if (!payload) {
    throw new AppError("项目创建输出无法解析", 500, "PARSE_ERROR");
  }

  const project = upsertProject({
    id: payload.project_id as string,
    name: payload.project_name as string,
    stockCode: payload.stock_code as string,
    stockName: payload.stock_name as string,
    notebookId: payload.notebook_id as string,
    notebookTitle: payload.notebook_title as string,
    status: "idle",
    currentStep: 0,
    meta: { source: "notebooklm_create_project.py" },
  });

  res.json({ project: payload, record: project, output: stdout });
}));

// Project status endpoint
projectsRouter.get("/projects/:id/status", (req: Request, res: Response) => {
  const project = getProject(req.params.id);
  if (!project) {
    throw new AppError("项目不存在", 404);
  }

  const status: {
    projectId: string;
    project: typeof project;
    jobs: unknown[];
    downloadStatus: string;
    uploadStatus: string;
    questionStatus: string;
    reportStatus: string;
    manifestPath?: string;
    answerCount?: number;
    answersDir?: string;
    answersManifest?: Record<string, unknown>;
    reportPath?: string;
  } = {
    projectId: project.id,
    project,
    jobs: [],
    downloadStatus: "unknown",
    uploadStatus: "unknown",
    questionStatus: "unknown",
    reportStatus: "unknown",
  };

  const manifestPath = path.join(DATA_DIR, "manifests", `${project.id}_announcements.jsonl`);
  if (fs.existsSync(manifestPath)) {
    status.downloadStatus = "completed";
    status.manifestPath = manifestPath;
  }

  const answersDir = path.join(DATA_DIR, "answers", project.id);
  if (fs.existsSync(answersDir)) {
    const answerFiles = fs.readdirSync(answersDir).filter((f) => f.endsWith(".md"));
    if (answerFiles.length > 0) {
      status.questionStatus = "completed";
      status.answerCount = answerFiles.length;
      status.answersDir = answersDir;
    }
    const answersManifestPath = path.join(answersDir, "answers_manifest.json");
    if (fs.existsSync(answersManifestPath)) {
      const manifest = readJSON(answersManifestPath);
      if (manifest) status.answersManifest = manifest;
    }
  }

  const reportPath = path.join(DATA_DIR, "reports", `${project.id}_dd_report.md`);
  if (fs.existsSync(reportPath)) {
    status.reportStatus = "completed";
    status.reportPath = reportPath;
  }

  res.json({ status });
});

// Manifest endpoint
projectsRouter.get("/projects/:id/manifest", (req: Request, res: Response) => {
  const manifestPath = path.join(DATA_DIR, "manifests", `${req.params.id}_announcements.jsonl`);
  if (!fs.existsSync(manifestPath)) {
    throw new AppError("manifest 不存在", 404);
  }
  const lines = fs.readFileSync(manifestPath, "utf-8").trim().split("\n").filter(Boolean);
  const records = lines.map((line) => JSON.parse(line));
  res.json({ records, total: records.length });
});

// Report endpoint
projectsRouter.get("/projects/:id/report", (req: Request, res: Response) => {
  const reportPath = path.join(DATA_DIR, "reports", `${req.params.id}_dd_report.md`);
  if (!fs.existsSync(reportPath)) {
    throw new AppError("报告不存在", 404);
  }
  res.json({ content: fs.readFileSync(reportPath, "utf-8"), path: reportPath });
});
