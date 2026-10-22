import { beforeEach, describe, expect, test } from "vitest";
import { emptyPrefs } from "@/lib/prefs";
import { __resetCache, resolvePrefs } from "@/lib/tmdb/resolve";
import { fakeTmdb } from "./helpers";

const routes = {
  "/genre/movie/list": { genres: [{ id: 35, name: "Comedy" }, { id: 27, name: "Horror" }, { id: 80, name: "Crime" }] },
  "/watch/providers/movie": { results: [{ provider_id: 8, provider_name: "Netflix" }] },
  "/search/person?query=Jim Carrey": { results: [{ id: 206 }] },
  "/search/person?query=Michael Mann": { results: [{ id: 638 }] },
  "/search/keyword?query=heist": { results: [{ id: 10051 }] },
  "/search/company?query=Pixar": { results: [{ id: 3 }] },
  "/search/movie?query=Heat": { results: [{ id: 949 }] },
  "/movie/949": { release_date: "1995-12-15", genres: [{ id: 80 }] },
  "/movie/949/keywords": { keywords: [1, 2, 3, 4, 5, 6].map((id) => ({ id })) },
};

describe("resolvePrefs", () => {
  beforeEach(() => __resetCache());

  test("maps names to ids", async () => {
    const { get } = fakeTmdb(routes);
    const r = await resolvePrefs(
      { ...emptyPrefs(), genres: ["comedy"], excludeGenres: ["Horror"], actors: ["Jim Carrey"],
        directors: ["Michael Mann"], keywords: ["heist"], companies: ["Pixar"], providers: ["netflix"] },
      "US", get,
    );
    expect(r.genreIds).toEqual([35]);
    expect(r.excludeGenreIds).toEqual([27]);
    expect(r.castIds).toEqual([206]);
    expect(r.crewIds).toEqual([638]);
    expect(r.keywordIds).toEqual([10051]);
    expect(r.companyIds).toEqual([3]);
    expect(r.providerIds).toEqual([8]);
    expect(r.soft).toBeNull();
  });

  test("liked movie gives id and soft prefs", async () => {
    const { get } = fakeTmdb(routes);
    const r = await resolvePrefs({ ...emptyPrefs(), likeMovies: ["Heat"] }, "US", get);
    expect(r.likeMovieIds).toEqual([949]);
    expect(r.soft).toEqual({ genreIds: [80], keywordIds: [1, 2, 3, 4, 5], yearFrom: 1990, yearTo: 1999 });
  });

  test("unknown names are dropped, rest still resolves", async () => {
    const { get } = fakeTmdb(routes);
    const r = await resolvePrefs(
      { ...emptyPrefs(), likeMovies: ["Blorptastic"], actors: ["Nobody Atall"], genres: ["Comedy", "Nonsense"] },
      "US", get,
    );
    expect(r.likeMovieIds).toEqual([]);
    expect(r.castIds).toEqual([]);
    expect(r.genreIds).toEqual([35]);
    expect(r.soft).toBeNull();
  });

  test("genre and provider lists are fetched once", async () => {
    const { get, calls } = fakeTmdb(routes);
    const p = { ...emptyPrefs(), genres: ["comedy"], providers: ["Netflix"] };
    await resolvePrefs(p, "US", get);
    await resolvePrefs(p, "US", get);
    expect(calls.filter((c) => c === "/genre/movie/list")).toHaveLength(1);
    expect(calls.filter((c) => c === "/watch/providers/movie")).toHaveLength(1);
  });
});
