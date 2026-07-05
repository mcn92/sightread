# Sightread — Metrics & Decision Specification

**Version:** 1.0
**Status:** Pre-registered (see §1.3 — thresholds in this document are frozen at M1 launch)
**Companion to:** `sightread-design-doc.md` v0.1 (invariants referenced as I-numbers)

---

## 1. Purpose and principles

### 1.1 What this document is

This document defines (a) every analytics event the product emits, (b) the KPIs computed from them, and (c) the numeric decision gates that determine whether each milestone proceeds, iterates, or stops. It exists so that measurement is designed before outcomes exist, and so that a second person could take over instrumentation, dashboards, and milestone decisions without asking the founder what anything means.

### 1.2 Principles

**P1 — Measure to decide, not to feel.** Every metric in §4 is attached to at least one decision in §5 or one operational alarm in §6. A metric with no decision attached does not get instrumented.

**P2 — Privacy is structural (inherits I1).** No analytics event may contain learner code, free-text input, file names, or URLs of imported snippets. Event properties are drawn from closed enums, concept ids, and bucketed numerics only. This is enforced by the property allowlist (§3.4), not by good intentions.

**P3 — Two stores, one boundary.** The *product event log* (design doc §8, IndexedDB, synced for logged-in users) is the source of truth for the knowledge model. The *analytics stream* is a separate, lossy, pseudonymous copy used only for aggregate measurement. Analytics may be sampled, dropped, or deleted without affecting any learner's experience. Nothing in the product may ever read from analytics.

**P4 — Pre-registration discipline.** Gate thresholds (§5) are frozen when the corresponding milestone ships. They may be amended only *before* the evaluation window opens, in writing, in the amendment log (§7.3), with rationale. Editing a threshold after seeing data invalidates the gate — if that happens, record it as a failed gate discipline in the log and treat the result as advisory only.

**P5 — Denominator honesty.** No percentage is evaluated on a denominator under the minimum sample size stated with each gate. An unreached denominator by the gate date is itself a signal (a distribution failure) and is treated as such in §5.2.

### 1.3 Amendment protocol

Changes to this document append a dated entry to §7.3 with: what changed, why, and whether the evaluation window for any affected gate had opened. Threshold changes after a window opens are prohibited (P4).

---

## 2. Instrumentation architecture

### 2.1 Pipeline

```
Client event bus ──► IndexedDB product log (source of truth; design doc §8)
        │
        └──► Analytics adapter ──► PostHog (EU cloud, free tier)
                  │                    - property allowlist enforced here
                  │                    - batched, retry with drop-after-24h
                  └──► console sink in dev builds
Server (Worker) ──► PostHog server-side events (billing, T2 metering)
```

**Decision: PostHog (EU cloud) for analytics.** Rationale: retention tables, funnels, and cohort tooling out of the box; the free tier (1M events/month) covers this product well past M3; EU hosting matches the minimal-PII posture. Rejected: Cloudflare Workers Analytics Engine (cheapest, but dashboards/funnels would be hand-built — wrong use of solo-dev time); self-hosted PostHog (operational burden violates design-doc D7's spirit); Google Analytics (property model fights P2, and trust posture is wrong for this audience). Migration risk is acceptable because the adapter (§2.2) is the only file that knows PostHog exists.

### 2.2 The analytics adapter

All emission goes through one module, `/analytics/adapter.ts`, exposing exactly `track(event: AllowedEvent)`. `AllowedEvent` is a TypeScript discriminated union generated from the event dictionary (§3.3); emitting an unlisted event or property is a compile error. The adapter drops events when the user has opted out (§2.4), when offline beyond the retry window, and in E2E test runs.

### 2.3 Identity model

- `device_id`: random UUIDv4, generated on first launch, stored locally. Not derived from any fingerprint. Cleared by "reset my data" in settings.
- `user_id`: Supabase user id after account creation. On signup, the adapter aliases `device_id → user_id` (PostHog alias call) exactly once; subsequent devices alias onto the same user.
- **Unit of analysis:** unless stated otherwise, funnel and retention metrics count *devices* pre-M2 and *users where known, devices otherwise* from M2 on. Gates state their unit explicitly.
- **Session:** a session ends after 30 minutes of inactivity (PostHog default). "First session" means the session containing the device's first `app_opened`.
- **Days:** all day-based metrics (D1/D7/D30) use UTC calendar days, not rolling 24h windows. Documented because it changes D1 by several points and must be consistent forever.

### 2.4 Consent and controls

Analytics is on by default with a visible "Usage analytics" toggle in settings and a one-line disclosure on first launch ("anonymous usage statistics, never your code — toggle in settings"). The event dictionary in §3.3 is the public disclosure of record; if an event isn't in this document, the app must not send it.

---

## 3. Event dictionary

### 3.1 Conventions

- Names: `snake_case`, past tense (`challenge_completed`, not `complete_challenge`).
- Every event automatically carries: `app_version`, `pack_version` (if a pack is active), `lang` (if language context exists), `platform` (`web` | `capacitor_ios` | `capacitor_android`), `level` (learner level setting).
- **Bucketing rule (P2):** any numeric that could be high-cardinality or quasi-identifying ships as a bucket, not a raw value. Standard buckets: `latency_ms ∈ {<50, 50–200, 200–1000, >1000}`; `line_count ∈ {≤10, 11–50, 51–200, >200}`; `duration_s ∈ {<10, 10–30, 30–120, >120}`.
- **Forbidden property types (P2):** free-form strings, code, URLs, filenames, error messages (error *classes* only), raw timestamps of other events.

### 3.2 Lifecycle note

Events marked **[M2]** / **[M3]** ship with those milestones; everything unmarked ships at M1. Server-emitted events are marked **[srv]**.

### 3.3 The dictionary

| Event | Fires when | Properties (beyond §3.1 defaults) |
|---|---|---|
| `app_opened` | App shell becomes interactive | `entry: direct \| share_link \| challenge_link \| pwa_icon`, `first_ever: bool` |
| `pack_installed` | Pack verified and usable | `duration_bucket`, `retry_count: 0 \| 1 \| >1` |
| `pack_verify_failed` | I13 verification rejects a pack | `stage: manifest_sig \| file_hash \| query_compile \| index_load` |
| `snippet_loaded` | Code enters the reader | `source: paste \| challenge \| sample \| url_import`, `line_count_bucket`, `parse_ok: bool` |
| `lookup` | Explanation card opens | `concept_id` (nullable), `tier: t0 \| t1_hit \| t1_miss \| lexical`, `surface: reader \| challenge \| deck`, `latency_bucket`, `shadowed: bool` |
| `card_expanded` | Deep-dive opened on a card | `concept_id` |
| `t2_requested` | "Explain in context"/freeform sent | `kind: context \| freeform \| deep_dive_more`, `entitlement: free_quota \| pro`, `cached: bool` **[srv mirrors with cost class]** |
| `t2_blocked` | T2 gesture refused | `reason: no_account \| quota_exhausted \| offline \| size_cap` |
| `challenge_started` | First tap or answer interaction | `challenge_id` |
| `challenge_completed` | Answer submitted | `challenge_id`, `correct: bool`, `lookups_used: 0 \| 1–2 \| 3+`, `duration_bucket` |
| `challenge_shared` | Share action succeeds | `challenge_id`, `method: native_share \| copy` |
| `level_changed` | Learner level setting changed | `from`, `to` |
| `deck_session_started` **[M2]** | First card of a session shown | `due_count_bucket: 1–5 \| 6–20 \| >20` |
| `deck_card_reviewed` **[M2]** | Grade submitted | `grade: again \| hard \| good \| easy` |
| `deck_session_completed` **[M2]** | Due queue emptied or session exited | `cards_bucket`, `completed: bool` |
| `account_created` **[M2]** | Signup completes | `trigger: t2_gate \| sync \| deck_cap \| archive \| unprompted` |
| `subscribe_started` **[M3]** | Stripe Checkout opened | `surface: t2_gate \| pricing_page \| deck_cap \| archive` |
| `subscribe_completed` **[M3][srv]** | Stripe webhook: subscription active | `plan: monthly \| annual` |
| `subscription_churned` **[M3][srv]** | Stripe webhook: subscription ended | `tenure_months_bucket: 1 \| 2–3 \| 4–12 \| >12` |
| `t2_error` **[srv]** | Proxy failure after metering checks | `class: provider_timeout \| provider_error \| circuit_breaker \| internal` |

### 3.4 Enforcement

CI runs a schema test: the adapter's `AllowedEvent` union must be derivable from a machine-readable copy of §3.3 (`analytics/events.schema.json`, kept in-repo and updated in the same PR as this document). A second test greps built bundles for PostHog calls outside the adapter. A third asserts no property value in fixture emissions exceeds 64 chars (catches accidental free-text).

---

## 4. KPI definitions

Each KPI states: formula, unit of analysis, and the decision it serves. Compute all of these as weekly dashboard tiles (§7.1); gates in §5 reference them by K-number.

**K1 — Activation rate.** Devices performing ≥3 `lookup` events in their first session ÷ devices with `first_ever` `app_opened`, per weekly cohort. Three lookups is the proxy for "experienced the product's point"; one lookup can be accidental. *Serves G-M1.*

**K2 — D1 / D7 / D30 retention.** Devices with any event on UTC day N after first open ÷ cohort size. Standard unbounded day-N retention, PostHog retention table. *Serves G-M1, G-M2.*

**K3 — Lookups per reading session.** Median `lookup` count per session containing ≥1 `snippet_loaded` with `source ∈ {paste, sample, url_import}` (challenge sessions excluded — they inflate this). *Serves G-M1 (product-truth signal), content decisions.*

**K4 — T0 share and T1 miss rate.** `tier=t0 ÷ all lookups` (target ≥ 0.80 per design doc §7.2) and `tier=t1_miss ÷ all lookups`. Weekly, per pack version. The per-concept breakdown of t1_miss query volume (aggregate counts only, per P2) is the content pipeline's backlog input (design doc §13). *Serves corpus expansion decisions; alarm A3.*

**K5 — Challenge funnel.** `challenge_started → challenge_completed → challenge_shared`, weekly. Headline: **share rate** = shared ÷ completed. *Serves G-M1.*

**K6 — Effective viral factor.** New devices whose first `app_opened` has `entry = share_link` in week W ÷ devices that emitted `challenge_shared` in weeks W-1..W. Crude but honest; direction matters more than precision. *Serves G-M1 and distribution planning.*

**K7 — Deck adoption and stickiness [M2].** (a) Devices/users with ≥1 `deck_session_started` within 7 days of first deck exposure ÷ exposed; (b) deck week-2 return: deck users active in the deck in the week after their first deck week ÷ deck starters. *Serves G-M2.*

**K8 — Registration conversion [M2].** `account_created` ÷ devices emitting any of its triggering events (`t2_blocked(no_account)`, deck-cap hit, archive gate), by trigger. *Serves G-M3 pricing/gating design.*

**K9 — Paid conversion [M3].** Users with `subscribe_completed` ÷ registered users active in the same 8-week window. Secondary: by `surface`. *Serves G-M3.*

**K10 — T2 unit economics [M3].** From server metering: provider cost per Pro user per month; `cached=true` share of T2 requests; gross margin = (ARPU − provider cost − infra per user) ÷ ARPU. *Serves G-M3 and the I18 circuit-breaker setting.*

**K11 — Churn [M3].** Monthly logo churn = `subscription_churned` ÷ active subscriptions at period start. *Serves G-M3.*

**K12 — Guardrail: lookup latency.** p75 of `lookup.latency_bucket` must sit in `<50ms` for `tier=t0` (I2 as observed in the field, not just in CI). *Serves alarm A1.*

---

## 5. Decision gates

### 5.1 How gates work

Each gate has: an evaluation date (fixed relative to the milestone ship date), a minimum denominator (P5), and three pre-registered outcomes — **Proceed**, **Iterate** (bounded), **Stop/Pivot**. "Iterate" is deliberately bounded to one cycle per gate to prevent zombie-project drift: after one iterate cycle, the re-evaluation admits only Proceed or Stop.

> **A note on the numbers.** The thresholds below are set from consumer-learning-app norms (D7 of 10–20% is healthy for content/utility web apps; sub-5% rarely recovers) and from this product's cost structure (free tier is near-zero marginal cost, so modest conversion clears). They are estimates and *editable until M1 ships* — after that, P4 applies. If you disagree with a number, change it this week, not in week 5.

### 5.2 Gate G-M1 — "Does anyone want to read code this way?"

- **Evaluated:** 28 days after M1 public launch (the r/learnprogramming post date).
- **Minimum denominator:** 300 activated devices (K1 numerator). **If not reached by day 28,** the gate converts to a *distribution* verdict: the product is unjudged, the channel plan failed. Execute the two untried channels in the launch plan over 14 days; if still <300, Stop — per the founding premise, an idea that can't find 300 triers in named channels fails the "where do 1,000 buyers gather" test regardless of product quality.

| Verdict | Condition (all units: devices) |
|---|---|
| **Proceed to M2** | K2-D7 ≥ 10% **or** (K1 ≥ 40% **and** K5 share rate ≥ 8%) |
| **Iterate (≤ 28 days, once)** | K2-D7 in [4%, 10%) — fix the single biggest funnel leak (choose using K1/K3/K5), then re-evaluate |
| **Stop / Pivot** | K2-D7 < 4% **and** K5 share rate < 4% |

Secondary reads recorded at the gate (not decisive, but they shape M2): K3 (median lookups/reading session — < 3 means the reader isn't the draw even among retained users), K4 (t1_miss > 15% means corpus coverage is the leak, an iterate-cycle candidate), K6 (any organic share-driven acquisition at all).

### 5.3 Gate G-M2 — "Is the deck a retention engine or a feature?"

- **Evaluated:** 21 days after M2 ships to all users. **Minimum denominator:** 150 deck-exposed users.
- **Engine** (K7a ≥ 25% and K7b ≥ 35%): the deck becomes the organizing surface of the home screen, and Pro packaging (M3) leads with it.
- **Feature** (below either bar): the deck stays, demoted from home-screen primacy; M3 proceeds anyway with T2 as the lead paid surface. *This gate never blocks M3* — it decides what M3 sells, not whether.
- **Negative signal worth recording:** if K2-D7 for deck-users vs. non-deck-users shows no lift, say so in the log and resist the temptation to build more retention machinery before M3.

### 5.4 Gate G-M3 — "Is this a business?"

- **Evaluated:** 56 days after M3 ships (two full monthly billing cycles). **Minimum denominator:** 400 registered users active in the window.

| Verdict | Condition |
|---|---|
| **Proceed (scale: second language, Capacitor, paid acquisition tests)** | K9 ≥ 1.5% **and** K10 gross margin ≥ 80% **and** K11 ≤ 10%/mo |
| **Iterate (once, ≤ 42 days: pricing/packaging test — annual emphasis, gate placement, price point)** | K9 in [0.5%, 1.5%) with margin and churn passing |
| **Stop monetization / reposition** | K9 < 0.5% after the pricing iterate, **or** K11 > 20%/mo (paying users leave: product, not price) |

Margin failure (K10 < 80%) is treated as an engineering defect, not a gate failure — the design (T2 cache, caps, I18) is built to make margin a controllable; fix the leak (cache hit rate, quota abuse, prompt length) and re-read.

### 5.5 Standing kill criteria (any time)

Independent of gates: (a) a P2/I1 violation discovered in shipped analytics → ship a fix and purge affected data within 72h, log publicly in the changelog; (b) sustained provider-cost anomaly that trips the I18 circuit breaker twice in a month without an identified bug → freeze T2 for free tier until understood.

---

## 6. Operational alarms

Not decisions — pages. A1: field p75 T0 latency leaves the `<50ms` bucket for 2 consecutive days (K12). A2: `pack_verify_failed` > 0.5% of installs in a day (supply-chain or CDN issue; I13). A3: `t1_miss` share doubles week-over-week after a pack release (regression in selectors or index). A4 [M3]: `t2_error` rate > 2% over an hour, or circuit breaker trip (I18). Alarms route to email + phone; each has a runbook entry in the ops one-pager.

---

## 7. Rituals and records

### 7.1 Weekly review (30 minutes, same time every week)

Look at exactly six tiles: K1, K2 (D1/D7), K3, K5 share rate, K4 t1_miss, and — post-M3 — K9/K10 replacing two of the above. Write three sentences in the log: what moved, the single most plausible cause, the one action (or explicit no-action) for the week. The discipline is the point; dashboards without a writing ritual become wallpaper.

### 7.2 Dashboard spec

One PostHog dashboard, "Sightread — Decisions," containing only the K-tiles above plus the funnel views for K5 and K8. No secondary dashboards until a gate demands one. Insight names match K-numbers.

### 7.3 Amendment log

| Date | Change | Rationale | Window open? |
|---|---|---|---|
| 2026-07-05 | v1.0 created | — | No |

---

## Appendix A — Sample-size rationale

The minimum denominators are set so the gate thresholds are distinguishable from noise at roughly the 90% confidence level: at n=300, a true D7 of 10% is observed in [7%, 13%] — comfortably separable from the 4% kill line; at n=150, K7a's 25% bar has a ±6-point band; at n=400, K9's 1.5% bar has a ±1-point band, which is why G-M3 waits 56 days. If growth outruns these minimums, evaluate on the gate date regardless — more data never postpones a gate.
