import type { Prefs } from "@/lib/prefs";
import type { SoftPrefs } from "@/lib/session";

// Tune here. A single high-weight field is enough to recommend.
export const WEIGHTS = { high: 3, medium: 2, low: 1 };
export const THRESHOLD = 3;

export function score(p: Prefs, soft?: SoftPrefs | null): number {
  const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v !== null);
  const groups: [boolean, number][] = [
    [has(p.genres) || has(p.mood) || !!soft?.genreIds.length || !!soft?.keywordIds.length, WEIGHTS.high],
    [has(p.likeMovies), WEIGHTS.high],
    [has(p.yearFrom) || has(p.yearTo), WEIGHTS.high],
    [has(p.actors), WEIGHTS.medium],
    [has(p.directors), WEIGHTS.medium],
    [has(p.keywords), WEIGHTS.medium],
    [has(p.providers), WEIGHTS.medium],
    [has(p.minRating), WEIGHTS.low],
    [has(p.minRuntime) || has(p.maxRuntime), WEIGHTS.low],
    [has(p.originalLanguage), WEIGHTS.low],
    [has(p.maxCertification) || has(p.kidSafe), WEIGHTS.low],
    [has(p.companies), WEIGHTS.low],
    [has(p.hiddenGem), WEIGHTS.low],
  ];
  return groups.reduce((sum, [on, w]) => sum + (on ? w : 0), 0);
}

export function nextQuestionTopic(p: Prefs): "likeMovie" | "mood" | "era" {
  const noTaste = !p.genres.length && p.mood === null;
  if (noTaste && !p.likeMovies.length) return "likeMovie";
  if (noTaste) return "mood";
  return "era";
}
