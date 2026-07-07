import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import Pancake from 'pancake-wasm/node';

const ROOT = process.cwd();
const FORMAT_VERSION = '1.0';
const PACK_VERSION = 0;
const LEVELS = ['novice', 'learning', 'comfortable'];
const CATEGORIES = new Set(['syntax', 'builtin', 'stdlib', 'operator', 'pattern', 'idiom']);
const GUARDS = new Set(['not_locally_bound', 'is_callee', 'inside', 'not_inside', 'text_in_pack_list']);
const T1_EMBEDDING_MODEL = {
  id: 'sightread-lexical-semantic-v0',
  revision: '0',
  dim: 384,
  normalize: true,
};
const T1_THRESHOLD = 0.25;

function readJsonYaml(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJsonYaml(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function loadTsExport(file, exportName) {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const sandbox = { exports: {} };
  vm.runInNewContext(js, sandbox, { filename: file });
  return sandbox.exports[exportName];
}

function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}

function lineCount(text) {
  return String(text).split('\n').length;
}

function hash(input) {
  let value = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function embedText(text) {
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
      for (let i = 0; i < vector.length; i += 1) vector[i] /= norm;
    }
  }

  return vector;
}

function tokenize(text) {
  return String(text).toLowerCase().match(/[a-z_][a-z0-9_+-]*/g) ?? [];
}

function charNgrams(token, size) {
  const padded = `^${token}$`;
  const grams = [];
  for (let i = 0; i <= padded.length - size; i += 1) grams.push(padded.slice(i, i + size));
  return grams;
}

function addFeature(vector, feature, weight) {
  vector[hash(feature) % vector.length] += weight;
}

function t1Text(concept, aliases) {
  return [
    concept.names.join(' ').repeat(4),
    aliases.join(' ').repeat(8),
    concept.id.replaceAll(':', ' '),
    concept.category,
  ].join(' ');
}

function validatePackConfig(config) {
  const requiredArrays = ['promotion_stops', 'binding_nodes', 'scope_nodes', 'comment_nodes', 'string_nodes'];
  if (config.lang !== 'py') throw new Error('this skeleton currently supports only lang=py');
  if (config.display_name !== 'Python') throw new Error('expected display_name=Python');
  for (const field of requiredArrays) {
    if (!Array.isArray(config[field])) throw new Error(`pack.yaml ${field} must be an array`);
  }
  for (const rule of config.binding_nodes) {
    if (typeof rule.node !== 'string' || typeof rule.name_field !== 'string') {
      throw new Error('pack.yaml binding_nodes entries need node and name_field');
    }
  }
}

function validateSelector(concept, selector) {
  if (typeof selector.query !== 'string' || selector.query.length === 0) {
    throw new Error(`${concept.id}: selector query is required`);
  }
  if (selector.query.length > 512) throw new Error(`${concept.id}: selector query exceeds 512 bytes`);
  const capture = selector.capture ?? '@target';
  if (typeof capture !== 'string' || !capture.startsWith('@')) {
    throw new Error(`${concept.id}: selector capture must start with @`);
  }
  if (typeof selector.priority !== 'number') throw new Error(`${concept.id}: selector priority is required`);
  for (const guard of selector.guards ?? []) {
    if (!GUARDS.has(guard.guard)) throw new Error(`${concept.id}: unknown guard ${guard.guard}`);
    if (typeof guard.capture !== 'string' || !guard.capture.startsWith('@')) {
      throw new Error(`${concept.id}: guard ${guard.guard} capture must start with @`);
    }
  }
}

function validateConcept(concept, config) {
  if (!/^[a-z0-9]+:[a-z]+:[a-z0-9-]+$/.test(concept.id)) {
    throw new Error(`${concept.id}: invalid concept id`);
  }
  const [lang, category] = concept.id.split(':');
  if (lang !== config.lang) throw new Error(`${concept.id}: id lang does not match pack lang`);
  if (category !== concept.category) throw new Error(`${concept.id}: id category does not match category`);
  if (!CATEGORIES.has(concept.category)) throw new Error(`${concept.id}: invalid category`);
  if (!Array.isArray(concept.names) || concept.names.length < 1 || concept.names.length > 8) {
    throw new Error(`${concept.id}: names must contain 1-8 entries`);
  }
  for (const name of concept.names) {
    if (typeof name !== 'string' || name.length > 60) throw new Error(`${concept.id}: invalid name`);
  }
  if (concept.category !== 'pattern' && (!Array.isArray(concept.selectors) || concept.selectors.length === 0)) {
    throw new Error(`${concept.id}: selector-bearing concepts need selectors`);
  }
  if ((concept.selectors ?? []).length > 12) throw new Error(`${concept.id}: too many selectors`);
  for (const selector of concept.selectors ?? []) validateSelector(concept, selector);
  for (const level of LEVELS) {
    const explanation = concept.explanations?.[level];
    if (!explanation) throw new Error(`${concept.id}: missing ${level} explanation`);
    if (wordCount(explanation.body) > 120) throw new Error(`${concept.id}: ${level} body exceeds 120 words`);
    if (wordCount(explanation.gotcha) > 40) throw new Error(`${concept.id}: ${level} gotcha exceeds 40 words`);
    if (!explanation.example?.code) throw new Error(`${concept.id}: ${level} example code is required`);
    if (lineCount(explanation.example.code) > 12) throw new Error(`${concept.id}: ${level} example exceeds 12 lines`);
  }
  if (!['original', 'generated_reviewed'].includes(concept.provenance?.examples)) {
    throw new Error(`${concept.id}: provenance.examples is required`);
  }
}

function validateAliases(aliases, ids) {
  if (!Array.isArray(aliases)) throw new Error('aliases.yaml must be an array');
  const seen = new Set();
  for (const alias of aliases) {
    if (!alias || typeof alias.from !== 'string' || typeof alias.to !== 'string') {
      throw new Error('aliases.yaml entries need from and to strings');
    }
    if (!/^[a-z_][a-z0-9_+-]*$/.test(alias.from)) {
      throw new Error(`aliases.yaml invalid alias ${alias.from}`);
    }
    if (!ids.has(alias.to)) throw new Error(`aliases.yaml points at unknown concept ${alias.to}`);
    const key = `${alias.from}:${alias.to}`;
    if (seen.has(key)) throw new Error(`aliases.yaml duplicate alias ${key}`);
    seen.add(key);
  }
}

function sourceConceptToCompiled(concept) {
  return {
    id: concept.id,
    names: concept.names,
    category: concept.category,
    level_gate: concept.level_gate ?? {},
    selectors: concept.selectors ?? [],
    related: concept.related ?? [],
    explanations: Object.fromEntries(
      LEVELS.map((level) => [
        level,
        {
          body: concept.explanations[level].body,
          example: {
            code: concept.explanations[level].example.code,
            expected_output: concept.explanations[level].example.expected_output ?? null,
          },
          gotcha: concept.explanations[level].gotcha,
          version: 1,
        },
      ]),
    ),
    deep_dive: concept.deep_dive ?? null,
  };
}

function compiledToRuntimeConcept(concept) {
  return {
    id: concept.id,
    names: concept.names,
    category: concept.category,
    selectors: concept.selectors,
    maxLevel: concept.level_gate?.max,
    levels: Object.fromEntries(LEVELS.map((level) => [level, { body: concept.explanations[level].body }])),
    example: { code: concept.explanations.novice.example.code },
    gotcha: concept.explanations.novice.gotcha,
  };
}

function findConceptFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findConceptFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.yaml')) files.push(full);
  }
  return files.sort();
}

async function buildPack() {
  const packRoot = path.join(ROOT, 'packs/py');
  const srcRoot = path.join(packRoot, 'src');
  const outRoot = path.join(packRoot, 'build/v0');
  const publicRoot = path.join(ROOT, 'public/packs/py/v0');
  const config = readJsonYaml(path.join(srcRoot, 'pack.yaml'));
  validatePackConfig(config);

  const concepts = findConceptFiles(path.join(srcRoot, 'concepts')).map(readJsonYaml);
  const ids = new Set();
  for (const concept of concepts) {
    validateConcept(concept, config);
    if (ids.has(concept.id)) throw new Error(`${concept.id}: duplicate concept id`);
    ids.add(concept.id);
  }
  concepts.sort((a, b) => a.id.localeCompare(b.id));

  const aliases = readJsonYaml(path.join(srcRoot, 'aliases.yaml'));
  validateAliases(aliases, ids);
  const aliasesByConcept = new Map();
  for (const alias of aliases) {
    const list = aliasesByConcept.get(alias.to);
    if (list) list.push(alias.from);
    else aliasesByConcept.set(alias.to, [alias.from]);
  }

  fs.rmSync(outRoot, { recursive: true, force: true });
  fs.rmSync(publicRoot, { recursive: true, force: true });
  fs.mkdirSync(outRoot, { recursive: true });
  fs.mkdirSync(publicRoot, { recursive: true });
  const compiled = {
    format_version: FORMAT_VERSION,
    lang: config.lang,
    pack_version: PACK_VERSION,
    config,
    concepts: concepts.map(sourceConceptToCompiled),
    ordinals: concepts.map((concept) => concept.id),
  };
  writeJsonYaml(path.join(outRoot, 'concepts.json'), compiled);
  writeJsonYaml(path.join(outRoot, 'runtime-concepts.json'), compiled.concepts.map(compiledToRuntimeConcept));
  writeJsonYaml(path.join(outRoot, 'aliases.json'), aliases);

  const grammarSource = path.join(ROOT, 'public/tree-sitter-python.wasm');
  const grammarTarget = path.join(outRoot, 'grammar.wasm');
  fs.copyFileSync(grammarSource, grammarTarget);
  const { index } = await Pancake.fromVectors(
    concepts.map((concept) => embedText(t1Text(concept, aliasesByConcept.get(concept.id) ?? []))),
    {
      dim: T1_EMBEDDING_MODEL.dim,
      maxElements: concepts.length,
      metric: 'cosine',
      quantized: true,
      M: 16,
      efConstruction: 200,
      efSearch: 100,
    },
  );
  fs.writeFileSync(path.join(outRoot, 'index.pancake'), index.export());
  index.dispose();

  const files = ['concepts.json', 'runtime-concepts.json', 'aliases.json', 'grammar.wasm', 'index.pancake'].map(
    (name) => {
      const bytes = fs.readFileSync(path.join(outRoot, name));
      return { path: name, bytes: bytes.length, sha256: sha256(bytes) };
    },
  );

  writeJsonYaml(path.join(outRoot, 'manifest.json'), {
    format_version: FORMAT_VERSION,
    lang: config.lang,
    pack_version: PACK_VERSION,
    created_at: new Date(0).toISOString(),
    min_app_version: '0.0.0',
    skeleton: true,
    grammar: { name: 'tree-sitter-python', revision: 'npm:tree-sitter-python@0.25.0' },
    embedding_model: T1_EMBEDDING_MODEL,
    t1_threshold: T1_THRESHOLD,
    files,
    signature: { alg: 'unsigned-skeleton', key_id: null, sig: null },
  });

  for (const name of ['concepts.json', 'runtime-concepts.json', 'aliases.json', 'grammar.wasm', 'index.pancake', 'manifest.json']) {
    fs.copyFileSync(path.join(outRoot, name), path.join(publicRoot, name));
  }

  console.log(
    `Built ${concepts.length} concepts into ${path.relative(ROOT, outRoot)} and ${path.relative(ROOT, publicRoot)}`,
  );
}

function migrateM0() {
  const concepts = loadTsExport(path.join(ROOT, 'src/resolve/concepts.ts'), 'PY_CONCEPTS');
  const config = loadTsExport(path.join(ROOT, 'src/resolve/langConfig.ts'), 'PY_CONFIG');
  const srcRoot = path.join(ROOT, 'packs/py/src');
  const conceptsRoot = path.join(srcRoot, 'concepts');

  fs.rmSync(conceptsRoot, { recursive: true, force: true });
  fs.mkdirSync(conceptsRoot, { recursive: true });

  writeJsonYaml(path.join(srcRoot, 'pack.yaml'), {
    lang: config.lang,
    display_name: 'Python',
    promotion_stops: [...config.promotionStops],
    binding_nodes: config.bindingNodes.map((rule) => ({
      node: rule.node,
      name_field: rule.nameField,
    })),
    scope_nodes: [...config.scopeNodes],
    comment_nodes: [...config.commentNodes],
    string_nodes: ['string'],
  });
  writeJsonYaml(path.join(srcRoot, 'aliases.yaml'), []);

  for (const concept of concepts) {
    const [, category, slug] = concept.id.split(':');
    const sourceConcept = {
      id: concept.id,
      names: concept.names,
      category: concept.category,
      level_gate: concept.maxLevel ? { max: concept.maxLevel } : {},
      selectors: concept.selectors,
      related: [],
      explanations: Object.fromEntries(
        LEVELS.map((level) => [
          level,
          {
            body: concept.levels[level].body,
            example: { code: concept.example.code, expected_output: null },
            gotcha: concept.gotcha,
          },
        ]),
      ),
      provenance: { examples: 'original' },
    };
    writeJsonYaml(path.join(conceptsRoot, category, `${slug}.yaml`), sourceConcept);
  }

  console.log(`Migrated ${concepts.length} M0 concepts into ${path.relative(ROOT, conceptsRoot)}`);
}

if (process.argv.includes('--migrate-m0')) {
  migrateM0();
} else {
  await buildPack();
}
