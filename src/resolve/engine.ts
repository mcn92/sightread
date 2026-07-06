// T0 resolution engine. Implements the normative algorithm of the
// Pack Format & Selector Spec §6.2 over hardcoded M0 concepts.
//
// Lifecycle: compile once per language (ResolverEngine), index once per parse
// (MatchIndex), resolve per tap (resolveAt). The same index drives the editor
// decorations, so "what is tappable" and "what resolves" cannot disagree (§6.6).

import { Query, type Language, type Node, type Tree } from 'web-tree-sitter';
import type { Concept, Level, Range, ResolvedCard } from './types';
import { levelAllows } from './types';
import type { LangConfig } from './langConfig';
import { buildBindingIndex, checkGuard, localBinding, type BindingIndex } from './guards';
import type { T1Search } from './t1';

interface CompiledSelector {
  concept: Concept;
  query: Query;
  captureName: string;
  guards: NonNullable<Concept['selectors'][number]['guards']>;
  priority: number;
}

interface Candidate {
  kind: 'concept' | 'shadow';
  concept: Concept;
  priority: number;
  range: Range;
  span: number;
  definitionLine?: number;
}

interface RankedCandidate extends Candidate {
  tapDepth: number;
}

export class ResolverEngine {
  private compiled: CompiledSelector[] = [];
  private config: LangConfig;
  private t1?: T1Search;

  constructor(language: Language, concepts: Concept[], config: LangConfig, t1?: T1Search) {
    this.config = config;
    this.t1 = t1;
    for (const concept of concepts) {
      for (const sel of concept.selectors) {
        let query: Query;
        try {
          query = new Query(language, sel.query);
        } catch (e) {
          // Loud failure: a selector that doesn't compile is a build error, never a runtime shrug.
          throw new Error(`selector failed to compile for ${concept.id}: ${String(e)}`);
        }
        this.compiled.push({
          concept,
          query,
          captureName: (sel.capture ?? 'target').replace(/^@/, ''),
          guards: sel.guards ?? [],
          priority: sel.priority,
        });
      }
    }
  }

  index(tree: Tree): MatchIndex {
    const bindings = buildBindingIndex(tree, this.config);
    const byNode = new Map<number, Candidate[]>();
    const seen = new Set<string>();

    for (const sel of this.compiled) {
      for (const match of sel.query.matches(tree.rootNode)) {
        const target = match.captures.find((c) => c.name === sel.captureName)?.node;
        if (!target) continue;

        let kind: Candidate['kind'] = 'concept';
        let definitionLine: number | undefined;
        let pass = true;
        for (const guard of sel.guards) {
          const capturedName = guard.capture.replace(/^@/, '');
          const captured = match.captures.find((c) => c.name === capturedName)?.node;
          if (!captured) {
            pass = false;
            break;
          }
          const result = checkGuard(guard, captured, bindings, this.config);
          if (result.kind === 'fail_shadowed') {
            kind = 'shadow'; // I5: degrade to the honest card, don't go silent
            definitionLine = result.binding.line;
          } else if (result.kind === 'fail') {
            pass = false;
            break;
          }
        }
        if (!pass) continue;

        const dedupeKey = `${sel.concept.id}:${kind}:${target.id}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const candidate: Candidate = {
          kind,
          concept: sel.concept,
          priority: sel.priority,
          range: { from: target.startIndex, to: target.endIndex },
          span: target.endIndex - target.startIndex,
          definitionLine,
        };
        const list = byNode.get(target.id);
        if (list) list.push(candidate);
        else byNode.set(target.id, [candidate]);
      }
    }
    return new MatchIndex(tree, byNode, this.config, bindings, this.t1);
  }
}

export class MatchIndex {
  private tree: Tree;
  private byNode: Map<number, Candidate[]>;
  private config: LangConfig;
  private bindings: BindingIndex;
  private t1?: T1Search;

  constructor(tree: Tree, byNode: Map<number, Candidate[]>, config: LangConfig, bindings: BindingIndex, t1?: T1Search) {
    this.tree = tree;
    this.byNode = byNode;
    this.config = config;
    this.bindings = bindings;
    this.t1 = t1;
  }

  /** Every tappable range, for editor decorations (spec §6.6: one source of truth). */
  tappableRanges(level: Level): Range[] {
    const ranges: Range[] = [];
    const emitted = new Set<string>();
    for (const candidates of this.byNode.values()) {
      for (const c of candidates) {
        if (c.kind === 'concept' && !levelAllows(c.concept, level)) continue;
        const key = `${c.range.from}:${c.range.to}`;
        if (emitted.has(key)) continue;
        emitted.add(key);
        ranges.push(c.range);
      }
    }
    return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  }

  /** Spec §6.2, steps 1–6. */
  resolveAt(offset: number, level: Level): ResolvedCard | null {
    const smallest = this.tree.rootNode.descendantForIndex(offset);
    if (!smallest) return null;

    // Step 1a: comments are always lexical.
    if (this.inCommentChain(smallest)) {
      return {
        kind: 'lexical',
        text: smallest.text.slice(0, 80),
        nodeType: 'comment',
        range: { from: smallest.startIndex, to: smallest.endIndex },
      };
    }

    // Step 2: candidate chain up to and including the first promotion stop.
    const chain: Node[] = [];
    let cur: Node | null = smallest;
    while (cur) {
      chain.push(cur);
      if (this.config.promotionStops.has(cur.type)) break;
      cur = cur.parent;
    }

    // Step 3: collect matching candidates along the chain.
    const candidates: RankedCandidate[] = [];
    for (let depth = 0; depth < chain.length; depth += 1) {
      const node = chain[depth];
      const list = this.byNode.get(node.id);
      if (list) candidates.push(...list.map((candidate) => ({ ...candidate, tapDepth: depth })));
    }

    // Step 5 folded into ranking: level-gated concepts fall through (spec §6.2 step 5).
    const eligible = candidates.filter(
      (c) => c.kind === 'shadow' || levelAllows(c.concept, level),
    );

    // Step 4: high-priority idioms may beat parts; otherwise nearest tapped node wins.
    eligible.sort((a, b) => {
      const aIdiom = a.priority >= 80 ? 1 : 0;
      const bIdiom = b.priority >= 80 ? 1 : 0;
      return bIdiom - aIdiom || a.tapDepth - b.tapDepth || b.priority - a.priority || a.span - b.span;
    });
    const winner = eligible[0];

    if (winner) {
      if (winner.kind === 'shadow') {
        return {
          kind: 'shadow',
          name: this.tree.rootNode.descendantForIndex(winner.range.from)?.text ?? '',
          shadowedConcept: winner.concept,
          definitionLine: winner.definitionLine ?? 1,
          range: winner.range,
        };
      }
      return { kind: 'concept', concept: winner.concept, range: winner.range, tier: 't0' };
    }

    // Step 6 fallback: leaf tokens get a minimal lexical card, structure gets nothing.
    if (smallest.childCount === 0 && smallest.text.trim().length > 0) {
      const binding = smallest.type === 'identifier' ? localBinding(smallest, this.bindings, this.config) : null;
      if (!binding) {
        const t1Hit = this.t1?.search(this.queryText(smallest));
        if (t1Hit) {
          return {
            kind: 'concept',
            concept: t1Hit.concept,
            range: { from: smallest.startIndex, to: smallest.endIndex },
            tier: 't1_hit',
          };
        }
      }
      return {
        kind: 'lexical',
        text: smallest.text.slice(0, 80),
        nodeType: smallest.type,
        range: { from: smallest.startIndex, to: smallest.endIndex },
        definitionLine: binding?.line,
        tier: this.t1?.enabled ? 't1_miss' : 'lexical',
      };
    }
    return null;
  }

  private inCommentChain(node: Node): boolean {
    let cur: Node | null = node;
    while (cur) {
      if (this.config.commentNodes.has(cur.type)) return true;
      cur = cur.parent;
    }
    return false;
  }

  private queryText(node: Node): string {
    const parent = node.parent;
    const text = node.text.slice(0, 120);
    return parent ? `${text} - ${node.type} inside ${parent.type}` : `${text} - ${node.type}`;
  }
}
