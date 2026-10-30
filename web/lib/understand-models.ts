// Server-only: the models that can turn OCR text into invoice fields, tried in order.
// Each is free; when one is rate limited or fails, the next one takes over.
// Only providers with a key in .env.local are used.
import type { LanguageModel } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createGoogle } from "@ai-sdk/google";
import { openrouter } from "./providers";

export type UnderstandModel = { label: string; model: () => LanguageModel; vision: boolean; key: string };

export const UNDERSTAND_MODELS: UnderstandModel[] = [
  // free tier on Google AI Studio: 20 requests/day for this model; free-tier prompts may be used by Google
  { label: "Gemini 2.5 Flash · Google", model: () => createGoogle()("gemini-2.5-flash"), vision: true, key: "GOOGLE_GENERATIVE_AI_API_KEY" },
  // free on Groq: about 30 requests/min and 1,000/day; text only, which is fine because OCR already read the text
  { label: "GPT-OSS 120B · Groq", model: () => createGroq()("openai/gpt-oss-120b"), vision: false, key: "GROQ_API_KEY" },
  // free on OpenRouter: 50 requests/day across all free models (1,000/day after a one-time $10 top-up)
  { label: "Nemotron 3.5 Super VL · OpenRouter", model: () => openrouter("nvidia/nemotron-3.5-super-vl:free"), vision: true, key: "OPENROUTER_API_KEY" },
];

export const availableModels = () => UNDERSTAND_MODELS.filter((m) => process.env[m.key]);
