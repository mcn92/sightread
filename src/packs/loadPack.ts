import type { Concept } from '../resolve/types';
import type { LangConfig } from '../resolve/langConfig';
import { loadT1Search, type T1Search } from '../resolve/t1';
import type { T1Alias } from '../resolve/t1Aliases';

interface PackFile {
  path: string;
  bytes: number;
  sha256: string;
}

interface PackManifest {
  format_version: string;
  lang: string;
  pack_version: number;
  min_app_version: string;
  skeleton?: boolean;
  embedding_model: { id: string; revision: string; dim: number; normalize: boolean } | null;
  t1_threshold: number | null;
  files: PackFile[];
  signature: { alg: string; key_id: string | null; sig: string | null };
}

interface PackConfigSource {
  lang: string;
  promotion_stops: string[];
  binding_nodes: Array<{ node: string; name_field: string }>;
  scope_nodes: string[];
  comment_nodes: string[];
}

interface CompiledPack {
  format_version: string;
  lang: string;
  pack_version: number;
  config: PackConfigSource;
}

export interface RuntimePack {
  manifest: PackManifest;
  concepts: Concept[];
  config: LangConfig;
  grammar: Uint8Array;
  t1: T1Search;
}

const PACK_BASE_URL = '/packs/py/v0';

let packPromise: Promise<RuntimePack> | null = null;

export function loadPythonPack(): Promise<RuntimePack> {
  packPromise ??= loadPack(PACK_BASE_URL);
  return packPromise;
}

async function loadPack(baseUrl: string): Promise<RuntimePack> {
  const manifest = await fetchJsonUnchecked<PackManifest>(`${baseUrl}/manifest.json`);
  verifyManifestSkeleton(manifest);

  const conceptsPack = await fetchVerifiedJson<CompiledPack>(baseUrl, manifest, 'concepts.json');
  const concepts = await fetchVerifiedJson<Concept[]>(baseUrl, manifest, 'runtime-concepts.json');
  const aliases = await fetchVerifiedJson<T1Alias[]>(baseUrl, manifest, 'aliases.json');
  const grammar = await fetchVerifiedBytes(baseUrl, manifest, 'grammar.wasm');
  const indexBytes = await fetchVerifiedBytes(baseUrl, manifest, 'index.pancake');

  if (conceptsPack.lang !== manifest.lang || conceptsPack.pack_version !== manifest.pack_version) {
    throw new Error('pack concepts metadata does not match manifest');
  }

  return {
    manifest,
    concepts,
    config: toLangConfig(conceptsPack.config),
    grammar,
    t1: await loadT1Search(indexBytes, manifest, concepts, aliases),
  };
}

function verifyManifestSkeleton(manifest: PackManifest): void {
  if (manifest.format_version.split('.')[0] !== '1') {
    throw new Error(`unsupported pack format ${manifest.format_version}`);
  }
  if (manifest.lang !== 'py') throw new Error(`unsupported pack lang ${manifest.lang}`);
  if (manifest.signature.alg !== 'unsigned-skeleton' || manifest.skeleton !== true) {
    throw new Error('signed pack verification is not implemented in the M1 skeleton');
  }
  for (const required of ['concepts.json', 'runtime-concepts.json', 'grammar.wasm', 'index.pancake']) {
    if (!manifest.files.some((file) => file.path === required)) {
      throw new Error(`pack manifest is missing ${required}`);
    }
  }
}

async function fetchJsonUnchecked<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
  return (await response.json()) as T;
}

async function fetchVerifiedJson<T>(baseUrl: string, manifest: PackManifest, filePath: string): Promise<T> {
  const bytes = await fetchVerifiedBytes(baseUrl, manifest, filePath);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function fetchVerifiedBytes(baseUrl: string, manifest: PackManifest, filePath: string): Promise<Uint8Array> {
  const file = manifest.files.find((entry) => entry.path === filePath);
  if (!file) throw new Error(`pack manifest is missing ${filePath}`);

  const response = await fetch(`${baseUrl}/${filePath}`);
  if (!response.ok) throw new Error(`failed to fetch ${filePath}: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== file.bytes) {
    throw new Error(`pack file ${filePath} has wrong byte length`);
  }
  const actual = await digestHex(bytes);
  if (actual !== file.sha256) {
    throw new Error(`pack file ${filePath} failed sha256 verification`);
  }
  return bytes;
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const input = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(input).set(bytes);
  const hash = await crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toLangConfig(config: PackConfigSource): LangConfig {
  return {
    lang: config.lang,
    promotionStops: new Set(config.promotion_stops),
    bindingNodes: config.binding_nodes.map((rule) => ({
      node: rule.node,
      nameField: rule.name_field,
    })),
    scopeNodes: new Set(config.scope_nodes),
    commentNodes: new Set(config.comment_nodes),
  };
}
