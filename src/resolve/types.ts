// Core types for the T0 resolution engine.
// Mirrors the Pack Format & Selector Spec §5–§6, hardcoded for M0 (no packs yet).

export type Level = 'novice' | 'learning' | 'comfortable';
export const LEVELS: Level[] = ['novice', 'learning', 'comfortable'];

export type Category =
  | 'syntax'
  | 'builtin'
  | 'stdlib'
  | 'operator'
  | 'pattern'
  | 'idiom';

/** Closed guard catalog v1 (spec §6.5, M0 subset). */
export type GuardSpec =
  | { guard: 'not_locally_bound'; capture: string }
  | { guard: 'is_callee'; capture: string }
  | { guard: 'inside'; capture: string; nodeType: string }
  | { guard: 'not_inside'; capture: string; nodeType: string };

export interface Selector {
  /** tree-sitter query source (spec §6.4 subset). Must contain the target capture. */
  query: string;
  /** capture that becomes the tappable/resolved node; defaults to 'target'. */
  capture?: string;
  guards?: GuardSpec[];
  /** spec §6.3 priority bands: 80–99 idioms, 50–79 specific, 20–49 general, 1–19 catch-all. */
  priority: number;
}

export interface LevelBody {
  body: string;
}

export interface Concept {
  id: string; // permanent (I14)
  names: string[]; // names[0] is the display name
  category: Category;
  selectors: Selector[];
  /** Suppress this concept's decoration above this level (spec §5.2 level_gate.max). */
  maxLevel?: Level;
  levels: Record<Level, LevelBody>;
  example: { code: string; caption?: string };
  gotcha: string;
}

export interface Range {
  from: number;
  to: number;
}

/** What a tap resolves to (design doc §7). */
export type ResolvedCard =
  | { kind: 'concept'; concept: Concept; range: Range; tier?: 't0' | 't1_hit' }
  | {
      kind: 'shadow'; // I5: a name shadows a known builtin — say so, never pretend
      name: string;
      shadowedConcept: Concept;
      definitionLine: number;
      range: Range;
    }
  | { kind: 'lexical'; text: string; nodeType: string; range: Range; definitionLine?: number; tier?: 'lexical' | 't1_miss' };

export function levelAllows(concept: Concept, level: Level): boolean {
  if (!concept.maxLevel) return true;
  return LEVELS.indexOf(level) <= LEVELS.indexOf(concept.maxLevel);
}
