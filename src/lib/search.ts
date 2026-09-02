/**
 * Text matching for the menu search box.
 *
 * Arabic queries are normalized so that hamza forms, alef maqsura, ta marbuta
 * and diacritics do not stop a match — a guest typing "كبسه" still finds "كبسة".
 */

const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;

export function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when every whitespace-separated term of the query appears in the haystack. */
export function matchesQuery(query: string, ...haystack: (string | null | undefined)[]): boolean {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return true;

  const target = normalizeForSearch(haystack.filter(Boolean).join(' '));
  return normalizedQuery.split(' ').every((term) => target.includes(term));
}
