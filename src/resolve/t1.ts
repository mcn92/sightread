import Pancake, { type PancakeIndex } from 'pancake-wasm/web';
import type { Concept } from './types';
import { embedText } from './embedding';

interface T1ManifestConfig {
  embedding_model: { id: string; revision: string; dim: number; normalize: boolean } | null;
  t1_threshold: number | null;
}

export interface T1Hit {
  concept: Concept;
  score: number;
}

export interface T1Search {
  search(query: string): T1Hit | null;
  enabled: boolean;
}

class DisabledT1Search implements T1Search {
  enabled = false;
  search(): T1Hit | null {
    return null;
  }
}

class PancakeT1Search implements T1Search {
  enabled = true;
  private index: PancakeIndex;
  private conceptsByOrdinal: Concept[];
  private threshold: number;

  constructor(index: PancakeIndex, conceptsByOrdinal: Concept[], threshold: number) {
    this.index = index;
    this.conceptsByOrdinal = conceptsByOrdinal;
    this.threshold = threshold;
  }

  search(query: string): T1Hit | null {
    const [hit] = this.index.search(embedText(query), 1);
    if (!hit) return null;

    const score = 1 - hit.distance;
    if (score < this.threshold) return null;

    const concept = this.conceptsByOrdinal[hit.id];
    return concept ? { concept, score } : null;
  }
}

export async function loadT1Search(
  indexBytes: Uint8Array,
  manifest: T1ManifestConfig,
  conceptsByOrdinal: Concept[],
): Promise<T1Search> {
  if (!manifest.embedding_model || manifest.t1_threshold == null || indexBytes.byteLength === 0) {
    return new DisabledT1Search();
  }

  const index = await Pancake.create({
    dim: manifest.embedding_model.dim,
    maxElements: Math.max(1, conceptsByOrdinal.length),
    metric: 'cosine',
    quantized: true,
    M: 16,
    efConstruction: 200,
    efSearch: 100,
  });
  index.import(indexBytes);

  if (index.count !== conceptsByOrdinal.length) {
    index.dispose();
    throw new Error(`pancake index count ${index.count} does not match ${conceptsByOrdinal.length} concepts`);
  }

  return new PancakeT1Search(index, conceptsByOrdinal, manifest.t1_threshold);
}
