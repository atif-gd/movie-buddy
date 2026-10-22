import type { extractDelta } from "@/lib/agents/extractor";
import type { Topic, writePicks, writeQuestion } from "@/lib/agents/reply";
import { mergePrefs } from "@/lib/prefs";
import { nextQuestionTopic, score, THRESHOLD } from "@/lib/readiness";
import { findCandidates } from "@/lib/search";
import type { Session } from "@/lib/session";
import type { TmdbGet } from "@/lib/tmdb/client";
import { resolvePrefs } from "@/lib/tmdb/resolve";

export type MovieCard = {
  id: number;
  title: string;
  year: string;
  posterUrl: string | null;
  rating: number;
  why: string;
  providers: string[];
};
export type ChatReply = { message: string; movies: MovieCard[]; followUp: string | null };
export type Deps = { extract: typeof extractDelta; question: typeof writeQuestion; picks: typeof writePicks; get: TmdbGet };

const MAX_PICKS = 5;
const NO_MATCH = "I couldn't find a match for all of that. Want to loosen something, like the year or the streaming service?";
const TRENDING = /trending|popular (right )?now|what'?s hot/i;
const FALLBACK_QUESTION = {
  likeMovie: "What's a movie you loved recently?",
  mood: "What kind of mood are you in?",
  era: "Do you want something newer or older?",
  smallTalk: "Happy to help! Want a few more picks?",
};

// Works on a copy and writes it back only on success, so a failed turn leaves the session as it was.
export async function handleMessage(session: Session, text: string, deps: Deps): Promise<ChatReply> {
  const s = structuredClone(session);

  const delta = await deps.extract({
    message: text, history: s.history, prefs: s.prefs, shownTitles: s.lastPicks, hasRecommended: s.hasRecommended,
  });
  s.prefs = mergePrefs(s.prefs, delta);
  if (s.prefs.watchRegion) s.region = s.prefs.watchRegion;
  if (delta.intent === "new_search") {
    s.soft = null;
    s.questionsAsked = 0;
    s.questionLimit = 1;
  }

  const resolved = await resolvePrefs(s.prefs, s.region, deps.get);
  s.soft = resolved.soft;
  const ready = score(s.prefs, resolved.soft) >= THRESHOLD;

  const ask = async (topic: Topic): Promise<ChatReply> => {
    const text = (await deps.question({ topic, history: s.history, prefs: s.prefs })).trim();
    return { message: text || FALLBACK_QUESTION[topic], movies: [], followUp: null };
  };

  let reply: ChatReply;
  if (delta.intent === "other" && s.hasRecommended) {
    reply = await ask("smallTalk");
  } else if (delta.intent !== "just_show" && !ready && s.questionsAsked < s.questionLimit) {
    reply = await ask(nextQuestionTopic(s.prefs));
    s.questionsAsked++;
  } else {
    const trending = TRENDING.test(text) && score(s.prefs, resolved.soft) === 0;
    const { movies: candidates, relaxed } = await findCandidates(
      s.prefs, resolved, { region: s.region, excludeIds: [...s.shownIds, ...s.seenIds], trending }, deps.get,
    );
    const seen = new Set(s.prefs.seenMovies.map((t) => t.toLowerCase()));
    s.seenIds.push(...candidates.filter((m) => seen.has(m.title.toLowerCase())).map((m) => m.id));
    const usable = candidates.filter((m) => !seen.has(m.title.toLowerCase()));

    if (!usable.length) {
      reply = { message: NO_MATCH, movies: [], followUp: null };
    } else {
      const out = await deps.picks({ message: text, history: s.history, prefs: s.prefs, candidates: usable, relaxed });
      const byId = new Map(usable.map((m) => [m.id, m]));
      const kept = out.picks.filter((p, i, all) => byId.has(p.id) && all.findIndex((q) => q.id === p.id) === i).slice(0, MAX_PICKS);
      const movies = await Promise.all(
        kept.map(async ({ id, why }): Promise<MovieCard> => {
          const m = byId.get(id)!;
          // Providers are a nice-to-have: a failed detail call must not lose the picks.
          const details = await deps.get(`/movie/${id}`, { append_to_response: "watch/providers" }).catch(() => null);
          const flatrate: { provider_name: string }[] = details?.["watch/providers"]?.results?.[s.region]?.flatrate ?? [];
          return {
            id, title: m.title, year: m.release_date?.slice(0, 4) ?? "", rating: m.vote_average, why,
            posterUrl: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
            providers: flatrate.map((p) => p.provider_name),
          };
        }),
      );
      reply = movies.length ? { message: out.message, movies, followUp: out.followUp } : { message: NO_MATCH, movies: [], followUp: null };
      s.shownIds.push(...movies.map((m) => m.id));
      s.shownTitles.push(...movies.map((m) => m.title));
      if (movies.length) s.lastPicks = movies.map((m) => m.title);
      s.hasRecommended ||= movies.length > 0;
    }
  }

  const titles = reply.movies.map((m) => `${m.title} (${m.year})`).join(", ");
  s.history.push(
    { role: "user", text },
    { role: "assistant", text: [reply.message, titles && `Picks: ${titles}`, reply.followUp].filter(Boolean).join("\n") },
  );
  Object.assign(session, s);
  return reply;
}
