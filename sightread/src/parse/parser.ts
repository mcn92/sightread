// tree-sitter lifecycle (design doc §10.1 /parse).
// WASM sources are injectable so the browser app and node tests share this module.

import { Language, Parser, type Tree } from 'web-tree-sitter';

export interface WasmSources {
  /** URL (browser) or absolute path (node) of web-tree-sitter.wasm */
  core: string;
  /** URL/path or raw bytes of the language grammar */
  grammar: string | Uint8Array;
}

let parser: Parser | null = null;
let language: Language | null = null;
let initPromise: Promise<Language> | null = null;

export function initPython(sources: WasmSources): Promise<Language> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await Parser.init({
      locateFile: () => sources.core,
    });
    language = await Language.load(sources.grammar as never);
    parser = new Parser();
    parser.setLanguage(language);
    return language;
  })();
  return initPromise;
}

export function parsePython(code: string): Tree {
  if (!parser) throw new Error('parser not initialized — call initPython() first');
  const tree = parser.parse(code);
  if (!tree) throw new Error('parse returned null');
  return tree;
}
