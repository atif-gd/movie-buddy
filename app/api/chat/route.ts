import { extractDelta } from "@/lib/agents/extractor";
import { writePicks, writeQuestion } from "@/lib/agents/reply";
import { handleMessage, type ChatReply } from "@/lib/chat";
import { regionFromAcceptLanguage } from "@/lib/region";
import { getSession } from "@/lib/session";
import { tmdbGet } from "@/lib/tmdb/client";

const deps = { extract: extractDelta, question: writeQuestion, picks: writePicks, get: tmdbGet };

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
  if (!message || message.length > 1000 || !sessionId || sessionId.length > 100) {
    return Response.json({ error: "message (1-1000 chars) and sessionId are required" }, { status: 400 });
  }

  const session = getSession(sessionId, regionFromAcceptLanguage(req.headers.get("accept-language")));
  try {
    return Response.json(await handleMessage(session, message, deps));
  } catch (err) {
    console.error("chat failed", err);
    const reply: ChatReply = { message: "Sorry, something went wrong on my side. Please try again.", movies: [], followUp: null };
    return Response.json(reply);
  }
}
