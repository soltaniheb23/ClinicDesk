import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BREAKPOINTS, MEDIA } from './breakpoints.js';

const SRC = join(import.meta.dirname, '..');
const ALLOWED = Object.values(MEDIA).map((query) => `@media ${query}`);

function cssFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith('.css') ? [path] : [];
  });
}

// Breakpoints are defined once (breakpoints.js, docs/design-tokens.md). CSS cannot read
// variables in @media, so this keeps every stylesheet on the same two values, mobile first.
describe('breakpoints', () => {
  it('are 40em and 64em', () => {
    expect(BREAKPOINTS).toEqual({ tablet: '40em', desktop: '64em' });
  });

  it.each(cssFiles(SRC).map((path) => [path.slice(SRC.length + 1), path]))(
    '%s only uses the shared min-width breakpoints',
    (_name, path) => {
      const css = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      const queries = css.match(/@media[^{]*/g) ?? [];
      for (const query of queries.map((text) => text.trim())) {
        if (query.includes('prefers-reduced-motion')) continue;
        expect(ALLOWED).toContain(query);
      }
    },
  );
});
