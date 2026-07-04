/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from "express";
import { createJob, finishJob } from "../db.ts";
import { parseLastJSON, runPythonScript } from "../python.ts";
import { asyncHandler } from "../middleware/error-handler.ts";

export const notebooklmRouter = Router();

notebooklmRouter.get(
  "/notebooklm/status",
  asyncHandler(async (_req: Request, res: Response) => {
    const jobId = createJob(null, "notebooklm_status");
    try {
      const { stdout } = await runPythonScript("notebooklm_auth_status.py");
      const status = parseLastJSON(stdout);
      finishJob(jobId, "completed", stdout);
      res.json({ status, output: stdout });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "NotebookLM 登录状态检查失败";
      finishJob(jobId, "failed", "", message);
      res.status(200).json({
        status: {
          status: "auth_failed",
          authenticated: false,
          message,
        },
      });
    }
  }),
);
