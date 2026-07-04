/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIDDA main router — composes all sub-routers under /api/aidda.
 *
 * Sub-routers:
 *   - projects  : project CRUD, status, manifest, report
 *   - tasks     : async tasks (download/upload, compose report) + job status
 *   - notebooklm: NotebookLM auth status check
 */

import { Router } from "express";
import { projectsRouter } from "./projects.ts";
import { tasksRouter } from "./tasks.ts";
import { notebooklmRouter } from "./notebooklm.ts";

export const aiddaRouter = Router();

aiddaRouter.use(projectsRouter);
aiddaRouter.use(tasksRouter);
aiddaRouter.use(notebooklmRouter);
