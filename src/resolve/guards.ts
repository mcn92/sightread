// Guard catalog v1 implementations (pack spec §6.5, M0 subset).
// Guards are the only escape hatch from declarative queries; keep this file small.

import type { Node, Tree } from 'web-tree-sitter';
import type { GuardSpec } from './types';
import type { LangConfig } from './langConfig';

export interface BindingInfo {
  line: number;
}

/** scope node id → bound name → first definition location. Built once per parse. */
export type BindingIndex = Map<number, Map<string, BindingInfo>>;

function addBinding(into: Map<string, BindingInfo>, name: string, node: Node): void {
  if (!into.has(name)) into.set(name, { line: node.startPosition.row + 1 });
}

function collectIdentifiers(node: Node, into: Map<string, BindingInfo>): void {
  if (node.type === 'identifier' || node.type === 'dotted_name') {
    // For dotted imports (import os.path) the bound name is the first segment.
    const text = node.type === 'dotted_name' ? node.text.split('.')[0] : node.text;
    addBinding(into, text, node);
    if (node.type === 'dotted_name') return;
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child) collectIdentifiers(child, into);
  }
}

function enclosingScopeId(node: Node, config: LangConfig): number {
  let cur: Node | null = node;
  while (cur) {
    if (config.scopeNodes.has(cur.type)) return cur.id;
    cur = cur.parent;
  }
  return -1;
}

/** Single tree walk collecting bound names per enclosing scope (best-effort, single-file — N2). */
export function buildBindingIndex(tree: Tree, config: LangConfig): BindingIndex {
  const index: BindingIndex = new Map();
  const ruleByNode = new Map(config.bindingNodes.map((r) => [r.node, r]));

  const visit = (node: Node): void => {
    const rule = ruleByNode.get(node.type);
    if (rule) {
      const scopeId = enclosingScopeId(node, config);
      let names = index.get(scopeId);
      if (!names) {
        names = new Map();
        index.set(scopeId, names);
      }
      if (rule.nameField === '*') {
        collectIdentifiers(node, names);
      } else {
        const field = node.childForFieldName(rule.nameField);
        if (field) collectIdentifiers(field, names);
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) visit(child);
    }
  };
  visit(tree.rootNode);
  return index;
}

function localBinding(node: Node, bindings: BindingIndex, config: LangConfig): BindingInfo | null {
  const name = node.text;
  let cur: Node | null = node;
  while (cur) {
    const binding = config.scopeNodes.has(cur.type) ? bindings.get(cur.id)?.get(name) : undefined;
    if (binding) return binding;
    cur = cur.parent;
  }
  return null;
}

function hasAncestorOfType(node: Node, type: string): boolean {
  let cur = node.parent;
  while (cur) {
    if (cur.type === type) return true;
    cur = cur.parent;
  }
  return false;
}

export type GuardResult =
  | { kind: 'pass' }
  | { kind: 'fail' }
  | { kind: 'fail_shadowed'; binding: BindingInfo };

export function checkGuard(
  spec: GuardSpec,
  captured: Node,
  bindings: BindingIndex,
  config: LangConfig,
): GuardResult {
  switch (spec.guard) {
    case 'not_locally_bound':
      // Distinguished failure: the caller turns this into the honest shadow card (I5).
      {
        const binding = localBinding(captured, bindings, config);
        return binding ? { kind: 'fail_shadowed', binding } : { kind: 'pass' };
      }
    case 'is_callee': {
      const parent = captured.parent;
      const ok = parent?.type === 'call' && parent.childForFieldName('function')?.id === captured.id;
      return ok ? { kind: 'pass' } : { kind: 'fail' };
    }
    case 'inside':
      return hasAncestorOfType(captured, spec.nodeType) ? { kind: 'pass' } : { kind: 'fail' };
    case 'not_inside':
      return hasAncestorOfType(captured, spec.nodeType) ? { kind: 'fail' } : { kind: 'pass' };
  }
}
