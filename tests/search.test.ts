import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeForSearch } from '@/lib/search';

describe('menu search', () => {
  it('matches English names case-insensitively', () => {
    expect(matchesQuery('zinger', 'Mighty Zinger Combo')).toBe(true);
    expect(matchesQuery('ZINGER', 'Mighty Zinger Combo')).toBe(true);
    expect(matchesQuery('pizza', 'Mighty Zinger Combo')).toBe(false);
  });

  it('requires every term to match', () => {
    expect(matchesQuery('mighty zinger', 'Mighty Zinger Combo')).toBe(true);
    expect(matchesQuery('mighty pizza', 'Mighty Zinger Combo')).toBe(false);
  });

  it('matches Arabic despite hamza, ta marbuta and alef variants', () => {
    expect(matchesQuery('وجبه', 'وجبة زنجر')).toBe(true);
    expect(matchesQuery('وجبة', 'وجبة زنجر')).toBe(true);
    expect(matchesQuery('احمد', 'أحمد')).toBe(true);
  });

  it('searches descriptions as well as names', () => {
    expect(matchesQuery('cheese', 'Mighty Zinger Combo', 'Double Zinger fillets with cheese')).toBe(
      true,
    );
  });

  it('treats an empty query as matching everything', () => {
    expect(matchesQuery('', 'anything')).toBe(true);
    expect(matchesQuery('   ', 'anything')).toBe(true);
  });

  it('normalizes whitespace', () => {
    expect(normalizeForSearch('  Beef   Burger ')).toBe('beef burger');
  });
});
