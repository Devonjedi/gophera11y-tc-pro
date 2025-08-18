// /api/routes/ai-vpat.js
import express from "express";
import { getGemini, generateWithRetry, DEFAULT_SAFETY } from "../gemini.js";
import { redact } from "../util/redact.js";

export const router = express.Router();

const responseSchema = {
  type: "object",
  properties: {
    overallRisk: { type: "string", enum: ["low","medium","high"] },
    counts: {
      type: "object",
      properties: {
        supports:       { type: "number" },
        partial:        { type: "number" },
        doesNotSupport: { type: "number" },
        notApplicable:  { type: "number" }
      }
    },
    redFlags:  { type: "array", items: { type: "string" } },
    vendorAsks:{ type: "array", items: { type: "string" } }
  },
  required: ["overallRisk","counts","redFlags","vendorAsks"]
};

router.post("/ai/vpat-score", async (req, res) => {
  try {
    const { vpatJson } = req.body || {};
    if (!vpatJson) return res.status(400).json({ error: "Missing vpatJson" });

    const { model } = getGemini();

    const prompt =
`You are reviewing a vendor Accessibility Conformance Report (VPAT/ACR) for a public university procurement.
Return JSON only with:
- overallRisk (low|medium|high),
- counts (supports, partial, doesNotSupport, notApplicable),
- redFlags (top risks),
- vendorAsks (follow-ups: WCAG 2.2 AA targets, AT matrix NVDA/JAWS/VoiceOver/TalkBack, remediation timeline, contacts).

ACR JSON:
${redact(JSON.stringify(vpatJson)).slice(0, 40000)}`;

    const requestOptions = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      safetySettings: DEFAULT_SAFETY,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema
      }
    };

    const out = await generateWithRetry(model, requestOptions);

    res.json(JSON.parse(out.response.text()));
  } catch (e) {
    res.status(500).json({ error: e.message || "Gemini error" });
  }
});
