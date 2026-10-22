# Movie Recommender Chatbot — Design

Date: 2026-10-22

## Intent

A chat app where the bot acts as an expert movie recommender. The user talks
in plain words ("something light for tonight, maybe like Paddington") and the
bot recommends real movies.

The hard part, and the main focus, is **getting as many TMDB search
parameters as possible out of the conversation** before recommending, while
never annoying the user with too many or dumb questions.

Recommendations are only as good as the filters. So the design puts most of
its effort into extraction and smart questioning, not into the UI.

## Goals

- Chat interface with a bot that feels like a movie-loving friend.
- Built on the OpenAI Agents SDK (TypeScript).
- Real movie data from TMDB, not from the model's memory.
- Per-session chat state: history, preferences, and movies already shown.
- Extract structured preferences from every message and turn them into TMDB
  queries.
- Ask a few smart questions when needed. Never irritate the user.

## Non-goals (for now)

- User accounts or login.
- Saving sessions across server restarts (no database yet).
- TV series. Movies only.
- IMDb, Rotten Tomatoes, or Metacritic scores (OMDb). Can be added later.
- Mobile app.

## Anti-goals (failure even if it "works")

- The bot asks question after question before showing anything.
- The bot asks about something the user already said.
- The bot recommends movies that do not exist, or invents details. Every
  recommended movie must come from a TMDB result.
- The bot repeats movies it already suggested in the same session.
- The bot ignores a stated dislike ("no horror") later in the session.

## Constraints and decided choices

- **Language:** TypeScript (user is comfortable with it).
- **Agent framework:** OpenAI Agents SDK for TypeScript (`@openai/agents`).
- **Movie data:** TMDB API (user chose it over OMDb, because OMDb can only
  search by title, while TMDB supports real filters).
- **App framework:** Next.js (App Router) + TypeScript. One project for the
  chat page and the server code. *(Builder's earlier call, accepted in the
  conversation.)*
- **Session storage:** in server memory, keyed by a session ID (cookie or
  client-generated ID). Lost on restart. That is fine for now.
- **Model provider:** Google Gemini (user has a Gemini key), used through the
  OpenAI Agents SDK via Gemini's OpenAI-compatible endpoint (Chat Completions).
  Model set by `GEMINI_MODEL`, default `gemini-2.5-flash`.
- **Secrets:** `GEMINI_API_KEY` and `TMDB_API_KEY` (or TMDB read access
  token) from environment variables. Never sent to the browser.
- **TMDB terms:** the app must show TMDB attribution (logo or text "This
  product uses the TMDB API but is not endorsed or certified by TMDB").
- `include_adult` is always `false`.
- **Region** *(builder's call)*: guess it from the browser's
  `Accept-Language` header (`en-GB` → `GB`), with `US` as the fallback. It is
  used for `watch_region`, `region`, and `certification_country`. The bot
  never asks about the region. If the user names a country, that one wins
  and is kept for the session.

## How it works

Each user message goes through these steps:

```
user message
   │
   ▼
1. Extractor agent ──► preferences delta (structured, plain names)
   │
   ▼
2. Merge delta into session preferences
   │
   ▼
3. Readiness check ──► enough info?  ──no──► ask ONE smart question
   │ yes                               (max 2 before first picks)
   ▼
4. Resolver (plain code): names → TMDB IDs
   │
   ▼
5. TMDB query (discover / similar / trending)
   │
   ▼
6. Filter out already-shown and seen movies
   │
   ▼
7. Recommender agent writes the reply from real TMDB results
   (+ optional one light follow-up question)
```

### 1. Extractor

A separate agent with a structured output type (Zod schema). It reads the new
message, the recent chat, and the current session preferences. It returns
only what **changed**: added, updated, or removed fields.

Values are in **human terms**, not TMDB IDs. Example shape (the builder may
adjust field names):

```ts
{
  genres: string[];            // "thriller"
  excludeGenres: string[];     // "horror"
  mood: string | null;         // "dark, tense"
  keywords: string[];          // "heist", "time travel"
  excludeKeywords: string[];
  yearFrom: number | null;
  yearTo: number | null;
  minRating: number | null;    // 0–10
  hiddenGem: boolean | null;   // high rating + low vote count
  actors: string[];
  directors: string[];
  companies: string[];         // "Pixar", "A24"
  maxRuntime: number | null;   // minutes
  minRuntime: number | null;
  originalLanguage: string | null; // "ko"
  originCountry: string | null;
  watchRegion: string | null;  // "US"
  providers: string[];         // "Netflix"
  monetization: ("flatrate"|"free"|"ads"|"rent"|"buy")[];
  kidSafe: boolean | null;     // maps to certification.lte
  maxCertification: string | null; // "PG-13"
  likeMovies: string[];        // "Heat"
  sortPreference: "popular"|"top_rated"|"newest"|null;
  seenMovies: string[];        // "seen it"
  removeFields: string[];      // "any decade is fine" → yearFrom, yearTo
}
```

**Mood → filters:** the extractor turns mood words into genres and keywords
("something light" → comedy, family; "mind-bending" → keywords like twist
ending, time loop). This is where much of the value is.

### 2. Merge

Plain code merges the delta into the session preferences. Newer statements
win. `removeFields` clears fields. Dislikes (`excludeGenres`,
`excludeKeywords`) stay for the whole session unless the user changes them.

### New search vs. refine

After the first picks, the extractor also decides if the message starts a
**new search** ("now something for the kids on Friday", "something else") or
**refines** the current one ("more like #2", "but newer").

- **Always kept** (about the person): `excludeGenres`, `excludeKeywords`,
  `providers`, `monetization`, `watchRegion`, `seenMovies`, shown movie IDs.
- **Cleared on a new search** (about the old search): genres, mood,
  keywords, years, rating, actors, directors, companies, runtime, language,
  country, certification, likeMovies, sortPreference, hiddenGem.
- **Refine:** list fields in the delta add to the stored lists, unless the
  extractor marks them as a replace ("not comedy, thriller instead").
- A new search allows **at most 1 question** before picks, not 2.

### 3. Readiness check and questioning

A simple weighted score decides if there is "enough" to recommend.

- High weight: genres or mood, likeMovies, era (years).
- Medium weight: actors/directors, keywords, providers.
- Low weight: runtime, language, rating, certification.

Rules:

- If the first message already has enough, **don't ask — recommend**.
- **At most 2 questions before the first recommendations.** After that,
  always recommend, even with gaps.
- **One question per message**, short and friendly.
- Pick the question that **fills the most fields at once**. Best ones:
  - "What's a movie you loved recently?" → one title gives genres,
    keywords, era, and similar movies via TMDB.
  - "What mood are you in tonight?" → genres, keywords, maybe runtime.
- **Never ask about a field already known** in this session.
- **Never ask about low-weight fields** unless the user brings them up.
- If the user says "just show me", "anything", or similar, recommend now.
- After recommendations, the bot may add **one light, optional follow-up**
  ("Want something newer, or are you on a specific streaming service?").

The exact weights and threshold are left to the builder, but must be easy to
tune (constants in one place).

### 4. Resolver (names → IDs)

Plain code, not the AI. Uses TMDB lookups:

- Genres: `/genre/movie/list` (cache once).
- Actors / directors: `/search/person`.
- Keywords: `/search/keyword`.
- Companies: `/search/company`.
- Providers: `/watch/providers/movie?watch_region=XX` (cache per region).
- "Like" movies: `/search/movie` → movie ID.

If a name can't be found, drop that filter and continue (don't fail the
reply). Cache lookups in memory.

### 5. TMDB query

Choose the endpoint from the preferences:

- `likeMovies` set *(builder's call)*:
  1. The resolver fetches the liked movie's details (`/movie/{id}` with
     keywords). Its genres, top keywords, and decade become **soft**
     preferences. They count toward readiness, but they never overwrite
     anything the user said directly.
  2. Call `/movie/{id}/recommendations`. Filter the results with the user's
     own hard filters, using only fields the list already has (genre IDs,
     release date, rating). No per-movie detail calls just for filtering.
  3. If fewer than 5 are left, fill up from `/discover/movie` using the
     user's filters plus the soft ones.
- Otherwise → `/discover/movie` with every filled filter.
- "What's popular now" with no other filters → `/trending/movie/week`.

Full `/discover/movie` filter list the code should support:
`with_genres`, `without_genres`, `primary_release_date.gte/.lte`, `year`,
`primary_release_year`, `release_date.gte/.lte`, `vote_average.gte/.lte`,
`vote_count.gte/.lte`, `with_cast`, `with_crew`, `with_people`,
`with_keywords`, `without_keywords`, `with_runtime.gte/.lte`,
`with_original_language`, `with_origin_country`, `with_watch_providers`,
`without_watch_providers`, `with_watch_monetization_types`, `watch_region`,
`certification`, `certification.gte/.lte`, `certification_country`,
`with_companies`, `without_companies`, `with_release_type`, `region`,
`sort_by`, `language`, `page`, `include_adult=false`.

Notes:
- Comma = AND, pipe = OR. Use OR for multiple genres from a mood, AND when
  the user clearly wants all of them.
- Use a minimum `vote_count.gte` by default (for example 100) so bad,
  unknown movies don't show up. Hidden gem mode lowers it and raises
  `vote_average.gte`.
- If the query returns too few results, relax the lowest-weight filters one
  at a time and try again.

### 6. Don't repeat

The session keeps a list of TMDB IDs already shown and movies marked as seen.
They are removed from results before the recommender sees them.

### 7. Recommender

An agent that gets the user's request, the preferences, and the filtered TMDB
results (with details from `/movie/{id}` where needed: runtime, overview,
watch providers). It picks about 3–5 movies and writes a short "why you'll
like it" for each. It must only use movies from the given results.

It also reads reactions in later messages ("too slow", "more like #2") via
the extractor, which updates the preferences without asking extra questions.

## Session state

Per session ID, in memory:

- chat history (for the agents)
- current preferences object
- question count before first picks
- shown movie IDs, seen movie IDs

## Chat UI

*(Builder's call — the user did not choose this.)*

- One page: message list + input box.
- Bot recommendations show as **movie cards**: poster, title, year, TMDB
  rating, one line "why", and where to watch if known.
- A "thinking" state while the bot works.
- TMDB attribution in the footer.

## Left to the builder

- Folder structure, component layout, and styling.
- Which OpenAI model to use (configurable through an env variable).
- Whether to use the Agents SDK's own session feature or a simple `Map` —
  either is fine if it meets the session rules above.
- Streaming the reply or sending it whole.
- Exact readiness weights and threshold.
- Error handling details (TMDB down, OpenAI error), as long as the user sees
  a friendly message and the session isn't lost.
- Tests: at least checks for the merge logic, the readiness check, and the
  preferences → TMDB query builder.
