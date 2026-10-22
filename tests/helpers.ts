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

// Routes keyed by path, or "path?query=<value>" for search endpoints. Unknown search → empty results.
export function fakeTmdb(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const get = async (path: string, params: Record<string, string | number | boolean> = {}) => {
    calls.push(path);
    const key = params.query !== undefined ? `${path}?query=${params.query}` : path;
    if (key in routes) return routes[key];
    if (path.startsWith("/search/")) return { results: [] };
    throw new Error(`fake tmdb: no route for ${key}`);
  };
  return { get, calls };
}
