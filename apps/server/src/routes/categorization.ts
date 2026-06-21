import { Router } from "express";
import { z } from "zod";
import { submitReview, hasPendingReview, type ReviewDecision } from "../services/review-gate.js";

export const categorizationRouter = Router();

const decisionSchema = z.object({
  key: z.string(),
  action: z.enum(["create", "merge", "skip"]),
  name: z.string().min(1).max(60).optional(),
  type: z.enum(["income", "expense", "both"]).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  mergeCategoryId: z.number().int().positive().optional(),
});

const bodySchema = z.object({
  decisions: z.array(decisionSchema),
});

// Submit the user's new-category review decisions, unblocking a paused job.
categorizationRouter.post("/jobs/:jobId/review", (req, res) => {
  const { jobId } = req.params;
  if (!hasPendingReview(jobId)) {
    res.status(404).json({ error: "Ni aktivnega pregleda za to opravilo" });
    return;
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues }); return; }

  const ok = submitReview(jobId, parsed.data.decisions as ReviewDecision[]);
  res.json({ ok });
});
