import { setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from "@openai/agents";
import OpenAI from "openai";
import type { Prefs } from "@/lib/prefs";
import type { Session } from "@/lib/session";

// The Agents SDK talks to Gemini through Google's OpenAI-compatible endpoint.
// Gemini supports Chat Completions there (not the Responses API), and tracing
// would upload to OpenAI, so it is off.
let configured = false;
function useGemini() {
  if (configured) return;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  setDefaultOpenAIClient(new OpenAI({ apiKey, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" }));
  setOpenAIAPI("chat_completions");
  setTracingDisabled(true);
  configured = true;
}

export const model = () => {
  useGemini();
  return process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
};

export function context(history: Session["history"], prefs: Prefs) {
  const recent = history.slice(-10).map((h) => `${h.role}: ${h.text}`).join("\n") || "(none)";
  return `Recent chat:\n${recent}\n\nKnown preferences (JSON):\n${JSON.stringify(prefs)}`;
}
