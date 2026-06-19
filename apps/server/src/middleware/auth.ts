import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const queryToken = req.query.token as string | undefined;

  const raw = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;

  if (!raw) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const secret = process.env.JWT_SECRET ?? "fallback-secret";

  try {
    jwt.verify(raw, secret);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
