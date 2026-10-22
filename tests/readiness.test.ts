import { describe, expect, test } from "vitest";
import { emptyPrefs } from "@/lib/prefs";
import { nextQuestionTopic, score, THRESHOLD } from "@/lib/readiness";

describe("score", () => {
  test("empty prefs score 0", () => {
    expect(score(emptyPrefs())).toBe(0);
  });

  test("funny 90s Jim Carrey is ready", () => {
    const p = { ...emptyPrefs(), genres: ["comedy"], yearFrom: 1990, yearTo: 1999, actors: ["Jim Carrey"] };
    expect(score(p)).toBeGreaterThanOrEqual(THRESHOLD);
  });

  test("only runtime is not ready", () => {
    expect(score({ ...emptyPrefs(), maxRuntime: 120 })).toBeLessThan(THRESHOLD);
  });

  test("genres and mood count once", () => {
    expect(score({ ...emptyPrefs(), genres: ["comedy"], mood: "light" })).toBe(3);
  });

  test("soft genres count as genres", () => {
    expect(score(emptyPrefs(), { genreIds: [35], keywordIds: [], yearFrom: null, yearTo: null })).toBe(3);
  });
});

describe("nextQuestionTopic", () => {
  test("empty asks for a liked movie", () => {
    expect(nextQuestionTopic(emptyPrefs())).toBe("likeMovie");
  });

  test("genres known asks for era", () => {
    expect(nextQuestionTopic({ ...emptyPrefs(), genres: ["comedy"] })).toBe("era");
  });

  test("liked movie known but no mood asks mood", () => {
    expect(nextQuestionTopic({ ...emptyPrefs(), likeMovies: ["Heat"] })).toBe("mood");
  });
});
