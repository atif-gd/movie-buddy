export function regionFromAcceptLanguage(header: string | null): string {
  const first = header?.split(",")[0]?.split(";")[0]?.trim() ?? "";
  const region = first.split("-").slice(1).find((part) => /^[a-z]{2}$/i.test(part));
  return region ? region.toUpperCase() : "US";
}
