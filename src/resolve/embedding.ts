export const T1_EMBEDDING_MODEL = {
  id: 'sightread-lexical-semantic-v0',
  revision: '0',
  dim: 384,
  normalize: true,
};

export function embedText(text: string): Float32Array {
  const vector = new Float32Array(T1_EMBEDDING_MODEL.dim);
  const tokens = tokenize(text);

  for (const token of tokens) {
    addFeature(vector, `tok:${token}`, 1);
    for (const part of token.split('_')) {
      if (part.length >= 2) addFeature(vector, `part:${part}`, 0.5);
    }
    for (const gram of charNgrams(token, 3)) {
      addFeature(vector, `tri:${gram}`, 0.3);
    }
  }

  if (T1_EMBEDDING_MODEL.normalize) {
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vector.length; i += 1) {
        vector[i] /= norm;
      }
    }
  }

  return vector;
}

export function embeddingTextForConcept(concept: {
  id: string;
  names: string[];
  category: string;
  explanations?: { novice?: { body?: string }; learning?: { body?: string } };
}, aliases: string[] = []): string {
  return [
    concept.names.join(' ').repeat(4),
    aliases.join(' ').repeat(8),
    concept.id.replaceAll(':', ' '),
    concept.category,
  ].join(' ');
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z_][a-z0-9_+-]*/g) ?? [];
}

function charNgrams(token: string, size: number): string[] {
  const padded = `^${token}$`;
  const grams: string[] = [];
  for (let i = 0; i <= padded.length - size; i += 1) grams.push(padded.slice(i, i + size));
  return grams;
}

function addFeature(vector: Float32Array, feature: string, weight: number): void {
  const index = hash(feature) % vector.length;
  vector[index] += weight;
}

function hash(input: string) {
  let value = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
