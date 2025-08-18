// /api/routes/ai-vpat-pdf.js
import express from "express";
import axios from "axios";
import { getGemini, generateWithRetry, DEFAULT_SAFETY } from "../gemini.js";
export const router = express.Router();

const responseSchema = {
  type: "object",
  properties: {
    product:  { type: "string" },
    criteria: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string" }, // e.g., "WCAG 1.4.3 Contrast (Minimum)"
          result:    { type: "string" }, // "supports" | "partially supports" | "does not support" | "not applicable"
          notes:     { type: "string" }
        },
        required: ["criterion","result"]
      }
    }
  },
  required: ["criteria"]
};

function toEnum(s = "") {
  const x = s.toLowerCase();
  if (x.includes("does not")) return "does not support";
  if (x.includes("partial"))  return "partially supports";
  if (x.includes("support"))  return "supports";
  if (x.includes("not applicable") || x === "n/a" || x === "na") return "not applicable";
  return "partially supports";
}

router.post("/ai/vpat-extract", async (req, res) => {
  try {
    const { pdfBase64, pdfUrl } = req.body || {};
    if (!pdfBase64 && !pdfUrl) return res.status(400).json({ error: "Provide pdfBase64 or pdfUrl" });

    let inlinePart;
    if (pdfBase64) {
      const base64 = /^data:application\/pdf;base64,/i.test(pdfBase64) ? pdfBase64.split(",")[1] : pdfBase64;
      inlinePart = { inlineData: { mimeType: "application/pdf", data: base64 } };
    } else {
      const resp = await axios.get(pdfUrl, { responseType: "arraybuffer" });
      inlinePart = { inlineData: { mimeType: "application/pdf", data: Buffer.from(resp.data).toString("base64") } };
    }

    const { model } = getGemini();
    const out = await model.generateContent({
      contents: [{
        role: "user",
        parts: [
          { text: "Extract a simplified VPAT/ACR to JSON (fields: product?, criteria[{criterion, result, notes?}]). Return JSON only." },
          inlinePart
        ]
      }],
      safetySettings: DEFAULT_SAFETY,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema
      }
    });

    const json = JSON.parse(out.response.text());
    if (Array.isArray(json.criteria)) {
      json.criteria = json.criteria.map(c => ({
        criterion: String(c.criterion || "").trim(),
        result: toEnum(String(c.result || "")),
        notes: c.notes ? String(c.notes) : ""
      }));
    }
    res.json(json);
  } catch (e) {
    res.status(500).json({ error: e.message || "Gemini PDF extract error" });
  }
});
