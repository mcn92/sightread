# Sightread — Design Document

*Working title: "Sightread," borrowed from music, where sight-reading is the skill of performing unfamiliar sheet music on first encounter. Rename freely; the metaphor is the point.*

**Version:** 0.1 (draft)
**Status:** Pre-implementation
**Author:** —
**Last updated:** 2026-07-05

---

## 1. Overview

Sightread is a learning tool that teaches people to *read* code — the skill programming jobs actually consist of, and the one no mainstream learning product teaches. Every incumbent (Sololearn, Mimo, Codecademy, DataCamp) teaches *writing* toy programs from scratch. Sightread inverts this: the learner is presented with real code they didn't write, and the core interaction is tapping anything they don't understand to get an explanation calibrated to their level.

Around that single interaction, three loops form the product:

1. **The lookup loop** (the hook): tap a token → an explanation appears in under 50 ms, resolved locally against a curated concept corpus. No network, no per-lookup cost.
2. **The retention loop** (the subscription): every tap is a signal about what the learner doesn't know. Sightread accumulates a per-user knowledge model and drives a spaced-repetition review deck built from *the concepts the learner personally stumbled on in real code* — a better study deck than any generic flashcard set.
3. **The acquisition loop** (distribution): a free daily code-reading challenge — one real snippet, "what does this print?", tap anything you don't recognize, shareable result — in the Wordle mold. It demonstrates the core interaction, generates shareable content, and feeds the funnel at zero ad spend.

The economic thesis: learners overwhelmingly look up the same few hundred concepts per language. By pre-authoring explanations for the top ~1,000 concepts per language at three learner levels and shipping them in a local, semantically-searchable index, the marginal cost of the core interaction is zero. Live LLM calls are reserved for freeform questions ("what is this whole function doing?") and are metered behind the subscription. A competitor built as a thin LLM wrapper cannot match a generous free tier without losing money on it.

**Target user:** people learning to program — students, bootcamp attendees, career-switchers — who read code in tutorials, textbooks, PDFs, and repositories but do not yet live in an IDE. Explicitly *not* professional developers, whose editors already provide symbol resolution for free.

**Initial languages:** Python first, JavaScript second. C++ and Java later as a university-coursework niche. Language priority is set by learner-market size, not implementation preference.

**Initial platform:** web application (SPA). Mobile app via Capacitor wrapper after web validation. No App Store dependency for the MVP.

---

## 2. Goals and non-goals

### Goals

- G1. Tap-to-explain on real code with local, instant resolution for the curated concept set.
- G2. Explanations calibrated to a self-declared learner level (novice / learning / comfortable).
- G3. A per-user knowledge model derived entirely from observed behavior, driving a spaced-repetition review deck.
- G4. A shareable daily challenge that exercises the core interaction.
- G5. Near-zero marginal cost for the free tier; LLM spend only behind authenticated, metered, paid usage.
- G6. Offline-capable reading and lookup once a language pack is cached.
- G7. A codebase one person can hold in their head. Boring choices everywhere the product doesn't differentiate.

### Non-goals

- N1. **Not an editor.** The reader is read-only. No autocomplete, no linting, no file management. The moment Sightread tries to be an IDE it competes with free incumbents and loses.
- N2. **Not a professional reference tool.** No project-wide symbol resolution, no LSP, no build-system awareness. Out-of-context code cannot be resolved authoritatively (especially C++), and the product must never pretend otherwise.
- N3. **No code execution at launch.** Running learner-pasted code means sandboxing, which means a large security surface. Revisit post-validation (a WASM-sandboxed Python via Pyodide is the plausible future path).
- N4. **No curriculum authoring at launch.** Sightread explains code the learner brings (or the daily challenge provides); it does not sequence lessons. The knowledge model may *suggest* refreshers, but there is no course structure to build or maintain.
- N5. **No social features** beyond the shareable challenge result. No comments, no profiles, no feeds.

---

## 3. Users and product loops

### 3.1 Personas

**P1 — "Tutorial follower."** Three weeks into Python via YouTube/freeCodeCamp. Constantly encounters syntax that the tutorial assumed (`if __name__ == "__main__":`, `*args`, decorators). Currently interrupts flow to search, lands on Stack Overflow answers written for professionals, loses ten minutes. Sightread's pitch: paste the snippet, tap the thing, keep moving.

**P2 — "CS student."** Enrolled in coursework, reads assigned code in PDFs and slides. Deadline-driven, willing to pay during the semester. Future C++/Java packs target this persona.

**P3 — "Career-switcher."** Bootcamp or self-directed, highest willingness to pay, most motivated by visible progress. The knowledge model's progress surface ("two weeks ago you looked up list comprehensions five times; today you read past three without stopping") is aimed here.

### 3.2 The lookup loop (detail)

The learner gets code into the reader by pasting, by opening a challenge, or (later) by URL import from public GitHub/gists. The reader renders the code with every semantically meaningful token tappable. A tap resolves through the explanation pipeline (§7) and renders an explanation card: short definition at the learner's level, a minimal example, and one "gotcha." The card offers two escalations: "explain in more depth" and "explain this in context" — the second sends the surrounding selection to the LLM tier and is the primary paid surface.

Design intent: the free path must feel *instant and unlimited*. Any friction (spinners, quotas, login walls) on a T0 lookup breaks the reading flow that is the entire product.

### 3.3 The retention loop (detail)

Every lookup, quiz answer, and challenge result appends to an event log. From the log, the knowledge model (§8) derives a per-concept mastery estimate with a forgetting curve. The model surfaces:

- A **review deck**: short recall prompts for decaying concepts, using real snippets (ideally the snippet the learner originally tapped in).
- **Progress evidence**: concepts formerly tapped, now read past. This is the emotional payoff and the retention driver; it must be visible on the home screen, not buried in a stats page.
- **Refresher nudges**: "you've looked up `self` four times this week — two-minute explainer?"

### 3.4 The acquisition loop (detail)

One challenge per day per language track. Format: a 5–15 line real-world snippet, one question ("what does this print?" / "what's the bug?"), multiple choice. The learner may tap anything in the snippet before answering — lookups are not cheating; they're the product demo. The shareable result encodes the outcome and lookup count without spoiling the answer (e.g., "Sightread #142 — solved, 2 lookups 🟩🟨"). Challenges are static content: a JSON file per day, prebuilt, CDN-served, no backend involvement.

---

## 4. System overview

Sightread is a client-heavy single-page application. Everything on the free path — rendering, parsing, concept resolution, semantic search, the knowledge model — executes in the browser. The backend is a thin metering-and-money layer.

```
┌─────────────────────────── Browser ────────────────────────────┐
│                                                                │
│  React UI (reader, cards, deck, challenge)                     │
│      │                                                         │
│  CodeMirror 6 (read-only, decorated, tappable)                 │
│      │ pointer event → byte offset                             │
│  tree-sitter (WASM) ── AST node at offset                      │
│      │ node → resolver                                         │
│  Explanation pipeline                                          │
│      ├─ T0: concept map lookup (exact)      ── content pack    │
│      ├─ T1: pancake semantic search (WASM)  ── content pack    │
│      └─ T2: LLM proxy call (network, metered, paid)            │
│                                                                │
│  Knowledge model (event log + FSRS scheduler, IndexedDB)       │
│  Service worker (content-pack + app-shell cache, offline)      │
└───────────────┬────────────────────────────────────────────────┘
                │ HTTPS (auth’d, only for: T2, sync, billing)
┌───────────────┴─────────────── Backend (thin) ─────────────────┐
│  Hono on Cloudflare Workers                                    │
│   /explain (LLM proxy, metering, cache)                        │
│   /sync    (event-log backup for logged-in users)              │
│   /billing (Stripe webhooks)                                   │
│  Supabase: Postgres (users, entitlements, event backup), Auth  │
│  R2/CDN: content packs, daily challenge JSON                   │
└────────────────────────────────────────────────────────────────┘
```

The deliberate asymmetry: the client is where all product value lives and is comparatively sophisticated (two WASM modules, an incremental parser, a scheduler). The backend is aggressively boring and nearly stateless. This matches both the cost thesis (§1) and the maintenance reality of a solo developer.

---

## 5. Technology choices

Each choice lists the decision, the reason, and the strongest rejected alternative. The unifying principle: **spend novelty only where the product differentiates** (local resolution, knowledge model); everywhere else, choose the most-supported boring option.

**D1. Language: TypeScript end-to-end.** One language across client, backend, and build tooling minimizes context switching for a solo developer. Rejected: Rust/C++ for any server or app-layer component — performance is not the risk; iteration speed is. C++ appears only inside prebuilt WASM modules (D4, D5).

**D2. Client framework: React 18 + Vite + Tailwind.** Deepest ecosystem, first-class support in every library this product needs, fastest path from idea to shipped UI. Rejected: Svelte/Solid (better runtime, smaller ecosystem — wrong trade for a product whose risk is retention, not render performance); Next.js (SSR machinery buys nothing for an app that is offline-first and behind a login for its stateful parts; deploy as a static SPA).

**D3. Code surface: CodeMirror 6, read-only.** This is a load-bearing choice. The entire product is "tap a token in rendered code." CM6 provides a decoration/widget API for making arbitrary ranges interactive, is small (~150 KB core), and handles touch input correctly. Rejected: Monaco (heavy, poor mobile/touch support — disqualifying for a product headed to phones); rolling our own renderer with `<pre>` + spans (loses incremental reparse integration, selection handling, and accessibility for no benefit).

**D4. Parsing: tree-sitter compiled to WASM, client-side.** Produces a real AST in the browser, incrementally, with grammars available for every language on the roadmap. The AST is what turns "the word `self`" into "`self`, first parameter of a method definition" — the difference between this product and a regex highlighter. Rejected: server-side parsing (adds latency and per-lookup cost to the free path, breaks offline); LSP-in-browser (built for whole-project semantics we explicitly don't offer, N2).

**D5. Local semantic index: pancake (existing int8 HNSW, WASM).** Concept explanations are embedded offline at pack-build time; the serialized index ships inside the language pack; T1 fuzzy lookups run on-device in microseconds at zero marginal cost. This is the component competitors won't have and the reason the free tier is economically generous. The engine's existing hostile-snapshot deserialization hardening is directly relevant: content packs are remote data (I13). Non-goals for pancake here: no insertion at runtime; the index is read-only after load, which sidesteps the soft-delete/compaction machinery entirely.

**D6. Embeddings: a small sentence-embedding model, applied at build time only.** Query-side embedding for T1 uses the same model compiled to ONNX Runtime Web / transformers.js, loaded lazily on first fuzzy lookup (not on app start). Model choice pinned per pack version (I15). Rejected: embedding via API at runtime (cost + latency + offline break).

**D7. Backend: Hono on Cloudflare Workers.** Three responsibilities only: LLM proxying with metering (§11), event-log sync, Stripe webhooks. Workers give per-request pricing at learner-app traffic levels (near-free), no servers to patch. Rejected: a "real" backend (Node on a VPS, containers) — nothing in the product justifies owning uptime.

**D8. Auth + database: Supabase (Postgres + Auth).** Accounts, entitlements, and the server-side copy of event logs, without building auth. Rejected: rolling auth (never); Firebase (Firestore's query model fights the event-log design; Postgres doesn't).

**D9. Payments: Stripe Checkout + customer portal.** No custom billing UI. Entitlement state lives in Postgres, written only by the Stripe webhook handler (I19).

**D10. LLM for T2: Claude via API, behind the proxy.** Model choice is a config value, not an architectural commitment; the proxy owns prompts, caching, and metering so the client never embeds provider details (I8).

**D11. Client persistence: IndexedDB via a thin wrapper (idb).** Stores the event log, derived mastery state, cached packs metadata. LocalStorage is too small and synchronous; a heavier local DB (RxDB, WatermelonDB) is unjustified complexity at this stage.

**D12. Mobile (post-validation): Capacitor wrapper.** The core is web + WASM; Capacitor ships the existing app inside a WebView with store presence. Rejected: React Native (WASM support is painful; would force reimplementing the reader stack — the exact component that must not fork).

**D13. Offline: service worker with content-addressed pack caching.** App shell + installed language packs are cached; reader and T0/T1 lookups work with no connectivity (G6). T2 and sync degrade gracefully with an explicit offline indicator.

---

## 6. Domain model

### 6.1 Core entities

```
Concept
  id            string   # "py:syntax:list-comprehension" (I14)
  lang          string   # "py"
  category      enum     # syntax | builtin | stdlib | operator | pattern | idiom
  names         string[] # surface forms: ["list comprehension", "[x for x in ...]"]
  ast_selectors AstSelector[]   # how T0 recognizes it (see §7.2)
  level_gate    enum     # concepts can be marked above/below a level (suppress noise)

Explanation
  concept_id    string
  level         enum     # novice | learning | comfortable
  body          markdown # ≤120 words: definition, minimal example, one gotcha
  deep_dive     markdown # optional longer form for "explain in more depth"
  version       int      # monotonically increasing per (concept, level)

ContentPack                       # one per language, versioned bundle
  lang, version, created_at
  concepts.json                   # all Concepts + Explanations
  index.pancake                   # serialized embedding index over Concept names+bodies
  grammar.wasm                    # tree-sitter grammar
  manifest.json                   # hashes of every member (I13), embedding-model id (I15)

Event (append-only; the knowledge model's source of truth, I16)
  id, user_or_device_id, ts
  kind          enum     # lookup | card_expand | t2_request | quiz_answer
                         # | challenge_result | level_change
  payload       json     # kind-specific; lookup: {concept_id, source, resolution_tier}

MasteryState (derived, rebuildable from Events — never authoritative)
  concept_id, stability, difficulty, due_at    # FSRS parameters (§8)

Challenge
  id, lang, date, snippet, question, choices[], answer_index,
  tappable_concepts[]    # precomputed concept ids present in the snippet
```

### 6.2 Server-side tables (Supabase)

`users` (Supabase Auth), `entitlements` (user_id, plan, status, current_period_end — written only by Stripe webhooks), `event_backup` (user_id, event blob, batched), `t2_usage` (user_id, period, count — the metering ledger, I18), `t2_cache` (prompt_hash → response, TTL — shared cache across users for identical selections).

Deliberately absent from the server: code content (except transiently inside T2 requests, §15), mastery state (derived client-side; the server stores only raw events), any analytics beyond event counts.

---

## 7. The explanation pipeline

The pipeline turns "pointer event at pixel (x, y)" into "the right explanation at the right depth," through three tiers with strictly decreasing frequency and increasing cost.

### 7.1 From tap to AST node

CodeMirror reports the character offset under the pointer. The tree-sitter tree (parsed at load, reparsed incrementally on any change) is queried with `descendantForIndex(offset)`. The resolver walks *upward* from the smallest node using per-language promotion rules, because the smallest node is usually too small to be the concept: a tap on the `for` inside `[x*2 for x in xs]` should resolve to *list comprehension*, not the keyword `for`. Promotion stops at the first ancestor matching a T0 selector, bounded at statement level (never promote past the statement — a tap should never resolve to "the whole file").

### 7.2 T0 — exact concept resolution (target: ≥80% of lookups)

Each Concept carries `ast_selectors`: declarative matchers over (node type, ancestor context, token text). Examples:

```
py:syntax:list-comprehension   node_type == "list_comprehension"
py:builtin:len                 node_type == "call" && callee.text == "len"
                               && callee is not locally bound        (see below)
py:syntax:self                 node_type == "identifier" && text == "self"
                               && inside function_definition inside class_definition
py:operator:walrus             node_type == ":="
```

Selectors compile at pack load into a lookup structure keyed by node type, so T0 resolution is a hash lookup plus a few predicate checks — well inside the latency budget (I2).

**Shadowing check:** before claiming a name is the builtin/stdlib entity, the resolver scans enclosing scopes in the AST for a binding of that name (assignment, parameter, import alias). Single-file scope analysis only — this is best-effort by design (N2), and when a local binding exists the card says so ("`len` here is a variable defined on line 4 — shadowing the built-in `len`"). This honesty rule is an invariant (I5).

### 7.3 T1 — semantic fallback (target: most of the remainder)

When no selector matches — a stdlib function outside the curated set, an unfamiliar idiom, a misparse — the resolver builds a query string from the node text plus lightweight context ("`functools.reduce` — called as function, module `functools`"), embeds it locally (D6), and searches the pancake index over the concept corpus. A result above the similarity threshold renders as a normal card with a subtle "closest match" affordance; below threshold, the card degrades to an honest miss: lexical information only (token kind, where it's bound in this file, if determinable) plus the T2 escalation offer. T1 must never present a low-confidence match as authoritative (I5).

### 7.4 T2 — LLM explanation (metered, paid surface)

Triggered only by explicit user action: "explain this in context," "explain in more depth" beyond the authored deep-dive, or a freeform selection of multiple lines. The client sends the selection, ±10 lines of context, learner level, and the resolved concept id if any, to `/explain`. The proxy: checks entitlement and quota (I18), consults the shared `t2_cache` (identical snippet+question hashes are common — challenges especially), calls the model with a pinned prompt template, stores the response in cache, and returns it. The card renders with a visible "AI-generated" treatment distinct from authored content (I6).

Free-tier users get a small monthly T2 allowance (enough to taste the feature; exact number is a tuning knob, enforced server-side per I7). Anonymous users get none — T2 requires an account, which is the natural registration prompt.

### 7.5 Failure ordering

Parse failure → lexical tokens remain tappable via the grammar's error-recovery nodes (tree-sitter degrades gracefully by design); the reader never blocks on a clean parse (I4). Pack missing → reader works, taps show "install the Python pack" affordance. Network down → T0/T1 unaffected; T2 button disabled with offline indicator (G6).

---

## 8. The knowledge model

### 8.1 Event-sourced by construction

The append-only Event log is the single source of truth (I16). Mastery is a pure fold over events; the derived table can be deleted and rebuilt at any time, which makes scheduler-algorithm changes deployable without migrations and keeps sync trivially conflict-free (union of append-only logs, dedup by event id).

### 8.2 Signals and their interpretation

A **lookup** is negative evidence of mastery (weighted by recency of last exposure — a re-lookup two days after a quiz success is a strong forgetting signal). A **quiz answer** is direct evidence in either direction. **Reading past** a concept present in a snippet without tapping it is weak positive evidence — used only in aggregate and never for scheduling, since it's noisy (the learner may not have read that line). A **challenge result** contributes both the answer signal and its lookup trail.

### 8.3 Scheduling: FSRS

Review scheduling uses FSRS (the modern spaced-repetition scheduler with published parameters) over per-concept (stability, difficulty, due_at). Rejected: SM-2 (Anki-classic) — FSRS is strictly better calibrated and equally easy to implement from its reference; hand-rolled decay curves — do not invent memory science. One deliberate deviation: *new* concepts enter the deck only from lived events (a real lookup), never from a syllabus. The deck's identity is "things *you* stumbled on," which is the product's emotional differentiation (§3.3); polluting it with a generic curriculum breaks that promise (N4).

### 8.4 Review item format

A review prompt is a real snippet (preferentially the very snippet the learner first tapped, stored locally by reference) with the target concept highlighted, asking a recall-level question ("what does this syntax do?") with self-graded reveal at first (Again/Hard/Good/Easy, feeding FSRS directly). Authored multiple-choice variants can come later per concept; self-graded reveal ships in the MVP because it requires zero additional authoring.

---

## 9. Daily challenge

One per day per language track. Content is authored in batches (§13), validated by CI (snippet parses; every `tappable_concept` actually resolves via T0; exactly one correct answer), and published as `challenges/py/2026-07-05.json` on the CDN. The client fetches by date; yesterday's challenges remain playable for free; the deeper archive is a Pro perk (cheap to grant, plausible to want).

The share string is generated client-side and contains no URL parameters that leak the answer. Streaks are computed from the local event log (and survive account creation via log merge). No leaderboards (N5) — the comparison surface is the share artifact itself, which is where Wordle proved the compounding loop lives.

---

## 10. Client architecture

### 10.1 Module boundaries

```
/reader        CM6 setup, decorations, tap handling, card UI
/parse         tree-sitter loading, incremental tree, node promotion (§7.1)
/resolve       T0 selector engine, T1 pancake bridge, T2 client, tier orchestration
/packs         pack fetch, verify (I13), cache, versioning; service-worker glue
/knowledge     event log, FSRS, deck builder, progress surfaces
/challenge     fetch, play state machine, share-string builder
/account       Supabase auth glue, entitlement cache, sync
/app           routing, shell, settings (level selector lives here)
```

Dependency rule: arrows point downward in the list above only (e.g., `/reader` may import `/resolve`; `/resolve` must not import `/reader`). `/knowledge` depends on nothing above it — it consumes events, full stop. This keeps the reader stack extractable for the Capacitor build and the knowledge model testable headlessly.

### 10.2 Reader integration specifics

The document is read-only (`EditorState.readOnly`), but CM6's selection machinery stays enabled — multi-line selection is the T2 gesture. Tappable ranges are computed by walking the tree once per parse and emitting a `DecorationSet` (mark decorations with a class + concept metadata); this keeps hit-testing O(log n) via CM6's range sets rather than per-tap tree walks for the common case, with the tree walk as fallback for undecorated positions. On touch, a tap shows the card anchored above the token (thumb occlusion); on desktop, hover shows a 300 ms-delayed peek and click pins the full card. Card rendering is plain React portaled over the editor — no CM6 widget decorations for the card itself (widgets inside the document reflow the code, which is disorienting mid-read).

### 10.3 WASM loading strategy

Three WASM payloads exist: tree-sitter core + grammar (~1.3 MB), pancake + index (~2–4 MB depending on corpus), embedding model (~25 MB, ONNX). Loading is strictly lazy and tiered: grammar begins loading when a language is detected/selected; pancake index loads in the background after first paint; the embedding model loads only on the first T1 miss that needs a fresh query embedding (with a skeleton state on the card — acceptable because T1 is rare and first-time-only per session). All fetches go through `/packs` with hash verification (I13) and service-worker caching. The app never blocks initial render on any WASM (I3).

### 10.4 State

React state stays local to features; cross-cutting state (current pack, auth, entitlement, level) lives in a small Zustand store. No Redux, no server-state library — the app has almost no server state by design (§4).

---

## 11. Backend architecture

Three route groups on one Worker; everything else is a managed service.

**`POST /explain` (T2 proxy).** Auth required. Flow: validate JWT → check entitlement + decrement quota atomically (Postgres, I18) → normalize request → `t2_cache` lookup by hash(selection, context, level, prompt_version) → on miss, call model with pinned prompt template → persist to cache → return. Request and response bodies are size-capped; the selection + context is capped at 4 KB (a learner "explain this" never legitimately needs more, and the cap bounds both cost and abuse). Rate limit per user and per IP independently of quota.

**`POST /sync`.** Auth required. Accepts a batch of events (client sends deltas since last ack), appends to `event_backup`, returns server-known event ids for reconciliation. Pull direction (`GET /sync?since=`) restores the log on a new device. The server never interprets events — it is a dumb durable copy (I16 keeps interpretation client-side and rebuildable).

**`POST /billing/webhook`.** Stripe events update `entitlements`. This handler is the *only* writer of entitlement state (I19). The client reads entitlements via Supabase with row-level security; it never infers plan status from Stripe client-side objects.

**Prompt management.** T2 prompt templates are versioned server-side (`prompt_version` participates in the cache key). Prompts pin the learner-level register, require the model to flag uncertainty about out-of-context code (mirroring I5 at the LLM tier), and forbid inventing APIs. Prompt changes are deployments, not data.

---

## 12. Invariants

These are the rules the codebase must never violate. Each carries the test that enforces it. Grouped by concern; numbered for reference from code comments (`// upholds I7`).

### Privacy

- **I1. Learner code never leaves the device except inside an explicit T2 request.** No analytics event, sync payload, or log contains pasted code. T2 payloads contain only the selection + capped context. *Enforced by:* the Event schema has no code-content field (structurally impossible to violate via events); network-layer test asserts the only route carrying code is `/explain`.
- **I15a. T2 payloads are ephemeral server-side.** Cached responses are keyed by hash; raw request bodies are not persisted beyond the request lifetime (the cache stores the hash and the response, not the code). *Enforced by:* schema review; `t2_cache` has no code column.

### Correctness and honesty

- **I5. Never present uncertain resolution as authoritative.** Shadowed builtins are labeled; T1 matches below threshold degrade to lexical info; T2 prompts require uncertainty flagging. The product's trust with a learner who can't yet detect errors is its entire asset. *Enforced by:* resolver unit tests for shadowing and threshold paths; prompt-template tests.
- **I6. Authored and AI-generated content are visually and structurally distinct.** An Explanation renders only if it carries a (concept_id, level, version); T2 output renders only in the AI-marked card. No mixing within a card body. *Enforced by:* card component takes a discriminated union; TypeScript makes the mixed state unrepresentable.
- **I4. Parsing is best-effort and never blocking.** A parse error must not disable reading or tapping; error-recovery nodes remain tappable at the lexical level. *Enforced by:* fixture corpus of deliberately broken snippets in CI, asserting the reader renders and taps resolve.
- **I16. The event log is append-only and the only source of truth for learner state.** Derived mastery is rebuildable from scratch; no code path writes derived state that isn't a pure function of events. *Enforced by:* a CI test that replays a fixture log, snapshots derived state, mutates the derived store, rebuilds, and asserts equality.

### Performance

- **I2. T0 lookup ≤ 50 ms end-to-end on a mid-range phone** (tap to card paint). Budget: hit-test ≤ 5 ms, resolve ≤ 5 ms, render ≤ 40 ms. *Enforced by:* performance test in CI against a throttled profile; regression fails the build.
- **I3. First paint never waits on WASM.** All WASM loads are lazy (§10.3). *Enforced by:* bundle-analysis CI step asserting no WASM in the entry chunk; Lighthouse budget.
- **I17. Bundle budgets:** entry JS ≤ 200 KB gzipped; a language pack ≤ 5 MB; embedding model excluded from both (lazy, cached, explicitly signposted in UI on first load). *Enforced by:* size-limit in CI.

### Economics and abuse

- **I7. All quota and entitlement enforcement is server-side.** Client-side gates are UX sugar only. *Enforced by:* API tests calling `/explain` with tampered client state.
- **I18. Every T2 call is metered atomically before the model is called.** Quota decrement and the provider call are ordered so a crash cannot produce unmetered spend; provider spend has a hard monthly circuit breaker independent of per-user quotas. *Enforced by:* proxy unit tests; a billing alarm as backstop.
- **I8. No model-provider details (keys, endpoints, prompts) exist in client code.** *Enforced by:* secret-scanning in CI; prompts live only in the Worker.
- **I19. Entitlement state has exactly one writer: the Stripe webhook handler.** *Enforced by:* Postgres grants — the webhook role is the only role with UPDATE on `entitlements`.

### Content and supply chain

- **I13. Content packs are untrusted input.** Every pack member is hash-verified against a signed manifest before use; the pancake index loads through its hardened deserializer (including the level-topology validations from the engine review); a verification failure discards the pack and refetches. Version-skew rule: an app build refuses packs above its supported major pack version. *Enforced by:* corrupted-pack fixtures in CI asserting rejection.
- **I14. Concept ids are permanent.** Renames create aliases; ids are never reused or repurposed, because event logs reference them forever. *Enforced by:* pack-build tooling diffs against the previous pack and fails on id removal.
- **I15. Embedding model and index are pinned together.** A pack's index is only queried with vectors from the exact model version named in its manifest. *Enforced by:* runtime assert comparing model id in manifest vs. loaded model; mismatch disables T1 (degrades, not breaks).

### Product

- **I20. The free reading path has no login wall, no quota, and no spinners.** T0/T1 work anonymously forever. Accounts are for T2, sync, and payments — never for basic reading. *Enforced by:* e2e test running the full lookup loop with network disabled and no auth.

---

## 13. Content pipeline

The corpus is a build artifact, produced by a repo-local pipeline (`packs/` in the monorepo), not hand-maintained JSON.

**Authoring.** Concepts are defined in one YAML file per concept (id, names, selectors, level gate). Explanations are drafted LLM-assisted against a style guide (register per level, ≤120 words, one gotcha, runnable example) and human-reviewed before merge — authored content carries the product's credibility (I6 depends on it deserving the distinction). The initial Python corpus targets ~600 concepts: full syntax coverage, ~150 builtins/methods, ~100 stdlib entries, ~100 idioms/patterns; expanded by observed T1/T2 miss telemetry (aggregate concept-level counts only, per I1).

**Build.** CI compiles YAML → `concepts.json`, validates selectors against a snippet corpus (every selector must fire on at least one fixture and must not fire on named negative fixtures), embeds all concept texts with the pinned model, builds the pancake index, assembles the manifest with hashes, signs, and publishes to R2 as `packs/py/v{N}/`.

**Challenge authoring** rides the same pipeline (§9): batches of dated JSON, CI-validated, published ahead of time. A missed day must be impossible by construction (publish N weeks ahead; alert when the buffer drops below 14 days).

---

## 14. Performance budgets

Beyond the invariant budgets (I2, I3, I17): time-to-interactive ≤ 2 s on a mid-range Android over 4G for the app shell; incremental reparse ≤ 30 ms for a 500-line file (tree-sitter is comfortably inside this); card open animation runs at 60 fps on the same profile (animate transform/opacity only). The embedding model's ~25 MB download is the one heavy asset: it is never loaded on the challenge path (challenges precompute `tappable_concepts`, so T0 covers them by construction), which keeps the acquisition funnel light.

---

## 15. Security and privacy posture

Minimal PII: email (auth) and Stripe customer id. No names, no birthdates — deliberately, because the learner demographic plausibly includes minors and the correct strategy is to hold nothing sensitive. All analytics are aggregate concept-frequency counts derived from events (no code, per I1). Legal review before launch on the standard trio (ToS, privacy policy, data-deletion endpoint); account deletion cascades `event_backup` and Stripe customer detachment. The client's supply-chain exposure (WASM + packs) is covered by I13; dependency updates ride automated PRs with the CI gates above.

---

## 16. Monetization

**Free:** reader, unlimited T0/T1 lookups, daily challenge + 7-day archive, review deck capped (e.g., 20 due cards/day), small monthly T2 taste (requires account).
**Pro ($9/month or $59/year, prices to be tested):** unmetered-within-reason T2 ("explain in context," deep dives), full challenge archive, uncapped deck, progress insights. The cap placement follows the cost structure: everything with zero marginal cost is free and generous (the moat, §1); everything with per-use cost or archival value is paid.

---

## 17. Milestones

**M0 — Proof of interaction (a weekend).** Vite + CM6 + tree-sitter, ~50 hardcoded Python concepts, no backend, no pancake. Exit criterion: a learner pastes a snippet and the tap-to-card loop feels magical on a phone browser.
**M1 — Real corpus + challenge (2–3 weeks).** Full Python pack pipeline, pancake T1, service worker, daily challenge with share string. Exit: shippable free product; post to r/learnprogramming and measure D1/D7 retention and share rate.
**M2 — Knowledge model (1–2 weeks).** Event log, FSRS deck, progress surface, anonymous-first with account merge. Exit: deck engagement measurable.
**M3 — Money (1–2 weeks).** Supabase auth, Worker proxy, Stripe, T2 with metering, quotas, cache. Exit: first dollar.
**M4 — Second language + mobile.** JavaScript pack (pipeline should make this mostly content work); Capacitor builds. Sequenced by whatever M1–M3 telemetry says about demand.

The ordering is deliberate: distribution risk (M1) is retired before retention machinery (M2), which is retired before any billing complexity (M3). If M1's numbers are bad, M2–M4 never get built and the sunk cost is weeks, not months.

---

## 18. Open questions

1. **Level calibration:** self-declared level vs. inferred from the event log after a warm-up period. Ship self-declared; revisit once event volume exists.
2. **T1 threshold tuning:** the similarity cutoff between "closest match" and honest miss needs empirical setting against a labeled query set — build that set from M1 telemetry.
3. **Snippet import:** URL import (GitHub/gists) is high-value for P1 but adds CORS/proxying questions (fetching through the Worker would touch I1's spirit — user-directed fetch of public code is fine, but design it explicitly).
4. **Challenge difficulty tracks:** one daily challenge or novice/intermediate variants? One track for M1; split only if share-rate data segments.
5. **Pyodide execution sandbox (post-N3):** "run this snippet" is the most-requested feature this category gets. Large scope; decide after M3 economics are known.
6. **Pack licensing:** explanations are original content; example snippets must be original or license-clean — the authoring style guide bans copying from documentation with restrictive licenses. Codify in CI (provenance field per example) before external contributors exist.

---

## Appendix A — Decision log format

Future decisions append here as dated entries: context, decision, alternatives, consequences. The document above is the state as of v0.1; the log is the history.
