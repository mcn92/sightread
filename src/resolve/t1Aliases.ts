import type { Concept } from './types';
import type { T1Hit, T1Search } from './t1';

class TrustedAliasT1Search implements T1Search {
  enabled = true;
  private aliases: Map<string, Concept>;

  constructor(conceptsByOrdinal: Concept[]) {
    this.aliases = buildTrustedAliases(conceptsByOrdinal);
  }

  search(query: string): T1Hit | null {
    const token = normalizeQueryToken(query);
    if (!token) return null;

    const concept = this.aliases.get(token);
    return concept ? { concept, score: 1 } : null;
  }
}

export function createTrustedAliasT1Search(conceptsByOrdinal: Concept[]): T1Search {
  return new TrustedAliasT1Search(conceptsByOrdinal);
}

const TRUSTED_PY_ALIASES: Record<string, string> = {
  prnt: 'py:builtin:print',
  pritn: 'py:builtin:print',
  pirnt: 'py:builtin:print',
  lne: 'py:builtin:len',
  lenght: 'py:builtin:len',
  length: 'py:builtin:len',
  raneg: 'py:builtin:range',
  enuerate: 'py:builtin:enumerate',
  enumerte: 'py:builtin:enumerate',
  isintance: 'py:builtin:isinstance',
  isntance: 'py:builtin:isinstance',
  sroted: 'py:builtin:sorted',
};

function buildTrustedAliases(concepts: Concept[]): Map<string, Concept> {
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const aliases = new Map<string, Concept>();

  for (const concept of concepts) {
    for (const name of concept.names) {
      const normalized = normalizeAlias(name);
      if (normalized) aliases.set(normalized, concept);
    }
  }

  for (const [alias, conceptId] of Object.entries(TRUSTED_PY_ALIASES)) {
    const concept = byId.get(conceptId);
    if (concept) aliases.set(alias, concept);
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
