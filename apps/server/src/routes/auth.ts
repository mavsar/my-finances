import { Router } from "express";
import jwt from "jsonwebtoken";

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const { username, password, remember } = req.body as {
    username?: string;
    password?: string;
    remember?: boolean;
  };

  const expectedUsername = process.env.AUTH_USERNAME;
  const expectedPassword = process.env.AUTH_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    res.status(500).json({ error: "Auth credentials not configured on server" });
    return;
  }

  if (username !== expectedUsername || password !== expectedPassword) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const secret = process.env.JWT_SECRET ?? "fallback-secret";
  // "Remember me" → long-lived token stored persistently in the browser.
  // No "Remember me" → short-lived token stored only for the session.
  const expiresIn = remember ? "30d" : "12h";
  const token = jwt.sign({ username }, secret, { expiresIn });

  res.json({ token });
});

authRouter.post("/logout", (_req, res) => {
  res.json({ ok: true });
});
