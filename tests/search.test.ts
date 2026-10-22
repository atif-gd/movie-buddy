import { describe, expect, test } from "vitest";
import { emptyPrefs } from "@/lib/prefs";
import type { TmdbParams } from "@/lib/tmdb/client";
import { findCandidates } from "@/lib/search";
import { MAX_RELAX } from "@/lib/tmdb/query";
import { emptyResolved, movie } from "./helpers";

const opts = { region: "US", excludeIds: [] as number[], trending: false };
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => movie(from + i));

function recorder(handler: (path: string, params: TmdbParams) => unknown) {
  const calls: { path: string; params: TmdbParams }[] = [];
  const get = async (path: string, params: TmdbParams = {}) => {
    calls.push({ path, params });
    return handler(path, params);
  };
  return { get, calls };
}

describe("findCandidates", () => {
  test("trending uses trending endpoint only", async () => {
    const { get, calls } = recorder(() => ({ results: range(1, 10) }));
    const { movies: out } = await findCandidates(emptyPrefs(), emptyResolved(), { ...opts, trending: true }, get);
    expect(calls.map((c) => c.path)).toEqual(["/trending/movie/week"]);
    expect(out).toHaveLength(10);
  });

  test("like movie uses recommendations and applies hard filters", async () => {
    const recs = [
      movie(1, { genre_ids: [80] }),
      movie(2, { genre_ids: [27] }), // excluded genre
      movie(3, { release_date: "1980-05-01" }), // before yearFrom
      movie(4, { vote_average: 5 }), // below minRating
      movie(5), movie(6), movie(7), movie(8),
    ];
    const { get, calls } = recorder((path) => (path === "/movie/949/recommendations" ? { results: recs } : { results: [] }));
    const { movies: out } = await findCandidates(
      { ...emptyPrefs(), yearFrom: 1990, minRating: 6 },
      { ...emptyResolved(), likeMovieIds: [949], excludeGenreIds: [27] },
      opts, get,
    );
    expect(out.map((m) => m.id)).toEqual([1, 5, 6, 7, 8]);
    expect(calls.map((c) => c.path)).toEqual(["/movie/949/recommendations"]);
  });

  test("few like results fill up from discover without duplicates", async () => {
    const { get } = recorder((path) =>
      path === "/movie/949/recommendations" ? { results: [movie(1), movie(2)] } : { results: [movie(2), movie(3), movie(4), movie(949)] },
    );
    const { movies: out } = await findCandidates(emptyPrefs(), { ...emptyResolved(), likeMovieIds: [949] }, opts, get);
    expect(out.map((m) => m.id)).toEqual([1, 2, 3, 4]);
  });

  test("excludeIds never returned", async () => {
    const { get } = recorder(() => ({ results: range(1, 8) }));
    const { movies: out } = await findCandidates(emptyPrefs(), emptyResolved(), { ...opts, excludeIds: [2, 3] }, get);
    expect(out.map((m) => m.id)).not.toContain(2);
    expect(out.map((m) => m.id)).not.toContain(3);
  });

  test("relaxes until enough results", async () => {
    const { get, calls } = recorder((_p, params) => ({ results: "vote_average.gte" in params ? range(1, 2) : range(1, 6) }));
    const { movies: out } = await findCandidates({ ...emptyPrefs(), minRating: 8 }, emptyResolved(), opts, get);
    expect(out).toHaveLength(6);
    expect(calls).toHaveLength(2);
  });

  test("all relax levels empty returns []", async () => {
    const { get, calls } = recorder(() => ({ results: [] }));
    const prefs = { ...emptyPrefs(), minRating: 7, maxRuntime: 90, originalLanguage: "ko", yearFrom: 1990 };
    const r = { ...emptyResolved(), keywordIds: [1], castIds: [2], genreIds: [35] };
    expect((await findCandidates(prefs, r, opts, get)).movies).toEqual([]);
    expect(calls).toHaveLength(MAX_RELAX + 1);
  });

  test("identical relaxed queries are not repeated", async () => {
    const { get, calls } = recorder(() => ({ results: [] }));
    await findCandidates(emptyPrefs(), emptyResolved(), opts, get);
    expect(calls).toHaveLength(1);
  });

  test("strict constraints skip like-movie recommendations (I1)", async () => {
    const { get, calls } = recorder(() => ({ results: range(1, 6) }));
    await findCandidates(
      { ...emptyPrefs(), kidSafe: true },
      { ...emptyResolved(), likeMovieIds: [949], soft: { genreIds: [16], keywordIds: [], yearFrom: null, yearTo: null } },
      opts, get,
    );
    expect(calls.map((c) => c.path)).toEqual(["/discover/movie"]);
    expect(calls[0].params.with_genres).toBe("16");
  });

  test("trending drops excluded genres (I2)", async () => {
    const { get } = recorder(() => ({ results: [movie(1, { genre_ids: [27] }), movie(2), movie(3), movie(4), movie(5), movie(6)] }));
    const { movies } = await findCandidates(emptyPrefs(), { ...emptyResolved(), excludeGenreIds: [27] }, { ...opts, trending: true }, get);
    expect(movies.map((m) => m.id)).toEqual([2, 3, 4, 5, 6]);
  });

  test("trending with strict constraints uses discover instead (I2)", async () => {
    const { get, calls } = recorder(() => ({ results: range(1, 6) }));
    await findCandidates(emptyPrefs(), { ...emptyResolved(), providerIds: [8] }, { ...opts, trending: true }, get);
    expect(calls.map((c) => c.path)).toEqual(["/discover/movie"]);
  });

  test("next pages tried before relaxing (I4)", async () => {
    const { get, calls } = recorder((_p, params) => ({ results: range(Number(params.page ?? 1) * 10, 2), total_pages: 3 }));
    const { movies, relaxed } = await findCandidates({ ...emptyPrefs(), minRating: 8 }, emptyResolved(), opts, get);
    expect(calls.map((c) => c.params.page)).toEqual([1, 2, 3]);
    expect(movies).toHaveLength(6);
    expect(relaxed).toBe(false);
  });

  test("relaxed flag set when filters were loosened (I4)", async () => {
    const { get } = recorder((_p, params) => ({ results: "vote_average.gte" in params ? [] : range(1, 6) }));
    const { relaxed } = await findCandidates({ ...emptyPrefs(), minRating: 8 }, emptyResolved(), opts, get);
    expect(relaxed).toBe(true);
  });
});
