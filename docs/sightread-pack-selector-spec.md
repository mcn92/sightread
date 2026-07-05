# Sightread — Content Pack Format & Selector Specification

**Format version:** 1.0
**Status:** Draft until first pack ships; frozen (major-versioned) thereafter
**Companion to:** `sightread-design-doc.md` v0.1 (invariants referenced as I-numbers)

This document is the contract between the content pipeline (which builds packs), the runtime (which consumes them), and CI (which refuses to let either drift). It is written to be sufficient for a new contributor to author concepts, extend the pipeline, or implement the runtime loader without access to the founder.

---

## 1. Scope and terms

- **Pack** — a versioned, signed bundle of everything the app needs to support one language: concepts, explanations, selectors, embedding index, grammar.
- **Concept** — a nameable idea a learner can tap into: a syntax form, builtin, stdlib entity, operator, or idiom. Identified permanently by a concept id (I14).
- **Explanation** — the authored content for one (concept, learner level) pair.
- **Selector** — a declarative rule mapping AST shapes to a concept (the T0 mechanism, design doc §7.2).
- **Guard** — a named, host-implemented predicate a selector may require (e.g., "this identifier is not locally bound"). Guards are the *only* escape hatch from declarative matching; the catalog is closed (§6.5).
- **Fixture** — a code snippet plus expected tap-resolution outcomes, used by CI to validate selectors (§9.3).

Normative keywords **MUST / MUST NOT / SHOULD / MAY** are used in the RFC-2119 sense.

---

## 2. Pack layout and distribution

### 2.1 Published layout

```
packs/{lang}/v{N}/
  manifest.json          # §3 — hashes and signature over everything else
  concepts.json          # §7 — compiled concepts, explanations, selectors
  index.pancake          # §8 — serialized embedding index
  grammar.wasm           # tree-sitter grammar for {lang}
  aliases.json           # §5.4 — append-only id alias map
```

Published to R2/CDN at immutable, content-versioned URLs (`/packs/py/v3/…`). Files at a published version MUST never change (cache-forever headers); fixes ship as v{N+1}. A small mutable pointer, `/packs/py/latest.json` `{ "version": N, "min_app_version": "x.y.z" }`, tells clients what current is.

### 2.2 Source layout (in-repo)

```
packs/{lang}/src/
  pack.yaml                    # §4 — language-level configuration
  concepts/{category}/{name}.yaml   # §5 — one file per concept
  aliases.yaml                 # §5.4
  fixtures/                    # §9.3
  corpus/                      # real-world files for coverage measurement (§9.5)
```

---

## 3. Manifest and verification (I13)

### 3.1 `manifest.json` schema

```json
{
  "format_version": "1.0",
  "lang": "py",
  "pack_version": 3,
  "created_at": "2026-08-01T00:00:00Z",
  "min_app_version": "0.4.0",
  "grammar": { "name": "tree-sitter-python", "revision": "<git sha>" },
  "embedding_model": { "id": "<model id>", "revision": "<pin>", "dim": 384,
                       "normalize": true },
  "t1_threshold": 0.62,
  "files": [
    { "path": "concepts.json",  "bytes": 1834211, "sha256": "<hex>" },
    { "path": "index.pancake",  "bytes": 2411520, "sha256": "<hex>" },
    { "path": "grammar.wasm",   "bytes": 1310720, "sha256": "<hex>" },
    { "path": "aliases.json",   "bytes": 412,     "sha256": "<hex>" }
  ],
  "signature": { "alg": "ed25519", "key_id": "sightread-packs-2026",
                 "sig": "<base64 over JCS-canonicalized manifest sans this field>" }
}
```

### 3.2 Verification order (runtime, MUST)

1. Fetch manifest; canonicalize per RFC 8785 (JCS) with `signature` removed; verify ed25519 signature against the public key pinned in the app build. Key rotation ships as an app update carrying both old and new keys for one overlap period.
2. Check `format_version` major == app-supported major; check `min_app_version` ≤ running version. Fail → pack rejected with `pack_verify_failed(stage=manifest_sig)` analytics class as appropriate.
3. For each file, verify byte length **before** hashing (cheap size cap: any file > 2× its manifest `bytes` aborts the download) and sha256 **before** the bytes reach any parser.
4. `concepts.json` parses under the schema in §7 with hard caps (§7.4).
5. All selector queries compile against the shipped grammar (§6.7). Any compile failure rejects the *entire pack* — partial packs do not exist.
6. `index.pancake` loads through the hardened deserializer, including entry-point-level and edge-level-topology validation. Its embedded model id MUST equal `embedding_model.id` (I15); mismatch disables T1 for this pack (degrade, don't reject — T0 is unaffected).

A pack failing at any stage is discarded and refetched at most twice, then the previous cached version (if any) remains active.

---

## 4. Language configuration — `pack.yaml`

Per-language knowledge the selector engine needs. All fields required.

```yaml
lang: py
display_name: Python
promotion_stops:            # node types that bound upward promotion (§6.2)
  - expression_statement
  - assignment
  - return_statement
  - if_statement
  - for_statement
  - while_statement
  - function_definition     # a tap never resolves above these
binding_nodes:              # how names get bound; consumed by guard G1 (§6.5)
  - { node: assignment,            name_field: left }
  - { node: parameters,            name_field: "*" }
  - { node: for_statement,         name_field: left }
  - { node: import_from_statement, name_field: name }
  - { node: import_statement,      name_field: name }
  - { node: with_item,             name_field: alias }
scope_nodes: [function_definition, lambda, class_definition, module]
comment_nodes: [comment]    # taps on these always resolve lexically
string_nodes: [string]      # taps inside resolve to the string concept unless
                            # an inner node (f-string interpolation) matches first
```

---

## 5. Concept authoring schema

### 5.1 One YAML file per concept

```yaml
# packs/py/src/concepts/syntax/list-comprehension.yaml
id: py:syntax:list-comprehension
names:                      # first entry is the display name
  - list comprehension
  - "[x for x in ...]"
category: syntax            # §5.2
level_gate: {}              # §5.3; empty = shown at all levels
selectors:                  # §6; at least one required unless category == pattern
  - query: "(list_comprehension) @target"
    priority: 50
related: [py:syntax:generator-expression, py:builtin:map]
explanations:
  novice:
    body: >
      A list comprehension builds a new list by transforming each item of
      an existing sequence, all in one line. Read it inside-out: "for x in
      numbers" walks the list; "x * 2" says what to keep.
    example:
      code: |
        numbers = [1, 2, 3]
        doubled = [x * 2 for x in numbers]   # [2, 4, 6]
      expected_output: null        # set when example prints; CI executes (§9.4)
    gotcha: >
      The brackets matter: with parentheses instead, you get a generator,
      not a list.
  learning: { ... }          # same shape; register per style guide
  comfortable: { ... }
  deep_dive: |               # optional, single markdown body, level-neutral
    ...
provenance:
  examples: original          # original | generated_reviewed
  reviewed_by: <handle>
```

### 5.2 Field constraints

- `id`: MUST match `^[a-z0-9]+:[a-z]+:[a-z0-9-]+$`; segment 1 MUST equal `pack.yaml lang`; segment 2 MUST be the `category`. Ids are permanent (I14, §5.4).
- `names`: 1–8 entries, each ≤ 60 chars. These feed both display and the embedding text (§8.2).
- `category`: closed enum `syntax | builtin | stdlib | operator | pattern | idiom`. `pattern`/`idiom` entries MAY omit selectors (reachable via T1 and `related` links only).
- `level_gate`: `{ min?: level, max?: level }` over `novice < learning < comfortable`. `max: novice` suppresses the card above novice (noise control: don't explain `=` to a comfortable reader — the token simply isn't decorated at that level). `min` reserves advanced-only cards.
- `explanations`: all three levels REQUIRED for selector-bearing concepts (a tappable token must never dead-end); `pattern`/`idiom` MAY provide `learning` + `comfortable` only. `body` ≤ 120 words; `gotcha` ≤ 40 words; exactly one `example` per level, ≤ 12 lines.
- `provenance.examples`: REQUIRED. `generated_reviewed` additionally requires `reviewed_by`. No third value exists — unreviewed generated content cannot ship (design doc §13, I6).

### 5.3 Level semantics

The learner level changes *which explanation body renders* and *which concepts decorate at all* (`level_gate`). It MUST NOT change selector behavior — resolution is level-independent so that the event log's `concept_id` stream is comparable across level changes.

### 5.4 Id permanence and aliases (I14)

Renaming a concept = create the new YAML with the new id, delete the old file, and append to `aliases.yaml`:

```yaml
- { old: py:builtin:print-function, new: py:builtin:print, since_pack: 4 }
```

Rules: the alias map is append-only; an `old` id MUST never reappear as a live id; chains are permitted but the compiler flattens them (`aliases.json` ships fully resolved, old → terminal). At runtime, alias resolution happens at the pack boundary: any id read from a pack or challenge is translated to its terminal id *before* it reaches the resolver, the event log, or the knowledge model — the rest of the app never sees an aliased id. Historical events containing old ids are translated during knowledge-model fold using the same map.

---

## 6. Selector specification

### 6.1 Foundational decision

Selectors are **tree-sitter queries** (the S-expression query language) plus a bounded extension layer, not a bespoke DSL. Rationale: the query engine is already implemented, documented, and available in web-tree-sitter; captures and predicates cover the large majority of T0 needs; inventing a matcher engine is exactly the kind of novelty this project must not spend (design doc §5 principle). The extension layer exists only for facts a context-free query cannot know — scope and binding — and is a closed catalog of named guards (§6.5).

A selector object:

```yaml
- query: "(call function: (identifier) @callee (#eq? @callee \"len\")) @target"
  capture: "@target"        # optional; defaults to @target; MUST exist in query
  guards: [not_locally_bound(@callee)]
  priority: 60
```

### 6.2 Resolution semantics (normative)

Given a tap at character offset *o*:

1. **Smallest node.** `n₀ = tree.descendantForIndex(o)`. If `n₀` is inside a `comment_nodes` type → lexical card, stop.
2. **Candidate chain.** Walk ancestors `n₀, n₁, …` upward, stopping *after* the first node whose type ∈ `promotion_stops` (that node is included; nothing above it is).
3. **Match set.** From the precomputed match index (§6.6), collect every (selector, node) pair whose captured `@target` node is in the chain and whose guards all pass (§6.5).
4. **Selection.** Highest `priority` wins. Priority ties → the match whose `@target` has the *smallest byte span* wins (most specific). Span ties → **build-time error**: CI rejects any selector set that can produce a span-and-priority tie on any fixture or corpus file (§9.5). Determinism is a requirement, not a preference: the same tap MUST resolve identically across sessions and versions of the runtime.
5. **Level gate.** If the winning concept is suppressed at the current level (§5.3), fall through to the next-ranked match; if none remains, lexical card.
6. **No match.** Escalate to T1 with the query construction rules of design doc §7.3.

### 6.3 Priority bands (convention, CI-linted)

`80–99` narrow idioms that must beat their parts (e.g., `if __name__ == "__main__"` beats `__name__` beats `==`); `50–79` specific constructs (builtin calls, comprehensions); `20–49` general syntax (operators, keywords); `1–19` catch-alls (a bare `identifier` selector MUST NOT exist — identifiers resolve only via specific selectors or T1). Two selectors of the *same concept* may overlap freely (alternate surface forms); the tie rule applies across concepts.

### 6.4 Query language subset (normative)

Allowed: node types, field names, captures, alternations `[...]`, anchors `.`, wildcards `_`, quantifiers `? * +`, and predicates `#eq?`, `#not-eq?`, `#any-of?`, `#match?`. Constraints: `#match?` patterns MUST be linear-time-safe (CI rejects nested quantifiers over groups and backreferences — the practical ReDoS classes); a query MUST contain the capture named by `capture`; queries are capped at 512 bytes. Forbidden: `#is?`/`#is-not?` (local-state predicates vary by binding implementation) and directives (`#set!`). The subset is chosen to be implementable identically in web-tree-sitter and in the Node-based pipeline validator — divergence between the two engines is a build-stopping bug.

### 6.5 Guard catalog v1 (closed)

Guards run at match time against the concrete tree. Each is implemented once in the runtime and once in the validator, with shared fixtures. Adding a guard requires: an entry here, both implementations, and a minor bump of `format_version`.

| Guard | Signature | Semantics | Cost |
|---|---|---|---|
| `not_locally_bound` | `(capture)` | The identifier text of the capture has no binding (per `pack.yaml binding_nodes`) in any enclosing `scope_nodes` scope, searched innermost-out. Import aliases count as bindings. Single-file analysis; absence of evidence = unbound (best-effort by design, N2). | O(scope size) |
| `is_callee` | `(capture)` | Capture is the `function` field of an enclosing `call` node. | O(1) |
| `inside` | `(capture, node_type)` | Some ancestor of the capture has the given type. | O(depth) |
| `not_inside` | `(capture, node_type)` | Negation of `inside`. | O(depth) |
| `text_in_pack_list` | `(capture, list_name)` | Capture text ∈ a named string list shipped in `pack.yaml` (e.g., `stdlib_modules`). Keeps large vocabularies out of query text. | O(1) hashed |

When `not_locally_bound` *fails* (the name is shadowed), the winning resolution is the shadowing-aware lexical card mandated by I5 ("`len` here is a variable defined on line 4"), not silence. The runtime surfaces `shadowed: true` on the `lookup` event.

### 6.6 Execution model (runtime, informative but load-bearing)

Queries are compiled once at pack load (§3.2 step 5) and executed over the whole tree at parse time, producing an interval index: offset range → ranked candidate list. This same pass emits the CM6 decoration set (design doc §10.2), so decoration and resolution can never disagree — one source of truth for "what is tappable." Incremental reparses re-run matching only over changed ranges (tree-sitter reports them). Per-tap tree walking (§6.2) is the fallback for offsets the index missed and is required to produce identical results (property-tested in CI, §9.6).

### 6.7 Grammar pinning

Selectors are written against a specific grammar revision (`manifest.grammar.revision`). Grammar upgrades are pack-version events: bump the revision, recompile, re-run the full fixture + corpus suite, ship as v{N+1}. The runtime never mixes a pack's queries with a different grammar build — the grammar ships *inside* the pack for exactly this reason.

---

## 7. Compiled `concepts.json`

### 7.1 Shape

```json
{
  "format_version": "1.0",
  "lang": "py",
  "pack_version": 3,
  "config": { /* pack.yaml, verbatim */ },
  "concepts": [ {
      "id": "py:syntax:list-comprehension",
      "names": ["list comprehension", "[x for x in ...]"],
      "category": "syntax",
      "level_gate": {},
      "selectors": [ { "query": "(list_comprehension) @target",
                       "capture": "@target", "guards": [], "priority": 50 } ],
      "related": ["py:syntax:generator-expression"],
      "explanations": { "novice": { "body": "…", "example": { "code": "…",
                        "expected_output": null }, "gotcha": "…", "version": 4 },
                        "learning": { }, "comfortable": { } },
      "deep_dive": "…" } ],
  "ordinals": ["py:syntax:list-comprehension", "…"]
}
```

### 7.2 Explanation versions

`version` is per (concept, level), assigned by the compiler: it increments when the content hash of that explanation changes and is stable otherwise. It exists so rendered cards are attributable (I6) and so cached/derived artifacts can invalidate precisely.

### 7.3 `ordinals`

The pancake index stores vectors by insertion order; `ordinals[i]` maps index label *i* → concept id. The array length MUST equal the index's element count (verified at load).

### 7.4 Runtime caps (part of I13's parse hardening)

`concepts.json` ≤ 8 MB decoded; ≤ 4,000 concepts; ≤ 12 selectors/concept; strings capped per §5.2. The parser MUST enforce caps before allocating dependent structures.

---

## 8. Embedding index contract

### 8.1 Index parameters

pancake index, cosine metric, M=16, ef_construction=200 (corpus is small and built offline — spend build time for graph quality), serialized with the current snapshot format, loaded read-only (no runtime insertion, no soft-delete machinery in play).

### 8.2 Embedded text template

One vector per concept. The embedded string is deterministic:

```
{names joined "; "} — {category}. {novice.body if present else learning.body}
```

Rationale: names carry the surface forms learners' queries resemble; the novice body carries the plain-language vocabulary T1 queries are built from (design doc §7.3). Changing this template is a `format_version` minor bump and requires re-embedding the corpus.

### 8.3 Query-side contract

The runtime builds the T1 query string per design doc §7.3, embeds with the manifest-pinned model (I15), normalizes iff `manifest.embedding_model.normalize`, searches k=5, and applies `manifest.t1_threshold` on cosine similarity: ≥ threshold → "closest match" card; below → honest miss (I5). The threshold lives in the manifest, not the app, so it is tunable per pack release against the labeled query set (metrics spec, open question feed via K4).

---

## 9. Validation (the CI contract)

A pack builds only if every check passes. The pipeline (`packs/build.ts`) runs, in order:

### 9.1 Schema validation
Every YAML validates against the JSON-Schema copies of §4/§5 (schemas live in-repo at `packs/schema/`, versioned with this document).

### 9.2 Compile checks
All queries compile against the pinned grammar; subset rules (§6.4) enforced by AST inspection of the query source; guard names resolve against the catalog (§6.5); priority-band lint (§6.3).

### 9.3 Fixture checks
Fixture format:

```yaml
# fixtures/list-comprehension.yaml
code: |
  nums = [1, 2, 3]
  out = [x * 2 for x in nums]
taps:
  - { line: 2, col: 9,  expect: py:syntax:list-comprehension }   # on '['
  - { line: 2, col: 12, expect: py:syntax:list-comprehension }   # on '*' → promoted? no:
  - { line: 2, col: 14, expect: py:operator:multiply }           # operator beats nothing here
  - { line: 1, col: 1,  expect: lexical }                        # variable name
```

Requirements: every selector fires on ≥ 1 positive tap across the fixture set; every guarded selector has a negative fixture demonstrating the guard (e.g., shadowed `len` expecting the shadowed lexical outcome); every fixture tap resolves *exactly* as declared under the full §6.2 algorithm — fixtures test the system, not selectors in isolation.

### 9.4 Example execution
Every Python `example.code` executes under the pinned CPython minor version in an isolated subprocess with no network; if `expected_output` is set, stdout must match exactly. Non-executable examples (deliberate-error gotcha snippets) set `example.expect_error: <ExceptionName>` instead — one of the two MUST be satisfiable.

### 9.5 Corpus checks
Against `packs/{lang}/src/corpus/` (a set of license-clean real-world files): (a) **determinism** — no tap position in any corpus file produces a priority-and-span tie (§6.2 step 4); (b) **coverage report** — % of taps on semantically meaningful tokens resolving at T0, printed per build; a drop > 3 points versus the previous pack version fails the build (regression guard for K4).

### 9.6 Engine-equivalence property test
The precomputed interval index and the per-tap fallback walk (§6.6) are run over 10,000 random offsets per corpus file; any divergence fails the build.

### 9.7 Id discipline
Diff against the previous published pack: no live id removed without an alias entry (§5.4); no alias target missing; no id resurrections. This check is the mechanical form of I14.

### 9.8 Assembly
Compile → embed → build index → write manifest with hashes → sign (key from CI secret store; the signing key never exists on developer machines) → publish to a staging prefix → run the runtime loader (headless) against staging as a final end-to-end verification → promote to `/packs/{lang}/v{N}/` and update `latest.json`.

---

## 10. Versioning summary

| Thing | Scheme | Compatibility rule |
|---|---|---|
| `format_version` (this spec) | major.minor | App supports exactly one major; minor additions are backward-compatible (new optional fields, new guards) |
| `pack_version` | monotonic int per language | App accepts any pack whose `format_version` major matches and `min_app_version` ≤ app |
| Explanation `version` | monotonic int per (concept, level) | Content attribution and cache invalidation only |
| Grammar | pinned revision inside pack | Never mixed across packs (§6.7) |
| Embedding model | pinned id inside manifest | Index and model move together or T1 disables (I15) |
| Concept ids | permanent | §5.4; enforced by §9.7 |

---

## Appendix A — Worked example: a guarded builtin

```yaml
# packs/py/src/concepts/builtin/len.yaml
id: py:builtin:len
names: [len, "len()"]
category: builtin
level_gate: {}
selectors:
  - query: "(call function: (identifier) @callee (#eq? @callee \"len\")) @target"
    guards: [not_locally_bound(@callee)]
    priority: 60
  - query: "((identifier) @target (#eq? @target \"len\"))"
    guards: [not_locally_bound(@target), not_inside(@target, call)]
    priority: 25          # bare reference (e.g., passed as argument)
explanations:
  novice:
    body: >
      len() tells you how many items something contains — characters in a
      string, elements in a list, keys in a dictionary.
    example:
      code: |
        print(len("hello"))
      expected_output: "5\n"
    gotcha: >
      len() works on containers, not numbers: len(42) is an error.
  learning: { ... }
  comfortable: { ... }
provenance: { examples: original }
```

Required fixtures: a positive tap on `len(` in a call; a positive tap on bare `len` as an argument; a negative fixture where `len = 3` precedes the call, expecting the shadowed lexical outcome with `shadowed: true`.

## Appendix B — Error codes (runtime ↔ analytics)

`pack_verify_failed.stage`: `manifest_sig` (steps 1–2), `file_hash` (step 3), `schema_caps` (step 4), `query_compile` (step 5), `index_load` (step 6). These are the only values; new stages require updating both this spec and the metrics spec's event dictionary in the same PR.
