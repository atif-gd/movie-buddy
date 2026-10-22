import { describe, expect, test } from "vitest";
import { emptyPrefs, mergePrefs } from "@/lib/prefs";
import { noChange } from "./helpers";

describe("mergePrefs", () => {
  test("scalar set", () => {
    expect(mergePrefs(emptyPrefs(), { ...noChange(), yearFrom: 1990 }).yearFrom).toBe(1990);
  });

  test("null keeps old", () => {
    const prefs = { ...emptyPrefs(), yearFrom: 1990 };
    expect(mergePrefs(prefs, noChange()).yearFrom).toBe(1990);
  });

  test("lists add and dedupe (case-insensitive)", () => {
    const prefs = { ...emptyPrefs(), genres: ["comedy"] };
    expect(mergePrefs(prefs, { ...noChange(), genres: ["Comedy", "drama"] }).genres).toEqual(["comedy", "drama"]);
  });

  test("replaceFields replaces", () => {
    const prefs = { ...emptyPrefs(), genres: ["comedy"] };
    const out = mergePrefs(prefs, { ...noChange(), genres: ["thriller"], replaceFields: ["genres"] });
    expect(out.genres).toEqual(["thriller"]);
  });

  test("removeFields clears", () => {
    const prefs = { ...emptyPrefs(), yearFrom: 1990, yearTo: 1999, actors: ["Jim Carrey"] };
    const out = mergePrefs(prefs, { ...noChange(), removeFields: ["yearFrom", "yearTo", "actors"] });
    expect(out.yearFrom).toBeNull();
    expect(out.yearTo).toBeNull();
    expect(out.actors).toEqual([]);
  });

  test("new_search keeps person fields only", () => {
    const prefs = {
      ...emptyPrefs(),
      genres: ["comedy"], actors: ["Jim Carrey"], likeMovies: ["The Mask"],
      excludeGenres: ["horror"], providers: ["Netflix"],
    };
    const out = mergePrefs(prefs, { ...noChange(), intent: "new_search", genres: ["family"] });
    expect(out.genres).toEqual(["family"]);
    expect(out.actors).toEqual([]);
    expect(out.likeMovies).toEqual([]);
    expect(out.excludeGenres).toEqual(["horror"]);
    expect(out.providers).toEqual(["Netflix"]);
  });

  test("does not mutate input", () => {
    const prefs = { ...emptyPrefs(), genres: ["comedy"] };
    mergePrefs(prefs, { ...noChange(), genres: ["drama"] });
    expect(prefs.genres).toEqual(["comedy"]);
  });
});
