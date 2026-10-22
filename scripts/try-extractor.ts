import { extractDelta } from "@/lib/agents/extractor";
import { emptyPrefs } from "@/lib/prefs";

const delta = await extractDelta({
  message: "a funny 90s movie with Jim Carrey, no horror",
  history: [], prefs: emptyPrefs(), shownTitles: [], hasRecommended: false,
});
console.log(JSON.stringify(delta, null, 2));
