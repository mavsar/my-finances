import { Router } from "express";
import jwt from "jsonwebtoken";

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };

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
  const token = jwt.sign({ username }, secret, { expiresIn: "7d" });

  res.json({ token });
});

authRouter.post("/logout", (_req, res) => {
  res.json({ ok: true });
});
