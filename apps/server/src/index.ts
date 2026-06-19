import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import cors from "cors";
import express from "express";

import { sqlite } from "./db/client.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { categoriesRouter } from "./routes/categories.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { filesRouter } from "./routes/files.js";
import { healthRouter } from "./routes/health.js";
import { rulesRouter } from "./routes/rules.js";
import { transactionsRouter } from "./routes/transactions.js";

const app = express();
const port = Number(process.env.PORT ?? 3210);

app.use(cors());
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);

app.use("/api/categories", requireAuth, categoriesRouter);
app.use("/api/files", requireAuth, filesRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/transactions", requireAuth, transactionsRouter);
app.use("/api/rules", requireAuth, rulesRouter);

app.get("/api/version", requireAuth, (_req, res) => {
  const [{ version }] = sqlite
    .prepare("SELECT sqlite_version() AS version")
    .all() as Array<{ version: string }>;
  res.json({ sqliteVersion: version });
});

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectoryPath = path.dirname(currentFilePath);
const webDistPath = path.resolve(currentDirectoryPath, "..", "..", "web", "dist");

if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDistPath, "index.html"));
  });
} else {
  app.get("*", (_req, res) => {
    res.status(503).json({
      error: "Frontend build not found. Run npm run build -w @my-finances/web.",
    });
  });
}

app.listen(port, () => {
  console.log(`My Finances app listening on port ${port}`);
});
