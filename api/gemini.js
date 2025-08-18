import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/generative-ai";

export const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
export const DEFAULT_SYSTEM =
  process.env.GEMINI_SYSTEM ||
  "You are a university accessibility specialist. Be concise, map to WCAG, and do not provide legal advice.";

export const DEFAULT_SAFETY = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  // add more categories if needed
];

export function getGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // library accepts apiKey as ctor param in this codebase
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: DEFAULT_SYSTEM,
  });

  return { model };
}

/**
 * Resilient wrapper around model.generateContent with exponential backoff + jitter.
 * Retries on 5xx, 429, and common "overloaded"/transient messages.
 */
export async function generateWithRetry(model, requestOptions, opts = {}) {
  const {
    retries = 4,      // total retry attempts
    baseDelay = 1000, // initial ms
    jitter = 300,
  } = opts;

  let attempt = 0;
  let lastErr = null;

  while (attempt <= retries) {
    try {
      return await model.generateContent(requestOptions);
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || "").toLowerCase();
      const status = err?.response?.status || err?.statusCode || 0;
      const isRetryable =
        status >= 500 ||
        status === 429 ||
        /overload|unavailable|temporar(y|ily)|timeout|rate limit/.test(msg);

      if (!isRetryable || attempt === retries) break;

      const delay = Math.floor(baseDelay * Math.pow(2, attempt) + Math.random() * jitter);
      console.warn(`Gemini request failed (attempt ${attempt + 1}/${retries}). Retrying in ${delay}ms.`, msg);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }

  throw lastErr || new Error("Unknown error from Gemini");
}
