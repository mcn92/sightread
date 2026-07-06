export const T1_EMBEDDING_MODEL = {
  id: 'sightread-hash-embedding-v0',
  revision: '0',
  dim: 128,
  normalize: true,
};

export function embedText(text: string): Float32Array {
  const vector = new Float32Array(T1_EMBEDDING_MODEL.dim);
  const tokens = text.toLowerCase().match(/[a-z_][a-z0-9_+-]*/g) ?? [];

  for (const token of tokens) {
    const index = hash(token) % vector.length;
    vector[index] += 1;
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

function hash(input: string) {
  let value = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}
