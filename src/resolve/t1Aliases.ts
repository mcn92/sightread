import type { Concept } from './types';
import type { T1Hit, T1Search } from './t1';

export interface T1Alias {
  from: string;
  to: string;
}

class TrustedAliasT1Search implements T1Search {
  enabled = true;
  private aliases: Map<string, Concept>;

  constructor(conceptsByOrdinal: Concept[], packAliases: T1Alias[] = []) {
    this.aliases = buildTrustedAliases(conceptsByOrdinal, packAliases);
  }

  search(query: string): T1Hit | null {
    const token = normalizeQueryToken(query);
    if (!token) return null;

    const concept = this.aliases.get(token);
    return concept ? { concept, score: 1 } : null;
  }
}

export function createTrustedAliasT1Search(conceptsByOrdinal: Concept[], aliases: T1Alias[] = []): T1Search {
  return new TrustedAliasT1Search(conceptsByOrdinal, aliases);
}

function buildTrustedAliases(concepts: Concept[], packAliases: T1Alias[]): Map<string, Concept> {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const aliases = new Map<string, Concept>();

  for (const concept of concepts) {
    for (const name of concept.names) {
      const normalized = normalizeAlias(name);
      if (normalized) aliases.set(normalized, concept);
    }
  }

  for (const alias of packAliases) {
    const concept = byId.get(alias.to);
    const normalized = normalizeAlias(alias.from);
    if (concept && normalized) aliases.set(normalized, concept);
  }

  return aliases;
}

function normalizeQueryToken(query: string): string {
  return normalizeAlias(query.split(' - ', 1)[0] ?? '');
}

function normalizeAlias(value: string): string {
  return value
    .toLowerCase()
    .replace(/\(\)$/g, '')
    .replace(/[^a-z0-9_]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
