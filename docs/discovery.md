# Sprint 0 Discovery

## Status: hypotheses drafted; owner has explicitly accepted hypothesis-only discovery

`sprints.md` originally asked this document to identify launch users, validated pains, pricing hypotheses and unresolved risks from **10–15 target user interviews**. No such interviews were conducted. On 2026-08-26 the owner (chihwayii@outlook.com) explicitly instructed that this gap be set aside so development can proceed — this is recorded here as the **documented owner acceptance of hypothesis-only discovery** that `docs/runbooks/coolify-deployment.md`'s Sprint 0 exit evidence anticipates as an alternative to real interviews.

Everything below therefore remains a hypothesis derived from `project_description.md`'s persona research and stated market context, **not validated field evidence** — the owner has chosen to accept that risk and proceed rather than block on it. Product/UX decisions in later sprints should still treat these as assumptions to revisit if real user feedback contradicts them, not as confirmed requirements.

## What real interviews still need to establish

1. **Launch users** — which specific shops/owners (by name, location, vertical) will be the first 10–15 test users, and who is recruiting them.
2. **Validated pains** — do real retail/bottle-store owners actually rank "no profit visibility" and "stock theft/shrinkage" as their top two pains, as the persona table assumes, or is something else (e.g. staff trust, supplier credit terms) more urgent in practice?
3. **Payment reality** — what share of daily transactions are cash vs. EcoCash vs. OneMoney vs. bank transfer vs. credit, and how much of that already runs through Paynow-compatible rails vs. informal/manual EcoCash?
4. **Currency behavior** — are prices actually set in USD and rate-derived, or set independently per currency? How often do owners see disputes over which day's rate applied?
5. **Connectivity reality** — how many hours/days per week is a typical shop offline (load-shedding, no data), and does that match the "offline-first, not offline-tolerant" assumption driving the whole architecture?
6. **Pricing hypothesis** — is the free tier (single branch/staff) actually the right wedge, and is a monthly EcoCash-payable fee for Growth tier a price point owners would accept, or does the "pay once, own it" pattern dominate as strongly as assumed?
7. **Compliance** — current ZIMRA/fiscalisation and VAT-invoice requirements, confirmed with an actual Zimbabwe tax/compliance professional (per `sprints.md`'s locked decision: no fiscal compliance claim until this happens).

## Hypotheses carried forward from `project_description.md` (unvalidated)

- Personas: Tendai (grocery/tuck shop), Mai Chipo (hardware), Farai (bottle store, 2 branches), Rudo (pharmacy), Blessing (informal trader) — see `project_description.md` §3. These are illustrative archetypes, not confirmed interview subjects.
- Top assumed pains: no profit visibility (revenue tracked, COGS not), invisible shrinkage, no remote multi-branch visibility, no customer/debt history.
- Assumed launch verticals (already locked in `sprints.md` regardless of this discovery gap): general retail and bottle store.
- Assumed competitors: EllzTech, Vizion Technologies, Smart POS Software, Matiyas/ERPNext-based systems — not independently re-verified for this discovery pass.

## Unresolved risks

- **Discovery remains unvalidated by design** (owner-accepted, see Status above): every downstream product decision in Sprint 1+ is built on assumption, not field evidence. If real usage or feedback later contradicts a hypothesis here, treat the hypothesis as wrong, not the feedback.
- Mobile money aggregator terms (Paynow vs. direct EcoCash API access, fee structure) — not yet confirmed with a provider.
- Fiscal/VAT compliance requirements — not yet confirmed with a compliance professional; no fiscal compliance claim is authorized until this happens (`sprints.md` locked decision). This is independent of the discovery-interview decision and still applies.
- FX-rate source and approval trust — no shop-owner input yet on which rate source they'd trust for the exchange-rate snapshot model (ADR 0004).

## Recommended next step

Development proceeds on the hypotheses above per the owner's 2026-08-26 decision. If real SME interviews become available later, replace the relevant hypotheses with recorded findings and reassess any feature built on an assumption that turned out wrong — this document's hypotheses are not load-bearing for compliance/security requirements (fiscal, RLS, idempotency), only for product/UX prioritization.
