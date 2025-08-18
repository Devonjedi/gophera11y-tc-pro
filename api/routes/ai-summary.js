// /api/routes/ai-summary.js
import express from "express";
import { getGemini, generateWithRetry, DEFAULT_SAFETY } from "../gemini.js";
import { redact } from "../util/redact.js";

export const router = express.Router();

const responseSchema = {
  type: "object",
  properties: {
    executiveSummary: { type: "string" },
    topRules: { type: "array", items: { type: "string" } },
    impactCounts: {
      type: "object",
      properties: {
        critical: { type: "number" },
        serious:  { type: "number" },
        moderate: { type: "number" },
        minor:    { type: "number" }
      }
    },
    wcagFocus: { type: "array", items: { type: "string" } }
  },
  required: ["executiveSummary","topRules","impactCounts","wcagFocus"]
};

router.post("/ai/summarize-axe", async (req, res) => {
  try {
    const { results } = req.body || {};
    if (!results) return res.status(400).json({ error: "Missing results" });

    const { model } = getGemini();

    const prompt =
`Summarize these axe-core results for higher-ed stakeholders.
Return JSON matching the schema. Focus on risks, remediation themes, and WCAG mapping.
Avoid legal language; do not provide legal advice.

DATA (redacted):
${redact(JSON.stringify(results)).slice(0, 50000)}`;

    const requestOptions = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      safetySettings: DEFAULT_SAFETY,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema
      }
    };

    // use retry wrapper
    const out = await generateWithRetry(model, requestOptions);

    res.json(JSON.parse(out.response.text()));
  } catch (e) {
    res.status(500).json({ error: e.message || "Gemini error" });
  }
});
