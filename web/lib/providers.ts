// Server-only: OpenRouter through the AI SDK's OpenAI-compatible provider, and readable provider errors.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, RetryError } from "ai";

export const openrouter = createOpenAICompatible({
  name: "openrouter",
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  includeUsage: true,
});

/** A readable reason from any provider's error (OpenRouter puts the real cause in error.metadata.raw). */
export function describeError(err: unknown): string {
  const e = RetryError.isInstance(err) ? err.lastError : err;
  if (APICallError.isInstance(e)) {
    let detail = "";
    try {
      const body = JSON.parse(e.responseBody ?? "{}");
      detail = body.error?.metadata?.raw ?? body.error?.message ?? "";
    } catch {}
    if (e.statusCode === 429) return `Rate limited${detail ? `: ${detail.split(". ")[0]}` : " (free tier cap); try again shortly"}`;
    return detail || e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
