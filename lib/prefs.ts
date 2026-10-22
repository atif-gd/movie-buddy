import { z } from "zod";

const LIST_FIELDS = [
  "genres", "excludeGenres", "keywords", "excludeKeywords", "actors", "directors",
  "companies", "providers", "likeMovies", "seenMovies", "monetization",
] as const;

const Monetization = z.enum(["flatrate", "free", "ads", "rent", "buy"]);
const Sort = z.enum(["popular", "top_rated", "newest"]);

// Every field is required and nullable: OpenAI strict structured output rejects optional fields.
const fields = {
  genres: z.array(z.string()),
  excludeGenres: z.array(z.string()),
  keywords: z.array(z.string()),
  excludeKeywords: z.array(z.string()),
  actors: z.array(z.string()),
  directors: z.array(z.string()),
  companies: z.array(z.string()),
  providers: z.array(z.string()),
  likeMovies: z.array(z.string()),
  seenMovies: z.array(z.string()),
  monetization: z.array(Monetization),
  mood: z.string().nullable(),
  originalLanguage: z.string().nullable().describe("ISO 639-1, e.g. ko"),
  originCountry: z.string().nullable().describe("ISO 3166-1, e.g. KR"),
  watchRegion: z.string().nullable().describe("ISO 3166-1, only if the user names a country"),
  maxCertification: z.string().nullable().describe("e.g. PG-13"),
  yearFrom: z.number().int().nullable(),
  yearTo: z.number().int().nullable(),
  minRating: z.number().nullable().describe("0-10"),
  minRuntime: z.number().int().nullable().describe("minutes"),
  maxRuntime: z.number().int().nullable().describe("minutes"),
  hiddenGem: z.boolean().nullable(),
  kidSafe: z.boolean().nullable(),
  sortPreference: Sort.nullable(),
};

export const PrefsSchema = z.object(fields);
export type Prefs = z.infer<typeof PrefsSchema>;

export const PrefsDelta = z.object({
  intent: z.enum(["new_search", "refine", "just_show", "other"]),
  ...fields,
  replaceFields: z.array(z.string()).describe("list fields to replace instead of add to"),
  removeFields: z.array(z.string()).describe("fields to clear"),
});
export type PrefsDelta = z.infer<typeof PrefsDelta>;

export const PERSON_FIELDS: (keyof Prefs)[] = [
  "excludeGenres", "excludeKeywords", "providers", "monetization", "watchRegion", "seenMovies",
];

export function emptyPrefs(): Prefs {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(fields)) out[k] = (LIST_FIELDS as readonly string[]).includes(k) ? [] : null;
  return out as Prefs;
}

function isList(k: string) {
  return (LIST_FIELDS as readonly string[]).includes(k);
}

export function mergePrefs(prefs: Prefs, delta: PrefsDelta): Prefs {
  const base = emptyPrefs() as Record<string, unknown>;
  const old = prefs as Record<string, unknown>;
  for (const k of Object.keys(base)) {
    if (delta.intent !== "new_search" || PERSON_FIELDS.includes(k as keyof Prefs)) {
      base[k] = isList(k) ? [...(old[k] as unknown[])] : old[k];
    }
  }
  for (const k of delta.removeFields) if (k in base) base[k] = isList(k) ? [] : null;

  const d = delta as Record<string, unknown>;
  for (const k of Object.keys(base)) {
    const v = d[k];
    if (isList(k)) {
      const add = v as string[];
      if (!add.length) continue;
      const current = delta.replaceFields.includes(k) ? [] : (base[k] as string[]);
      const seen = new Set(current.map((x) => x.toLowerCase()));
      base[k] = [...current, ...add.filter((x) => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))];
    } else if (v !== null) {
      base[k] = v;
    }
  }
  return base as Prefs;
}
