import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { context, model } from "@/lib/agents/common";
import type { Prefs } from "@/lib/prefs";
import type { Session } from "@/lib/session";
import type { TmdbMovie } from "@/lib/tmdb/client";

const VOICE = "You are a warm, movie-loving friend who is an expert at recommendations. Keep it short and natural.";

const TOPIC_HINTS = {
  likeMovie: "ask about a movie they loved recently",
  mood: "ask what mood they are in",
  era: "ask if they want something newer or older, any decade they like",
  smallTalk: "they already got picks and are just chatting; reply in one or two short sentences, and you may offer more picks",
};
export type Topic = keyof typeof TOPIC_HINTS;

export async function writeQuestion(input: {
  topic: Topic;
  history: Session["history"];
  prefs: Prefs;
}): Promise<string> {
  const agent = new Agent({
    name: "Question writer",
    model: model(),
    instructions: `${VOICE}
Write ONE short, friendly message for the task below. If you ask something, ask one question with no list of options.
Never ask about something already in the known preferences. Do not name or recommend specific movies.`,
  });
  const result = await run(agent, `${context(input.history, input.prefs)}\n\nTask: ${TOPIC_HINTS[input.topic]}.`);
  return String(result.finalOutput ?? "").trim();
}

const RELAXED_NOTE =
  "NOTE: there were not enough exact matches, so some filters were loosened. Some candidates do NOT match everything the user asked for. Say this briefly in \"message\" and never claim a match that isn't there.\n\n";

export const Picks = z.object({
  message: z.string(),
  picks: z.array(z.object({ id: z.number().int(), why: z.string() })),
  followUp: z.string().nullable(),
});
export type Picks = z.infer<typeof Picks>;

export async function writePicks(input: {
  message: string;
  history: Session["history"];
  prefs: Prefs;
  candidates: TmdbMovie[];
  relaxed: boolean;
}): Promise<Picks> {
  const agent = new Agent({
    name: "Recommender",
    model: model(),
    outputType: Picks,
    instructions: `${VOICE}
Pick 3 to 5 movies ONLY from the candidate list, by their id. Never invent a movie.
For each pick, write one sentence "why" tied to what the user asked for.
"message" is a short intro line (do not list the movies in it).
"followUp" is one optional light question that would improve the next picks (for example a streaming service or newer vs older), or null. Never ask about something already known.`,
  });
  const candidates = input.candidates.map((m) => ({
    id: m.id, title: m.title, year: m.release_date?.slice(0, 4), rating: m.vote_average, overview: m.overview,
  }));
  const result = await run(
    agent,
    `${context(input.history, input.prefs)}\n\nUser message: ${input.message}\n\n${input.relaxed ? RELAXED_NOTE : ""}Candidates (JSON):\n${JSON.stringify(candidates)}`,
  );
  if (!result.finalOutput) throw new Error("recommender returned no output");
  return result.finalOutput;
}
