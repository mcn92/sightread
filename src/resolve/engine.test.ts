// Fixture-style resolver tests (pack spec §9.3, M0 subset).
// Each test taps a character offset and asserts the exact resolution outcome —
// fixtures test the whole §6.2 algorithm, not selectors in isolation.

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { initPython, parsePython } from '../parse/parser';
import { ResolverEngine, type MatchIndex } from './engine';
import { PY_CONCEPTS } from './concepts';
import { PY_CONFIG } from './langConfig';
import type { Language } from 'web-tree-sitter';

const ROOT = process.cwd();

const FIXTURE = `nums = [1, 2, 3]
doubled = [n * 2 for n in nums]
len = 3
count = len
print(count)
if __name__ == "__main__":
    print(f"total: {sum(nums)}")
`;

/** offset of the nth occurrence of `needle` (0-based), pointing at its first char */
function at(needle: string, occurrence = 0): number {
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = FIXTURE.indexOf(needle, idx + 1);
    if (idx === -1) throw new Error(`fixture is missing occurrence ${i} of ${needle}`);
  }
  return idx;
}

let language: Language;
let index: MatchIndex;

beforeAll(async () => {
  language = await initPython({
    core: path.join(ROOT, 'node_modules/web-tree-sitter/web-tree-sitter.wasm'),
    grammar: new Uint8Array(
      readFileSync(path.join(ROOT, 'node_modules/tree-sitter-python/tree-sitter-python.wasm')),
    ),
  });
  const engine = new ResolverEngine(language, PY_CONCEPTS, PY_CONFIG);
  index = engine.index(parsePython(FIXTURE));
});

describe('selector compilation', () => {
  it('every selector in the corpus compiles against the grammar', () => {
    // beforeAll already threw if not; this documents the guarantee explicitly.
    expect(() => new ResolverEngine(language, PY_CONCEPTS, PY_CONFIG)).not.toThrow();
  });
});

describe('resolution (spec §6.2)', () => {
  it('promotes a tap inside a comprehension to the comprehension', () => {
    const card = index.resolveAt(at('for n in nums'), 'novice');
    expect(card?.kind).toBe('concept');
    if (card?.kind === 'concept') {
      expect(card.concept.id).toBe('py:syntax:list-comprehension');
    }
  });

  it('resolves an unshadowed builtin call', () => {
    const card = index.resolveAt(at('print(count)'), 'novice');
    expect(card?.kind).toBe('concept');
    if (card?.kind === 'concept') expect(card.concept.id).toBe('py:builtin:print');
  });

  it('degrades a shadowed builtin to the honest shadow card (I5)', () => {
    // `len = 3` earlier makes the bare `len` in `count = len` a local reference.
    const card = index.resolveAt(at('len', 1), 'novice'); // 2nd len = RHS of `count = len`
    expect(card?.kind).toBe('shadow');
    if (card?.kind === 'shadow') {
      expect(card.shadowedConcept.id).toBe('py:builtin:len');
      expect(card.definitionLine).toBe(3);
    }
  });

  it('includes the definition line for locally bound lexical identifiers', () => {
    const card = index.resolveAt(at('count', 1), 'novice'); // `count` inside `print(count)`
    expect(card?.kind).toBe('lexical');
    if (card?.kind === 'lexical') {
      expect(card.definitionLine).toBe(4);
    }
  });

  it('uses T1 before lexical fallback when no selector matches', () => {
    const t1Engine = new ResolverEngine(language, PY_CONCEPTS, PY_CONFIG, {
      enabled: true,
      search: () => ({ concept: PY_CONCEPTS.find((concept) => concept.id === 'py:builtin:len')!, score: 0.9 }),
    });
    const card = t1Engine.index(parsePython(FIXTURE)).resolveAt(at('count', 1), 'novice');
    expect(card?.kind).toBe('concept');
    if (card?.kind === 'concept') {
      expect(card.concept.id).toBe('py:builtin:len');
      expect(card.tier).toBe('t1_hit');
    }
  });

  it('lets the __main__ idiom outrank the == operator (priority bands)', () => {
    const card = index.resolveAt(at('=='), 'novice');
    expect(card?.kind).toBe('concept');
    if (card?.kind === 'concept') expect(card.concept.id).toBe('py:idiom:main-guard');
  });

  it('resolves a builtin inside an f-string interpolation over the f-string', () => {
    const card = index.resolveAt(at('sum(nums)'), 'novice');
    expect(card?.kind).toBe('concept');
    if (card?.kind === 'concept') expect(card.concept.id).toBe('py:builtin:sum');
  });

  it('resolves f-string text to the f-string concept', () => {
    const card = index.resolveAt(at('total:'), 'novice');
    expect(card?.kind).toBe('concept');
    if (card?.kind === 'concept') expect(card.concept.id).toBe('py:syntax:f-string');
  });

  it('applies level gates: "=" has a card at novice, falls through above (spec §5.3)', () => {
    const eq = at('len = 3') + 4; // the '=' in `len = 3`
    const novice = index.resolveAt(eq, 'novice');
    expect(novice?.kind).toBe('concept');
    if (novice?.kind === 'concept') expect(novice.concept.id).toBe('py:operator:assignment');

    const comfortable = index.resolveAt(eq, 'comfortable');
    expect(comfortable?.kind).toBe('lexical'); // gated out; honest minimal card, never silence
  });

  it('emits tappable ranges for decorations, gated by level', () => {
    const novice = index.tappableRanges('novice').length;
    const comfortable = index.tappableRanges('comfortable').length;
    expect(novice).toBeGreaterThan(10);
    expect(comfortable).toBeLessThan(novice); // gated concepts drop out
  });
});
