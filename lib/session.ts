import { emptyPrefs, type Prefs } from "@/lib/prefs";

export type SoftPrefs = { genreIds: number[]; keywordIds: number[]; yearFrom: number | null; yearTo: number | null };

export type Session = {
  id: string;
  history: { role: "user" | "assistant"; text: string }[];
  prefs: Prefs;
  soft: SoftPrefs | null;
  questionsAsked: number;
  questionLimit: number;
  hasRecommended: boolean;
  shownIds: number[];
  shownTitles: string[];
  lastPicks: string[]; // titles of the latest batch, in order, for "more like #2"
  seenIds: number[];
  region: string;
};

// ponytail: in-memory, lost on restart; move to a DB when sessions must survive.
const g = globalThis as unknown as { __sessions?: Map<string, Session> };
const store = (g.__sessions ??= new Map());

export function newSession(id: string, region: string): Session {
  return {
    id, history: [], prefs: emptyPrefs(), soft: null, questionsAsked: 0, questionLimit: 2,
    hasRecommended: false, shownIds: [], shownTitles: [], lastPicks: [], seenIds: [], region,
  };
}

export function getSession(id: string, region: string): Session {
  let s = store.get(id);
  if (!s) store.set(id, (s = newSession(id, region)));
  return s;
}
