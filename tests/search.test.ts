import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeForSearch } from '@/lib/search';

describe('menu search', () => {
  it('matches English names case-insensitively', () => {
    expect(matchesQuery('burger', 'Classic Beef Burger')).toBe(true);
    expect(matchesQuery('BEEF', 'Classic Beef Burger')).toBe(true);
    expect(matchesQuery('pizza', 'Classic Beef Burger')).toBe(false);
  });

  it('requires every term to match', () => {
    expect(matchesQuery('beef burger', 'Classic Beef Burger')).toBe(true);
    expect(matchesQuery('beef pizza', 'Classic Beef Burger')).toBe(false);
  });

  it('matches Arabic despite hamza, ta marbuta and alef variants', () => {
    expect(matchesQuery('كبسه', 'كبسة دجاج')).toBe(true);
    expect(matchesQuery('كبسة', 'كبسة دجاج')).toBe(true);
    expect(matchesQuery('احمد', 'أحمد')).toBe(true);
  });

  it('searches descriptions as well as names', () => {
    expect(matchesQuery('cheddar', 'Classic Beef Burger', 'Grilled patty with cheddar')).toBe(true);
  });

  it('treats an empty query as matching everything', () => {
    expect(matchesQuery('', 'anything')).toBe(true);
    expect(matchesQuery('   ', 'anything')).toBe(true);
  });

  it('normalizes whitespace', () => {
    expect(normalizeForSearch('  Beef   Burger ')).toBe('beef burger');
  });
});
