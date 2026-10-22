# Movie Recommender Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Next.js chat app where an expert movie bot pulls TMDB filters out of the conversation, asks at most a few smart questions, and recommends real TMDB movies as cards.

**Architecture:** Each message runs a pipeline in `lib/chat.ts`: extractor agent (structured delta) → plain-code merge → readiness check → either one question, or resolve names to TMDB IDs → TMDB search with relaxing → reply agent picks from real results → cards. All logic outside the two agents is plain, unit-tested TypeScript. The pipeline takes its agents and TMDB client as injected functions, so it is tested with fakes.

**Tech Stack:** Next.js (App Router) + TypeScript, `@openai/agents`, `zod` (the version `@openai/agents` asks for as a peer dependency), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-movie-recommender-design.md`

## Global Constraints

- TypeScript everywhere. No database. Sessions live in server memory.
- `OPENAI_API_KEY`, `TMDB_API_KEY` (v3 key, sent as `api_key` query param) and `OPENAI_MODEL` (default `gpt-5`) come from env. They are only read in server code and are never sent to the browser.
- `include_adult=false` on every TMDB discover call.
- Every recommended movie must be a TMDB result. Reply-agent picks whose ID is not in the given results are dropped.
- Movies already shown or marked as seen in the session are never shown again.
- At most 2 questions before the first picks, and at most 1 after a new search.
- Region comes from `Accept-Language` (`en-GB` → `GB`), with `US` as the fallback. A country the user names wins. The bot never asks about the region.
- The footer shows exactly: `This product uses the TMDB API but is not endorsed or certified by TMDB.`
- Agent output schemas: every field is required, and "unknown" is `null` or `[]`, never `.optional()`. OpenAI strict structured output rejects optional fields.

## Review Focus

1. **Liked movie can't be found** ("like Blorptastic") → drop that filter and still recommend from the other prefs. Test in Task 4.
2. **Results are empty after all filters** → relax low-weight filters, but never relax exclusions, certification (kid-safe), or providers. If there are still 0 results, send a friendly "couldn't find a match" reply with no cards. Tests in Tasks 5 and 8.
3. **The reply agent invents or repeats a movie** → any pick ID not in the candidate list, or already shown, is dropped. Test in Task 8.
4. **The user says "just show me" on the first message** with empty prefs → recommend (discover by popularity), and don't ask. Test in Task 8.
5. **The TMDB or OpenAI call throws** → the API returns 200 with a friendly error message, and the session (prefs, history) is not changed by the failed turn. Test in Task 8.

---

## File Structure

```
package.json, tsconfig.json, next.config.ts, vitest.config.ts, .env.example, .gitignore
lib/prefs.ts            Prefs type, PrefsDelta zod schema, emptyPrefs, mergePrefs
lib/readiness.ts        WEIGHTS, THRESHOLD, score, nextQuestionTopic
lib/region.ts           regionFromAcceptLanguage
lib/session.ts          Session type, getSession (in-memory Map)
lib/tmdb/client.ts      tmdbGet + TmdbMovie type
lib/tmdb/resolve.ts     resolvePrefs: names → IDs, liked-movie soft prefs
lib/tmdb/query.ts       buildDiscoverParams, RELAX_ORDER
lib/search.ts           findCandidates: like / discover / trending + relax + dedupe
lib/agents/extractor.ts extractDelta (Agent + outputType PrefsDelta)
lib/agents/reply.ts     writeQuestion, writePicks (Agent + outputType)
lib/chat.ts             handleMessage pipeline (deps injected)
app/api/chat/route.ts   POST handler, wires real deps
app/page.tsx, app/components/{Chat,MovieCard}.tsx, app/layout.tsx
tests/*.test.ts
```

---

### Task 1: Project setup

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `.gitignore`, `app/layout.tsx`, `app/page.tsx`, `tests/smoke.test.ts`

- [ ] **Step 1:** Run `git init` in the project root. The folder is not a git repo yet.
- [ ] **Step 2:** Scaffold with `npx create-next-app@latest . --ts --app --eslint --no-tailwind --no-src-dir --import-alias "@/*"`. Then run `npm i @openai/agents zod` and `npm i -D vitest`. Add `"test": "vitest run"` to the scripts.
- [ ] **Step 3:** Make `vitest.config.ts` use `@` → project root, and `environment: "node"`.
- [ ] **Step 4:** Write `.env.example` with `OPENAI_API_KEY=`, `TMDB_API_KEY=`, `OPENAI_MODEL=gpt-5`. Make sure `.gitignore` covers `.env*.local` and `.env`.
- [ ] **Step 5:** Write `tests/smoke.test.ts` with `expect(1).toBe(1)`. Run `npm test`. Expected: 1 passed. Run `npm run build`. Expected: success.
- [ ] **Step 6:** Commit: `chore: scaffold next.js app with vitest`

### Task 2: Preferences and merge

**Files:**
- Create: `lib/prefs.ts`
- Test: `tests/prefs.test.ts`

**Interfaces:**
- Produces:
  - `type Prefs`. Fields as in spec §1: `genres, excludeGenres, keywords, excludeKeywords, actors, directors, companies, providers, likeMovies, seenMovies: string[]`; `mood, originalLanguage, originCountry, watchRegion, maxCertification: string | null`; `yearFrom, yearTo, minRating, minRuntime, maxRuntime: number | null`; `hiddenGem, kidSafe: boolean | null`; `monetization: ("flatrate"|"free"|"ads"|"rent"|"buy")[]`; `sortPreference: "popular"|"top_rated"|"newest"|null`.
  - `const PrefsDelta` (zod). Same fields, every scalar `.nullable()` (null = no change), every list a plain array (`[]` = no change). Plus `intent: "new_search"|"refine"|"just_show"|"other"`, `replaceFields: string[]` (list fields to replace, not add to), and `removeFields: string[]` (fields to clear). `type PrefsDelta = z.infer<...>`.
  - `emptyPrefs(): Prefs`
  - `PERSON_FIELDS: (keyof Prefs)[]` = `excludeGenres, excludeKeywords, providers, monetization, watchRegion, seenMovies`
  - `mergePrefs(prefs: Prefs, delta: PrefsDelta): Prefs` (pure)

- [ ] **Step 1: Write failing tests** in `tests/prefs.test.ts`:
  - `scalar set`: `mergePrefs(emptyPrefs(), {...noChange, yearFrom: 1990}).yearFrom === 1990`
  - `null keeps old`: prefs with `yearFrom 1990` + delta `yearFrom: null` → still `1990`
  - `lists add and dedupe (case-insensitive)`: genres `["comedy"]` + delta `["Comedy","drama"]` → `["comedy","drama"]`
  - `replaceFields replaces`: genres `["comedy"]` + delta genres `["thriller"]`, `replaceFields:["genres"]` → `["thriller"]`
  - `removeFields clears`: `removeFields:["yearFrom","yearTo"]` → both `null`; a list field → `[]`
  - `new_search keeps person fields only`: prefs with genres, actors, likeMovies, excludeGenres `["horror"]`, providers `["Netflix"]` + delta `intent:"new_search"`, genres `["family"]` → genres `["family"]`, actors `[]`, likeMovies `[]`, excludeGenres `["horror"]`, providers `["Netflix"]`
  - Use a test helper `noChange(): PrefsDelta` (all null / `[]`, intent `"refine"`).
- [ ] **Step 2:** Run `npx vitest run tests/prefs.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `lib/prefs.ts`. For `new_search`: start from `emptyPrefs()` with `PERSON_FIELDS` copied over, then apply the delta.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: preferences schema and merge`

### Task 3: Readiness, region, session

**Files:**
- Create: `lib/readiness.ts`, `lib/region.ts`, `lib/session.ts`
- Test: `tests/readiness.test.ts`, `tests/region.test.ts`

**Interfaces:**
- Consumes: `Prefs` (Task 2)
- Produces:
  - `WEIGHTS` and `THRESHOLD = 3` exported from `lib/readiness.ts`. Weights: high 3 (`genres` or `mood` counted once, `likeMovies`, era = `yearFrom` or `yearTo` counted once); medium 2 (`actors`, `directors`, `keywords`, `providers`); low 1 (`minRating`, `minRuntime`/`maxRuntime` once, `originalLanguage`, `maxCertification`/`kidSafe` once, `companies`, `hiddenGem`).
  - `score(prefs: Prefs, soft?: SoftPrefs): number`. Soft genres or keywords count as genres (3).
  - `nextQuestionTopic(prefs: Prefs): "likeMovie" | "mood" | "era"`. Order: `likeMovie` if likeMovies and genres/mood are both empty, else `mood` if genres and mood are empty, else `era`.
  - `regionFromAcceptLanguage(header: string | null): string`
  - `type SoftPrefs = { genreIds: number[]; keywordIds: number[]; yearFrom: number | null; yearTo: number | null }`. Defined in `lib/session.ts`.
  - `type Session = { id: string; history: {role:"user"|"assistant"; text:string}[]; prefs: Prefs; soft: SoftPrefs | null; questionsAsked: number; questionLimit: number; hasRecommended: boolean; shownIds: number[]; seenIds: number[]; region: string }`
  - `getSession(id: string, region: string): Session`. Creates one with `questionLimit: 2` if missing. Store is a module-level `Map` on `globalThis`, so it survives Next dev hot reload.

- [ ] **Step 1: Write failing tests**:
  - `score(emptyPrefs()) === 0`
  - "funny 90s Jim Carrey" prefs (genres comedy, yearFrom 1990, yearTo 1999, actors) → `score >= THRESHOLD`
  - only `maxRuntime: 120` → `score < THRESHOLD`
  - `nextQuestionTopic(emptyPrefs()) === "likeMovie"`; with genres set → `"era"`
  - region: `"en-GB,en;q=0.9"` → `"GB"`; `"de"` → `"US"`; `null` → `"US"`; `"pt-br"` → `"BR"`
- [ ] **Step 2:** Run `npx vitest run tests/readiness.test.ts tests/region.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the three files.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: readiness score, region, session store`

### Task 4: TMDB client and resolver

**Files:**
- Create: `lib/tmdb/client.ts`, `lib/tmdb/resolve.ts`
- Test: `tests/resolve.test.ts`

**Interfaces:**
- Consumes: `Prefs`, `SoftPrefs`
- Produces:
  - `type TmdbGet = (path: string, params?: Record<string, string | number | boolean>) => Promise<any>`
  - `tmdbGet: TmdbGet`. Base `https://api.themoviedb.org/3`. Adds `api_key`. Throws on non-2xx.
  - `type TmdbMovie = { id: number; title: string; release_date: string; vote_average: number; vote_count: number; genre_ids: number[]; poster_path: string | null; overview: string }`
  - `type Resolved = { genreIds: number[]; excludeGenreIds: number[]; keywordIds: number[]; excludeKeywordIds: number[]; castIds: number[]; crewIds: number[]; companyIds: number[]; providerIds: number[]; likeMovieIds: number[]; soft: SoftPrefs | null }`
  - `resolvePrefs(prefs: Prefs, region: string, get: TmdbGet): Promise<Resolved>`

- [ ] **Step 1: Write failing tests** with a fake `get` that maps paths to canned JSON:
  - genre names map case-insensitively via `/genre/movie/list` (`"Comedy"` → 35). Mood is not resolved here, because the extractor already turned it into genres and keywords.
  - actor `"Jim Carrey"` → first `/search/person` result ID goes in `castIds`; director → `crewIds`
  - keyword → first `/search/keyword` result. Provider `"Netflix"` matches `provider_name` from `/watch/providers/movie?watch_region=US` (case-insensitive) → 8
  - `likeMovies:["Heat"]` → `/search/movie` ID in `likeMovieIds`. `soft` gets the genres from `/movie/{id}`, the top 5 keyword IDs from `/movie/{id}/keywords`, and the decade of the release year (1995 → 1990–1999).
  - **Review Focus 1:** a name with empty search results is dropped, and the other IDs are still returned (no throw)
  - genre list and provider list are fetched only once across two `resolvePrefs` calls (count calls on the fake)
- [ ] **Step 2:** Run `npx vitest run tests/resolve.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Cache genre and provider lists, and the name→ID results, in module-level `Map`s. Export `__resetCache()` for tests.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: tmdb client and name-to-id resolver`

### Task 5: Discover query builder

**Files:**
- Create: `lib/tmdb/query.ts`
- Test: `tests/query.test.ts`

**Interfaces:**
- Consumes: `Prefs`, `Resolved`
- Produces:
  - `buildDiscoverParams(prefs: Prefs, r: Resolved, region: string, relaxLevel = 0): Record<string, string | number | boolean>`
  - `RELAX_ORDER = ["minRating", "runtime", "language", "keywords", "years", "people", "genres"] as const`. Level n drops the first n groups. Never drops: exclusions, certification, providers, monetization.
  - `MAX_RELAX = RELAX_ORDER.length`

- [ ] **Step 1: Write failing tests**:
  - always `include_adult: false`, `language: "en-US"`, `region`, `vote_count.gte: 100`
  - genres `[35,878]` → `with_genres: "35|878"` (OR); cast IDs → `with_cast` joined with `,` (AND); exclude → `without_genres` with `,`
  - `yearFrom 1990, yearTo 1999` → `primary_release_date.gte: "1990-01-01"`, `.lte: "1999-12-31"`; soft years are used only when the user's years are null
  - soft `genreIds` are used in `with_genres` only when `r.genreIds` is empty
  - `hiddenGem: true` → `vote_count.gte: 50`, `vote_count.lte: 1000`, `vote_average.gte: 7.0` (unless minRating is higher)
  - `kidSafe: true` → `certification_country: region`, `certification.lte: "PG"`. `maxCertification` wins if set.
  - providers → `with_watch_providers` with `|`, `watch_region: region`. Monetization → `with_watch_monetization_types` with `|`.
  - sort: `popular` → `popularity.desc`, `top_rated` → `vote_average.desc` (with `vote_count.gte` 300), `newest` → `primary_release_date.desc`. Default is `popularity.desc`.
  - **Review Focus 2:** `relaxLevel = MAX_RELAX` still has `without_genres`, `certification.lte`, `with_watch_providers`, but no `with_genres` or `vote_average.gte`
- [ ] **Step 2:** Run `npx vitest run tests/query.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as a pure function.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: discover query builder with relaxing`

### Task 6: Candidate search

**Files:**
- Create: `lib/search.ts`
- Test: `tests/search.test.ts`

**Interfaces:**
- Consumes: `buildDiscoverParams`, `RELAX_ORDER`/`MAX_RELAX`, `Resolved`, `TmdbGet`, `TmdbMovie`
- Produces: `findCandidates(prefs: Prefs, r: Resolved, opts: { region: string; excludeIds: number[]; trending: boolean }, get: TmdbGet): Promise<TmdbMovie[]>`. Returns up to 20 movies.

- [ ] **Step 1: Write failing tests**:
  - `opts.trending` → calls `/trending/movie/week` only
  - `likeMovieIds:[949]` → calls `/movie/949/recommendations`, then keeps only results matching the user's hard genre / exclude-genre / year / minRating filters (fields on the list item only)
  - if fewer than 5 are left after the like step → fills up from `/discover/movie`, with no duplicate IDs
  - `excludeIds` are never in the output, and the like-movie itself is never in the output
  - discover with fewer than 5 results → retries with `relaxLevel` 1, 2, … up to `MAX_RELAX`, and stops early once there are ≥ 5
  - all levels empty → returns `[]` (no throw)
- [ ] **Step 2:** Run `npx vitest run tests/search.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: candidate search with like/discover/trending`

### Task 7: Agents

**Files:**
- Create: `lib/agents/extractor.ts`, `lib/agents/reply.ts`

**Interfaces:**
- Consumes: `PrefsDelta`, `Prefs`, `Session["history"]`, `TmdbMovie`
- Produces:
  - `extractDelta(input: { message: string; history: Session["history"]; prefs: Prefs; shownTitles: string[]; hasRecommended: boolean }): Promise<PrefsDelta>`
  - `writeQuestion(input: { topic: "likeMovie"|"mood"|"era"; history: Session["history"]; prefs: Prefs }): Promise<string>`
  - `const Picks = z.object({ message: z.string(), picks: z.array(z.object({ id: z.number(), why: z.string() })), followUp: z.string().nullable() })`
  - `writePicks(input: { message: string; history: Session["history"]; prefs: Prefs; candidates: TmdbMovie[] }): Promise<z.infer<typeof Picks>>`

Each agent is `new Agent({ name, instructions, model: process.env.OPENAI_MODEL ?? "gpt-5", outputType })`, run with `run(agent, inputText)`, and its result is read from `result.finalOutput`. The input text is a plain prompt with the history (last 10 turns), the prefs as JSON, and the new message.

Instructions must say:
- **Extractor:** output only what changed. Map mood words to genres and keywords (examples: "light" → comedy, family; "mind-bending" → keywords "twist ending", "time loop"; "scary" → horror). Map "seen it" / "not that one" to `seenMovies` using `shownTitles`. Map "more like #2" to `likeMovies: [shownTitles[1]]`. `intent`: `new_search` only after recommendations, when the user clearly wants a different kind of movie; `just_show` for "just show me", "anything", "surprise me". Set `watchRegion` only if the user names a country (ISO 3166-1 code). Use TMDB genre names.
- **writeQuestion:** one short, friendly question about the topic, with no list of options. Never ask about something already in prefs. Topic hints: likeMovie → "a movie you loved recently"; mood → "what mood you're in"; era → "newer or older, any decade you like".
- **writePicks:** pick 3–5 movies **only from the candidates by `id`**. Write one sentence "why" for each, tied to what the user said. `message` is a short intro. `followUp` is one optional light question about a missing medium-weight field (null if none).

- [ ] **Step 1:** Implement both files.
- [ ] **Step 2:** Run `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 3:** Write `scripts/try-extractor.ts`, which calls `extractDelta` on `"a funny 90s movie with Jim Carrey, no horror"` and prints the result. Run `npx tsx --env-file=.env.local scripts/try-extractor.ts`. Expected: genres include comedy, years 1990/1999, actors include Jim Carrey, excludeGenres include horror. *(Needs a real key. If no key is available, skip and say so.)*
- [ ] **Step 4:** Commit: `feat: extractor and reply agents`

### Task 8: Chat pipeline

**Files:**
- Create: `lib/chat.ts`
- Test: `tests/chat.test.ts`

**Interfaces:**
- Consumes: everything above
- Produces:
  - `type MovieCard = { id: number; title: string; year: string; posterUrl: string | null; rating: number; why: string; providers: string[] }`
  - `type ChatReply = { message: string; movies: MovieCard[]; followUp: string | null }`
  - `type Deps = { extract: typeof extractDelta; question: typeof writeQuestion; picks: typeof writePicks; get: TmdbGet }`
  - `handleMessage(session: Session, text: string, deps: Deps): Promise<ChatReply>`

Flow (it changes the session only at the end, after success):
1. `delta = extract(...)`. `prefs = mergePrefs(session.prefs, delta)`. If `delta.watchRegion` is set, use it as the region. On `new_search`: set `soft = null`, `questionsAsked = 0`, `questionLimit = 1`.
2. `resolved = resolvePrefs(prefs, region, get)`.
3. If `delta.intent !== "just_show"` and `score(prefs, resolved.soft) < THRESHOLD` and `questionsAsked < questionLimit` → reply with `question({ topic: nextQuestionTopic(prefs) })`, no movies, and `questionsAsked++`.
4. Otherwise `findCandidates` with `excludeIds = shownIds ∪ seenIds`, and `trending` when the message matches `/trending|popular (right )?now|what'?s hot/i` and the prefs score is 0.
5. 0 candidates → message `"I couldn't find a match for all of that. Want to loosen something, like the year or the streaming service?"`, no movies.
6. `picks(...)`. Keep only picks whose `id` is in the candidates (max 5). For each kept pick, `get("/movie/{id}", { append_to_response: "watch/providers" })`, and take `results[region].flatrate` provider names. Poster: `https://image.tmdb.org/t/p/w342{poster_path}`.
7. Save: prefs, soft, history (+ user and assistant text), shownIds (+ kept IDs), seenIds (+ IDs of candidates whose title is in `prefs.seenMovies`), `hasRecommended = true`.

- [ ] **Step 1: Write failing tests** with fake deps:
  - empty prefs, message "recommend me a movie" → question returned, `movies: []`, `questionsAsked === 1`
  - third vague message (after 2 questions) → movies returned even with a low score
  - **Review Focus 4:** first message with extractor intent `just_show` and empty prefs → movies, and `question` is never called
  - high-score first message → movies on the first turn, and `question` is never called
  - **Review Focus 3:** the picks fake returns IDs `[1, 999]`, where 999 is not in the candidates → only movie 1 returned. A second turn never returns 1 again (it is in `shownIds`).
  - new_search after picks → `questionLimit === 1`, `questionsAsked === 0`, and `excludeGenres` kept
  - **Review Focus 2:** search returns `[]` → the friendly no-match message and no movies
  - **Review Focus 5:** `get` throws → `handleMessage` rejects, and `session.prefs` and `session.history` are unchanged (deep equal to before)
- [ ] **Step 2:** Run `npx vitest run tests/chat.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `handleMessage`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat: chat pipeline with question gating`

### Task 9: API route and chat UI

**Files:**
- Create: `app/api/chat/route.ts`, `app/components/Chat.tsx`, `app/components/MovieCard.tsx`
- Modify: `app/page.tsx`, `app/layout.tsx`

**Interfaces:**
- Consumes: `handleMessage`, `getSession`, `regionFromAcceptLanguage`, real agents, `tmdbGet`, `ChatReply`
- Produces: `POST /api/chat` with body `{ sessionId: string; message: string }` → `ChatReply` JSON

- [ ] **Step 1:** Route: reject a missing or empty `message` (or longer than 1000 chars) and a missing `sessionId` with 400. Get the session with `regionFromAcceptLanguage(req.headers.get("accept-language"))`. Wrap `handleMessage` in try/catch. On error, log it and return 200 `{ message: "Sorry, something went wrong on my side. Please try again.", movies: [], followUp: null }`.
- [ ] **Step 2:** `Chat.tsx` (client component): `sessionId` from `crypto.randomUUID()`, kept in `sessionStorage` (wrapped in try/catch); a message list; an input + send button (Enter sends); the input is disabled and a "Thinking…" bubble shows while waiting; bot replies show `message`, then a grid of `MovieCard`, then `followUp` if present. First bot message (local, not from the API): `"Hi! I'm your movie buddy. Tell me what you feel like watching."`
- [ ] **Step 3:** `MovieCard.tsx`: poster (or a grey placeholder), title + year, `★ rating` with 1 decimal, the why line, and providers as small tags ("Watch on: Netflix") if there are any.
- [ ] **Step 4:** Footer in `layout.tsx` with the exact TMDB attribution text from Global Constraints. Keep the layout usable at 375px width.
- [ ] **Step 5:** Run `npm run build`. Expected: success. Run `npm test`. Expected: all pass.
- [ ] **Step 6:** Manual check with real keys: `npm run dev`, open `http://localhost:3000`, send "recommend me a movie" (expect a question), then "something like Inception" (expect 3–5 cards), then "seen the first one" (expect it not to come back). Write down what happened.
- [ ] **Step 7:** Commit: `feat: chat api route and ui`
