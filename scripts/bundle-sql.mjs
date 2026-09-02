/**
 * Concatenates the migrations and the seed into one file that can be pasted
 * into the Supabase SQL Editor in a single go.
 *
 *   node scripts/bundle-sql.mjs
 *
 * The output is generated — edit the files under supabase/migrations instead.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const root = new URL('../supabase/', import.meta.url);
const migrations = readdirSync(new URL('migrations/', root))
  .filter((name) => name.endsWith('.sql'))
  .sort();

const parts = [
  '-- =============================================================',
  '-- GENERATED FILE — do not edit.',
  '-- Produced by: node scripts/bundle-sql.mjs',
  '-- Paste this whole file into the Supabase SQL Editor and run it.',
  '-- =============================================================',
  '',
];

for (const name of [...migrations, '../seed.sql']) {
  const path = name.startsWith('..')
    ? new URL(name.replace('../', ''), root)
    : new URL(`migrations/${name}`, root);

  parts.push(`-- ----------------------------------------------------------------`);
  parts.push(`-- ${name.replace('../', '')}`);
  parts.push(`-- ----------------------------------------------------------------`);
  parts.push(readFileSync(path, 'utf8').trimEnd(), '');
}

const output = new URL('setup.sql', root);
writeFileSync(output, parts.join('\n'));
console.log(`Wrote ${output.pathname} (${migrations.length} migrations + seed)`);
