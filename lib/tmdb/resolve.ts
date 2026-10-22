import type { Prefs } from "@/lib/prefs";
import type { SoftPrefs } from "@/lib/session";
import type { TmdbGet } from "@/lib/tmdb/client";

export type Resolved = {
  genreIds: number[];
  excludeGenreIds: number[];
  keywordIds: number[];
  excludeKeywordIds: number[];
  castIds: number[];
  crewIds: number[];
  companyIds: number[];
  providerIds: number[];
  likeMovieIds: number[];
  soft: SoftPrefs | null;
};

let genreList: Promise<{ id: number; name: string }[]> | null = null;
const providerLists = new Map<string, Promise<{ provider_id: number; provider_name: string }[]>>();
const nameCache = new Map<string, number | null>();

export function __resetCache() {
  genreList = null;
  providerLists.clear();
  nameCache.clear();
}

const norm = (s: string) => s.trim().toLowerCase();

async function search(get: TmdbGet, kind: "person" | "keyword" | "company" | "movie", name: string) {
  const key = `${kind}:${norm(name)}`;
  if (!nameCache.has(key)) {
    const res = await get(`/search/${kind}`, { query: name });
    nameCache.set(key, res.results?.[0]?.id ?? null);
  }
  return nameCache.get(key) ?? null;
}

async function searchAll(get: TmdbGet, kind: "person" | "keyword" | "company" | "movie", names: string[]) {
  const ids = await Promise.all(names.map((n) => search(get, kind, n)));
  return ids.filter((id): id is number => id !== null);
}

async function genreIds(get: TmdbGet, names: string[]) {
  if (!names.length) return [];
  genreList ??= get("/genre/movie/list").then((r) => r.genres).catch((e) => ((genreList = null), Promise.reject(e)));
  const list = await genreList;
  return names.flatMap((n) => list.filter((g) => norm(g.name) === norm(n)).map((g) => g.id));
}

async function providerIds(get: TmdbGet, names: string[], region: string) {
  if (!names.length) return [];
  if (!providerLists.has(region)) {
    providerLists.set(region, get("/watch/providers/movie", { watch_region: region }).then((r) => r.results));
  }
  const list = await providerLists.get(region)!.catch((e) => (providerLists.delete(region), Promise.reject(e)));
  return names.flatMap((n) => list.filter((p) => norm(p.provider_name) === norm(n)).map((p) => p.provider_id));
}

async function softFrom(get: TmdbGet, movieIds: number[]): Promise<SoftPrefs | null> {
  if (!movieIds.length) return null;
  const details = await Promise.all(
    movieIds.map(async (id) => {
      const [movie, kw] = await Promise.all([get(`/movie/${id}`), get(`/movie/${id}/keywords`)]);
      return { movie, kw };
    }),
  );
  const genreIds = [...new Set(details.flatMap((d) => d.movie.genres.map((g: { id: number }) => g.id)))];
  const keywordIds = [...new Set(details.flatMap((d) => d.kw.keywords.slice(0, 5).map((k: { id: number }) => k.id)))];
  const year = Number(details[0].movie.release_date?.slice(0, 4));
  const decade = Number.isFinite(year) && year > 0 ? Math.floor(year / 10) * 10 : null;
  return { genreIds, keywordIds, yearFrom: decade, yearTo: decade === null ? null : decade + 9 };
}

export async function resolvePrefs(prefs: Prefs, region: string, get: TmdbGet): Promise<Resolved> {
  const [genres, excludeGenres, keywords, excludeKeywords, cast, crew, companies, providers, likes] =
    await Promise.all([
      genreIds(get, prefs.genres),
      genreIds(get, prefs.excludeGenres),
      searchAll(get, "keyword", prefs.keywords),
      searchAll(get, "keyword", prefs.excludeKeywords),
      searchAll(get, "person", prefs.actors),
      searchAll(get, "person", prefs.directors),
      searchAll(get, "company", prefs.companies),
      providerIds(get, prefs.providers, prefs.watchRegion ?? region),
      searchAll(get, "movie", prefs.likeMovies),
    ]);
  return {
    genreIds: genres, excludeGenreIds: excludeGenres, keywordIds: keywords, excludeKeywordIds: excludeKeywords,
    castIds: cast, crewIds: crew, companyIds: companies, providerIds: providers, likeMovieIds: likes,
    soft: await softFrom(get, likes),
  };
}
