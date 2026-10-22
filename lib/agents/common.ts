import type { Prefs } from "@/lib/prefs";
import type { Session } from "@/lib/session";

export const model = () => process.env.OPENAI_MODEL ?? "gpt-5";

export function context(history: Session["history"], prefs: Prefs) {
  const recent = history.slice(-10).map((h) => `${h.role}: ${h.text}`).join("\n") || "(none)";
  return `Recent chat:\n${recent}\n\nKnown preferences (JSON):\n${JSON.stringify(prefs)}`;
}
