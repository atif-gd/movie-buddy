import type { PrefsDelta } from "@/lib/prefs";

export function noChange(): PrefsDelta {
  return {
    intent: "refine",
    replaceFields: [],
    removeFields: [],
    genres: [], excludeGenres: [], keywords: [], excludeKeywords: [],
    actors: [], directors: [], companies: [], providers: [],
    likeMovies: [], seenMovies: [], monetization: [],
    mood: null, originalLanguage: null, originCountry: null, watchRegion: null,
    maxCertification: null, yearFrom: null, yearTo: null, minRating: null,
    minRuntime: null, maxRuntime: null, hiddenGem: null, kidSafe: null,
    sortPreference: null,
  };
}
