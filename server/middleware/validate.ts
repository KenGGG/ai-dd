/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import { AppError } from "./error-handler";

type ValidationSchemas = {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
};

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.query = schemas.query.parse(req.query) as typeof req.query;
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      next();
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        next(
          new AppError(
            err.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
            400,
            "VALIDATION_ERROR",
          ),
        );
      } else {
        next(err);
      }
    }
  };
}

export const createProjectSchema = z.object({
  stockCode: z.string().min(1, "股票代码不能为空").max(10),
  projectName: z.string().optional().default(""),
  stockName: z.string().optional().default(""),
});

export const downloadAndUploadSchema = z.object({
  stockCode: z.string().optional(),
  notebookId: z.string().optional(),
  periodicYears: z.number().optional().default(3),
  recentLimit: z.number().optional().default(200),
});

export const composeReportSchema = z.object({
  projectName: z.string().optional(),
  stockCode: z.string().optional(),
  stockName: z.string().optional(),
  notebookId: z.string().optional(),
});
