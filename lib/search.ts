import type { Prefs } from "@/lib/prefs";
import type { TmdbGet, TmdbMovie } from "@/lib/tmdb/client";
import { buildDiscoverParams, MAX_RELAX } from "@/lib/tmdb/query";
import type { Resolved } from "@/lib/tmdb/resolve";

const ENOUGH = 5;
const LIMIT = 20;

type Opts = { region: string; excludeIds: number[]; trending: boolean };

// Hard filters that can be checked on a list item without a detail call.
function matchesHard(m: TmdbMovie, p: Prefs, r: Resolved) {
  const year = Number(m.release_date?.slice(0, 4));
  if (r.genreIds.length && !m.genre_ids.some((g) => r.genreIds.includes(g))) return false;
  if (m.genre_ids.some((g) => r.excludeGenreIds.includes(g))) return false;
  if (p.yearFrom !== null && !(year >= p.yearFrom)) return false;
  if (p.yearTo !== null && !(year <= p.yearTo)) return false;
  if (p.minRating !== null && m.vote_average < p.minRating) return false;
  return true;
}

// Constraints that list items can't show (age rating, streaming, keywords):
// only /discover can enforce them, so the shortcut endpoints are skipped.
function hasStrict(p: Prefs, r: Resolved) {
  return !!(p.kidSafe || p.maxCertification || r.providerIds.length || p.monetization.length || r.excludeKeywordIds.length);
}

const MAX_PAGES = 3;

export async function findCandidates(
  p: Prefs, r: Resolved, opts: Opts, get: TmdbGet,
): Promise<{ movies: TmdbMovie[]; relaxed: boolean }> {
  const skip = new Set([...opts.excludeIds, ...r.likeMovieIds]);
  const out: TmdbMovie[] = [];
  const add = (movies: TmdbMovie[]) => {
    for (const m of movies) {
      if (skip.has(m.id)) continue;
      skip.add(m.id);
      out.push(m);
    }
  };
  const strict = hasStrict(p, r);

  if (opts.trending && !strict) {
    add((await get("/trending/movie/week")).results.filter((m: TmdbMovie) => matchesHard(m, p, r)));
    return { movies: out.slice(0, LIMIT), relaxed: false };
  }

  if (!strict) {
    for (const id of r.likeMovieIds) {
      add((await get(`/movie/${id}/recommendations`)).results.filter((m: TmdbMovie) => matchesHard(m, p, r)));
    }
  }

  let relaxed = false;
  const tried = new Set<string>();
  for (let level = 0; level <= MAX_RELAX && out.length < ENOUGH; level++) {
    const params = buildDiscoverParams(p, r, opts.region, level);
    const key = JSON.stringify(params);
    if (tried.has(key)) continue;
    tried.add(key);
    // More pages at the same strictness before loosening anything.
    for (let page = 1; page <= MAX_PAGES && out.length < ENOUGH; page++) {
      const before = out.length;
      const res = await get("/discover/movie", { ...params, page });
      add(res.results);
      if (level > 0 && out.length > before) relaxed = true;
      if (page >= (res.total_pages ?? 1)) break;
    }
  }
  return { movies: out.slice(0, LIMIT), relaxed };
}
