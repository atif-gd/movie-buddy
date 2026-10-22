import { Agent, run } from "@openai/agents";
import { context, model } from "@/lib/agents/common";
import { PrefsDelta, type Prefs } from "@/lib/prefs";
import type { Session } from "@/lib/session";

const INSTRUCTIONS = `You extract movie preferences from a chat for a TMDB search.
Output ONLY what the newest user message changes. Use [] or null for anything it does not change.

Rules:
- Use TMDB genre names: Action, Adventure, Animation, Comedy, Crime, Documentary, Drama, Family, Fantasy, History, Horror, Music, Mystery, Romance, Science Fiction, TV Movie, Thriller, War, Western.
- Turn mood words into genres and keywords. Examples: "light"/"feel-good" -> Comedy, Family; "mind-bending" -> keywords "twist ending", "time loop"; "scary" -> Horror; "tear-jerker" -> Drama; "date night" -> Romance, Comedy. Also put the mood words in "mood".
- Dislikes ("no horror", "not into musicals") go in excludeGenres / excludeKeywords.
- "seen it", "not that one", "seen the first one": put the matching titles from "Last shown picks" in seenMovies.
- "more like #2" / "like the second one": put that title from "Last shown picks" in likeMovies.
- Decades: "90s" -> yearFrom 1990, yearTo 1999. "recent"/"new" -> yearFrom = current year - 3.
- "kids", "family night" -> kidSafe true. "hidden gem", "underrated" -> hiddenGem true.
- Streaming services go in providers ("Netflix", "Amazon Prime Video", "Disney Plus").
- watchRegion only when the user names a country (ISO 3166-1 code, e.g. "GB").
- originalLanguage as ISO 639-1 ("korean movie" -> "ko").
- If the user changes their mind about a list ("not comedy, thriller instead"), put the new value and add the field name to replaceFields. If they drop a constraint ("any decade is fine"), add the fields to removeFields.
- intent:
  - "just_show" for "just show me", "anything", "surprise me", "whatever".
  - "new_search" ONLY when picks were already shown and the user clearly wants a different kind of movie now.
  - "refine" when they add to or adjust the current search.
  - "other" for small talk.`;

export async function extractDelta(input: {
  message: string;
  history: Session["history"];
  prefs: Prefs;
  shownTitles: string[];
  hasRecommended: boolean;
}): Promise<PrefsDelta> {
  const agent = new Agent({ name: "Preference extractor", instructions: INSTRUCTIONS, model: model(), outputType: PrefsDelta });
  const prompt = `${context(input.history, input.prefs)}

Picks already shown: ${input.hasRecommended ? "yes" : "no"}
Last shown picks (in order): ${input.shownTitles.map((t, i) => `#${i + 1} ${t}`).join(", ") || "(none)"}
Current year: ${new Date().getFullYear()}

Newest user message: ${input.message}`;
  const result = await run(agent, prompt);
  if (!result.finalOutput) throw new Error("extractor returned no output");
  return result.finalOutput;
}
