/**
 * Unified AIDDA API authentication middleware.
 *
 * All /api/aidda routes require Bearer token if authToken is configured.
 * /health and /auth/status are always public.
 */
import { timingSafeEqual } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { APP_CONFIG } from "../config.ts";
import { AppError } from "./error-handler.ts";

function safeTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function aiddaAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Always allow health check and auth status endpoints
  if (req.path === "/health" || req.path === "/auth/status") {
    next();
    return;
  }

  // If no token is configured, allow all requests (development mode)
  if (!APP_CONFIG.authToken || APP_CONFIG.authToken === "") {
    next();
    return;
  }

  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "未授权",
      code: "AUTH_REQUIRED",
    });
    return;
  }

  const token = authHeader.slice(7);

  if (!safeTokenEqual(token, APP_CONFIG.authToken)) {
    res.status(401).json({
      error: "Token 无效",
      code: "AUTH_INVALID",
    });
    return;
  }

  next();
}
