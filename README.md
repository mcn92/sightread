# Sightread — M0

**Learn to read code.** Paste Python, tap anything underlined, get an explanation
calibrated to your level. This is the M0 milestone from `docs/sightread-design-doc.md`:
the proof-of-interaction build — client-only, no backend, no accounts, no analytics.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # resolver fixture tests (node)
npm run pack:build # compile packs/py/src into packs/py/build/v0
npm run budget     # verify entry bundle stays inside the M1 app-shell budget
npm run build      # production build in dist/
```

## What's here

| Path | Role (design doc §10.1) |
|---|---|
| `src/reader/` | CodeMirror 6 read-only view, tap decorations, the margin-note card |
| `src/parse/` | web-tree-sitter lifecycle (wasm sources injectable: browser + node tests) |
| `src/resolve/` | T0 engine: selector compilation, match index, §6.2 resolution, guards, ~35-concept corpus |
| `src/app/` | shell, level control, paste panel, zustand store |
| `packs/py/src/` | M1 pack-source skeleton migrated from the M0 hardcoded corpus |
| `public/packs/py/v0/` | generated static pack served to the browser runtime |
| `tools/compile-pack.mjs` | dependency-free pack compiler for the current YAML-compatible source subset |
| `public/*.wasm` | tree-sitter core + Python grammar (official `tree-sitter-python` npm wasm) |
| `docs/` | design doc, metrics & decision spec, pack format & selector spec |

## Architecture notes

- The resolver implements the normative algorithm of the pack spec §6.2 (promotion
  stops → candidate chain → priority, then smallest span). The same match index
  drives decorations, so tappable and resolvable can't disagree (§6.6).
- Guards implemented: `not_locally_bound` (with the honest shadow card per I5),
  `is_callee`, `inside`, `not_inside`. Binding analysis is single-file best-effort
  by design (N2).
- The browser runtime loads the generated Python pack from `public/packs/py/v0`.
  The old hardcoded `src/resolve/concepts.ts` corpus remains only as the M0
  migration source and resolver test fixture for now.
- Production builds register a small service worker that caches the app shell,
  built assets, WASM, and immutable `/packs/py/v0` files after first load.
- The current corpus has also been migrated into `packs/py/src/concepts/**/*.yaml`.
  Rebuild generated pack artifacts with `npm run pack:build`; this writes ignored
  staging output to `packs/py/build/v0` and served runtime output to
  `public/packs/py/v0`. Rerun the one-time migration from the old runtime corpus
  with `npm run pack:migrate:m0`.
- Level gates work end to end: try tapping the `=` in an assignment at
  "New to this" vs "Comfortable".

## Known M0 shortcuts (intentional)

- CM6 + web-tree-sitter ship in the main JS chunk (~800 KB). The design doc's I3/I17
  budgets apply from M1; fix is a dynamic import of the reader stack.
- No incremental reparse — the doc is read-only, so every code change is a full
  parse (fast at these sizes).
- Grammar wasm compatibility: use the wasm from the official `tree-sitter-python`
  npm package (currently 0.25.0). The `tree-sitter-wasms` package is built with
  tree-sitter-cli 0.20 and will not load under web-tree-sitter 0.26.
- `expected_output` fields and example-execution CI (pack spec §9.4) start at M1.

## Exit criterion

> A learner pastes a snippet and the tap-to-card loop feels magical on a phone browser.

Test on a real phone: `npm run dev -- --host`, then open the LAN URL.
