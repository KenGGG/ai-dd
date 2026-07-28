/**
 * Bearer token authentication middleware for AIDDA API.
 */
import { Request, Response, NextFunction } from "express";
import { APP_CONFIG } from "../config.ts";
import { AppError } from "./error-handler.ts";

// Auth middleware that requires Bearer token in Authorization header
export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("Authorization header missing or invalid", 401);
  }

  const token = authHeader.split(" ")[1];
  if (token !== APP_CONFIG.authToken) {
    throw new AppError("Invalid authentication token", 403);
  }

  next();
}

// Optional auth middleware - only checks if token is provided, doesn't fail if missing
export function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.split(" ")[1];
    if (token !== APP_CONFIG.authToken) {
      throw new AppError("Invalid authentication token", 403);
    }
  }
  // If no authorization header or empty token, continue without auth
  next();
}
