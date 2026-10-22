export type TmdbParams = Record<string, string | number | boolean>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TmdbGet = (path: string, params?: TmdbParams) => Promise<any>;

export type TmdbMovie = {
  id: number;
  title: string;
  release_date: string;
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  poster_path: string | null;
  overview: string;
};

export const tmdbGet: TmdbGet = async (path, params = {}) => {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set");
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  // Accept both a v3 API key and a v4 read access token (JWT).
  const headers: HeadersInit = key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {};
  if (!key.startsWith("eyJ")) url.searchParams.set("api_key", key);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB ${path} failed: ${res.status}`);
  return res.json();
};
