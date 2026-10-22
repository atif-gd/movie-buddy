import { beforeEach, describe, expect, test, vi } from "vitest";
import { handleMessage, type Deps } from "@/lib/chat";
import type { PrefsDelta } from "@/lib/prefs";
import { newSession } from "@/lib/session";
import type { TmdbParams } from "@/lib/tmdb/client";
import { __resetCache } from "@/lib/tmdb/resolve";
import { movie, noChange } from "./helpers";

const candidates = [1, 2, 3, 4, 5, 6].map((id) => movie(id));

function deps(opts: { delta?: Partial<PrefsDelta>; pickIds?: number[]; discover?: unknown[] } = {}) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const tmdb = async (path: string, _params?: TmdbParams): Promise<unknown> => {
    if (path === "/genre/movie/list") return { genres: [{ id: 35, name: "Comedy" }, { id: 10751, name: "Family" }] };
    if (path === "/discover/movie") return { results: opts.discover ?? candidates };
    if (path.startsWith("/search/")) return { results: [] };
    const m = path.match(/^\/movie\/(\d+)$/);
    if (m) return { id: Number(m[1]), "watch/providers": { results: { US: { flatrate: [{ provider_name: "Netflix" }] } } } };
    throw new Error(`no route ${path}`);
  };
  const d = {
    extract: vi.fn(async () => ({ ...noChange(), ...opts.delta })),
    question: vi.fn(async () => "What's a movie you loved recently?"),
    picks: vi.fn(async () => ({ message: "Try these:", picks: (opts.pickIds ?? [1, 2, 3]).map((id) => ({ id, why: "fun" })), followUp: null })),
    get: vi.fn(tmdb),
  };
  return d as typeof d & Deps;
}

describe("handleMessage", () => {
  beforeEach(() => __resetCache());

  test("vague first message asks a question", async () => {
    const s = newSession("a", "US");
    const out = await handleMessage(s, "recommend me a movie", deps());
    expect(out.movies).toEqual([]);
    expect(out.message).toBe("What's a movie you loved recently?");
    expect(s.questionsAsked).toBe(1);
    expect(s.history).toHaveLength(2);
  });

  test("after 2 questions it recommends anyway", async () => {
    const s = newSession("a", "US");
    const d = deps();
    await handleMessage(s, "hi", d);
    await handleMessage(s, "dunno", d);
    const out = await handleMessage(s, "no idea", d);
    expect(d.question).toHaveBeenCalledTimes(2);
    expect(out.movies.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  test("just_show recommends right away", async () => {
    const s = newSession("a", "US");
    const d = deps({ delta: { intent: "just_show" } });
    const out = await handleMessage(s, "just show me", d);
    expect(d.question).not.toHaveBeenCalled();
    expect(out.movies).toHaveLength(3);
  });

  test("high score first message recommends with cards", async () => {
    const s = newSession("a", "US");
    const d = deps({ delta: { genres: ["Comedy"], yearFrom: 1990, yearTo: 1999 } });
    const out = await handleMessage(s, "funny 90s movie", d);
    expect(d.question).not.toHaveBeenCalled();
    expect(out.movies[0]).toEqual({
      id: 1, title: "Movie 1", year: "2000", posterUrl: null, rating: 7, why: "fun", providers: ["Netflix"],
    });
    expect(s.hasRecommended).toBe(true);
    expect(s.lastPicks).toEqual(["Movie 1", "Movie 2", "Movie 3"]);
  });

  test("invented picks dropped and shown movies never repeat", async () => {
    const s = newSession("a", "US");
    const out = await handleMessage(s, "comedy", deps({ delta: { genres: ["Comedy"] }, pickIds: [1, 999] }));
    expect(out.movies.map((m) => m.id)).toEqual([1]);
    const d2 = deps({ delta: { genres: ["Comedy"] }, pickIds: [1, 2] });
    const out2 = await handleMessage(s, "more", d2);
    expect(out2.movies.map((m) => m.id)).toEqual([2]);
    const given = d2.picks.mock.calls[0] as unknown as [{ candidates: { id: number }[] }];
    expect(given[0].candidates.map((c) => c.id)).not.toContain(1);
  });

  test("new search resets question budget and keeps dislikes", async () => {
    const s = newSession("a", "US");
    await handleMessage(s, "comedy, no horror", deps({ delta: { genres: ["Comedy"], excludeGenres: ["Horror"] } }));
    s.questionsAsked = 2;
    const d = deps({ delta: { intent: "new_search" } });
    const out = await handleMessage(s, "now something else", d);
    expect(s.questionLimit).toBe(1);
    expect(s.questionsAsked).toBe(1);
    expect(out.movies).toEqual([]);
    expect(s.prefs.genres).toEqual([]);
    expect(s.prefs.excludeGenres).toEqual(["Horror"]);
  });

  test("no candidates gives friendly message", async () => {
    const s = newSession("a", "US");
    const out = await handleMessage(s, "comedy", deps({ delta: { genres: ["Comedy"] }, discover: [] }));
    expect(out.movies).toEqual([]);
    expect(out.message).toMatch(/couldn't find a match/);
  });

  test("tmdb failure rejects and leaves session unchanged", async () => {
    const s = newSession("a", "US");
    s.prefs.excludeGenres = ["Horror"];
    const before = structuredClone(s);
    const d = deps({ delta: { genres: ["Comedy"] } });
    d.get.mockImplementation(async () => {
      throw new Error("TMDB down");
    });
    await expect(handleMessage(s, "comedy", d)).rejects.toThrow("TMDB down");
    expect(s).toEqual(before);
  });

  test("named country overrides region", async () => {
    const s = newSession("a", "US");
    const d = deps({ delta: { genres: ["Comedy"], watchRegion: "GB" } });
    await handleMessage(s, "comedy, I'm in the UK", d);
    expect(s.region).toBe("GB");
    const discover = d.get.mock.calls.find((c) => c[0] === "/discover/movie")!;
    expect(discover[1]).toMatchObject({ region: "GB" });
  });

  test("small talk after picks gets a short reply, no new cards (I5)", async () => {
    const s = newSession("a", "US");
    await handleMessage(s, "comedy", deps({ delta: { genres: ["Comedy"] } }));
    const d = deps({ delta: { intent: "other" } });
    d.question.mockResolvedValueOnce("Enjoy the movie!");
    const out = await handleMessage(s, "thanks, I'll watch #2!", d);
    expect(out).toEqual({ message: "Enjoy the movie!", movies: [], followUp: null });
    expect(d.question).toHaveBeenCalledWith(expect.objectContaining({ topic: "smallTalk" }));
    expect(d.picks).not.toHaveBeenCalled();
  });

  test("relaxed results are flagged to the recommender (I4)", async () => {
    const s = newSession("a", "US");
    const d = deps({ delta: { genres: ["Comedy"], minRating: 9 } });
    d.get.mockImplementation(async (path: string, params: TmdbParams = {}) => {
      if (path === "/genre/movie/list") return { genres: [{ id: 35, name: "Comedy" }] };
      if (path === "/discover/movie") return { results: "vote_average.gte" in params ? [] : candidates };
      return { "watch/providers": { results: {} } };
    });
    await handleMessage(s, "great comedy", d);
    expect(d.picks).toHaveBeenCalledWith(expect.objectContaining({ relaxed: true }));
  });

  test("failed detail call keeps the pick with no providers (M2)", async () => {
    const s = newSession("a", "US");
    const d = deps({ delta: { genres: ["Comedy"] } });
    const base = d.get.getMockImplementation()!;
    d.get.mockImplementation(async (path: string, params?: TmdbParams) => {
      if (path === "/movie/2") throw new Error("timeout");
      return base(path, params);
    });
    const out = await handleMessage(s, "comedy", d);
    expect(out.movies.map((m) => [m.id, m.providers])).toEqual([[1, ["Netflix"]], [2, []], [3, ["Netflix"]]]);
  });

  test("empty question text falls back to a fixed question (M3)", async () => {
    const s = newSession("a", "US");
    const d = deps();
    d.question.mockResolvedValueOnce("  ");
    const out = await handleMessage(s, "hi", d);
    expect(out.message).toBe("What's a movie you loved recently?");
  });
});
