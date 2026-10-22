import type { Prefs } from "@/lib/prefs";
import type { TmdbParams } from "@/lib/tmdb/client";
import type { Resolved } from "@/lib/tmdb/resolve";

// Dropped in this order when results are too few. Exclusions, certification,
// providers and monetization are never relaxed.
export const RELAX_ORDER = ["minRating", "runtime", "language", "keywords", "years", "people", "genres"] as const;
export const MAX_RELAX = RELAX_ORDER.length;

const SORT = { popular: "popularity.desc", top_rated: "vote_average.desc", newest: "primary_release_date.desc" };

export function buildDiscoverParams(p: Prefs, r: Resolved, region: string, relaxLevel = 0): TmdbParams {
  const keep = (g: (typeof RELAX_ORDER)[number]) => RELAX_ORDER.indexOf(g) >= relaxLevel;
  const q: TmdbParams = {
    include_adult: false,
    language: "en-US",
    region,
    "vote_count.gte": 100,
    sort_by: SORT[p.sortPreference ?? "popular"],
  };
  const set = (k: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && v !== "") q[k] = v;
  };

  if (p.sortPreference === "top_rated") q["vote_count.gte"] = 300;

  if (keep("minRating")) {
    if (p.hiddenGem) {
      q["vote_count.gte"] = 50;
      q["vote_count.lte"] = 1000;
      q["vote_average.gte"] = Math.max(7, p.minRating ?? 0);
    } else set("vote_average.gte", p.minRating);
  }
  if (keep("runtime")) {
    set("with_runtime.gte", p.minRuntime);
    set("with_runtime.lte", p.maxRuntime);
  }
  if (keep("language")) {
    set("with_original_language", p.originalLanguage);
    set("with_origin_country", p.originCountry);
  }
  if (keep("keywords")) {
    set("with_keywords", (r.keywordIds.length ? r.keywordIds : r.soft?.keywordIds ?? []).join("|"));
  }
  if (keep("years")) {
    const userYears = p.yearFrom !== null || p.yearTo !== null;
    const from = userYears ? p.yearFrom : r.soft?.yearFrom;
    const to = userYears ? p.yearTo : r.soft?.yearTo;
    if (from) set("primary_release_date.gte", `${from}-01-01`);
    if (to) set("primary_release_date.lte", `${to}-12-31`);
  }
  if (keep("people")) {
    set("with_cast", r.castIds.join(","));
    set("with_crew", r.crewIds.join(","));
    set("with_companies", r.companyIds.join("|"));
  }
  if (keep("genres")) {
    set("with_genres", (r.genreIds.length ? r.genreIds : r.soft?.genreIds ?? []).join("|"));
  }

  set("without_genres", r.excludeGenreIds.join(","));
  set("without_keywords", r.excludeKeywordIds.join(","));
  // Always the US rating system: "PG"/"PG-13" don't exist in most other countries' lists.
  if (p.kidSafe || p.maxCertification) {
    q.certification_country = "US";
    q["certification.lte"] = p.maxCertification ?? "PG";
  }
  if (r.providerIds.length || p.monetization.length) {
    q.watch_region = region;
    set("with_watch_providers", r.providerIds.join("|"));
    set("with_watch_monetization_types", p.monetization.join("|"));
  }
  return q;
}
