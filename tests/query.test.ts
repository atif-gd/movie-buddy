import { describe, expect, test } from "vitest";
import { emptyPrefs } from "@/lib/prefs";
import { buildDiscoverParams, MAX_RELAX } from "@/lib/tmdb/query";
import { emptyResolved } from "./helpers";

const soft = { genreIds: [80], keywordIds: [1, 2], yearFrom: 1990, yearTo: 1999 };

describe("buildDiscoverParams", () => {
  test("base params always set", () => {
    const q = buildDiscoverParams(emptyPrefs(), emptyResolved(), "GB");
    expect(q).toMatchObject({ include_adult: false, language: "en-US", region: "GB", "vote_count.gte": 100, sort_by: "popularity.desc" });
  });

  test("genres OR, cast AND, exclusions", () => {
    const q = buildDiscoverParams(emptyPrefs(), { ...emptyResolved(), genreIds: [35, 878], castIds: [1, 2], excludeGenreIds: [27, 53] }, "US");
    expect(q.with_genres).toBe("35|878");
    expect(q.with_cast).toBe("1,2");
    expect(q.without_genres).toBe("27,53");
  });

  test("years become release date range", () => {
    const q = buildDiscoverParams({ ...emptyPrefs(), yearFrom: 1990, yearTo: 1999 }, emptyResolved(), "US");
    expect(q["primary_release_date.gte"]).toBe("1990-01-01");
    expect(q["primary_release_date.lte"]).toBe("1999-12-31");
  });

  test("soft years and genres only fill gaps", () => {
    const q1 = buildDiscoverParams(emptyPrefs(), { ...emptyResolved(), soft }, "US");
    expect(q1.with_genres).toBe("80");
    expect(q1["primary_release_date.gte"]).toBe("1990-01-01");
    const q2 = buildDiscoverParams({ ...emptyPrefs(), yearFrom: 2010 }, { ...emptyResolved(), genreIds: [35], soft }, "US");
    expect(q2.with_genres).toBe("35");
    expect(q2["primary_release_date.gte"]).toBe("2010-01-01");
    expect(q2["primary_release_date.lte"]).toBeUndefined();
  });

  test("hidden gem", () => {
    const q = buildDiscoverParams({ ...emptyPrefs(), hiddenGem: true }, emptyResolved(), "US");
    expect(q).toMatchObject({ "vote_count.gte": 50, "vote_count.lte": 1000, "vote_average.gte": 7 });
    expect(buildDiscoverParams({ ...emptyPrefs(), hiddenGem: true, minRating: 8 }, emptyResolved(), "US")["vote_average.gte"]).toBe(8);
  });

  test("kid safe and max certification", () => {
    expect(buildDiscoverParams({ ...emptyPrefs(), kidSafe: true }, emptyResolved(), "GB"))
      .toMatchObject({ certification_country: "GB", "certification.lte": "PG" });
    expect(buildDiscoverParams({ ...emptyPrefs(), kidSafe: true, maxCertification: "PG-13" }, emptyResolved(), "US")["certification.lte"]).toBe("PG-13");
  });

  test("providers and monetization", () => {
    const q = buildDiscoverParams({ ...emptyPrefs(), monetization: ["flatrate", "free"] }, { ...emptyResolved(), providerIds: [8, 9] }, "US");
    expect(q).toMatchObject({ with_watch_providers: "8|9", watch_region: "US", with_watch_monetization_types: "flatrate|free" });
  });

  test("sort preferences", () => {
    const sort = (s: "popular" | "top_rated" | "newest") => buildDiscoverParams({ ...emptyPrefs(), sortPreference: s }, emptyResolved(), "US");
    expect(sort("popular").sort_by).toBe("popularity.desc");
    expect(sort("top_rated")).toMatchObject({ sort_by: "vote_average.desc", "vote_count.gte": 300 });
    expect(sort("newest").sort_by).toBe("primary_release_date.desc");
  });

  test("max relax keeps exclusions, certification, providers", () => {
    const q = buildDiscoverParams(
      { ...emptyPrefs(), kidSafe: true, minRating: 7, yearFrom: 1990, maxRuntime: 100, originalLanguage: "ko" },
      { ...emptyResolved(), genreIds: [35], excludeGenreIds: [27], providerIds: [8], castIds: [1], keywordIds: [5] },
      "US", MAX_RELAX,
    );
    expect(q.without_genres).toBe("27");
    expect(q["certification.lte"]).toBe("PG");
    expect(q.with_watch_providers).toBe("8");
    for (const k of ["with_genres", "vote_average.gte", "with_cast", "with_keywords", "primary_release_date.gte", "with_runtime.lte", "with_original_language"]) {
      expect(q[k]).toBeUndefined();
    }
  });

  test("relax level 1 drops only rating", () => {
    const q = buildDiscoverParams({ ...emptyPrefs(), minRating: 7, maxRuntime: 100 }, emptyResolved(), "US", 1);
    expect(q["vote_average.gte"]).toBeUndefined();
    expect(q["with_runtime.lte"]).toBe(100);
  });
});
