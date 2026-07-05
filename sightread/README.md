# Sightread — M0

**Learn to read code.** Paste Python, tap anything underlined, get an explanation
calibrated to your level. This is the M0 milestone from `docs/sightread-design-doc.md`:
the proof-of-interaction build — client-only, no backend, no accounts, no analytics.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # resolver fixture tests (node)
npm run build      # production build in dist/
```

## What's here

| Path | Role (design doc §10.1) |
|---|---|
| `src/reader/` | CodeMirror 6 read-only view, tap decorations, the margin-note card |
| `src/parse/` | web-tree-sitter lifecycle (wasm sources injectable: browser + node tests) |
| `src/resolve/` | T0 engine: selector compilation, match index, §6.2 resolution, guards, ~35-concept corpus |
| `src/app/` | shell, level control, paste panel, zustand store |
| `public/*.wasm` | tree-sitter core + Python grammar (official `tree-sitter-python` npm wasm) |
| `docs/` | design doc, metrics & decision spec, pack format & selector spec |

## Architecture notes

- The resolver implements the normative algorithm of the pack spec §6.2 (promotion
  stops → candidate chain → priority, then smallest span). The same match index
  drives decorations, so tappable and resolvable can't disagree (§6.6).
- Guards implemented: `not_locally_bound` (with the honest shadow card per I5),
  `is_callee`, `inside`, `not_inside`. Binding analysis is single-file best-effort
  by design (N2).
- Concepts are hardcoded in `src/resolve/concepts.ts` for M0. Ids already follow
  the permanent-id rules (I14) so future event logs survive the M1 pack migration.
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
