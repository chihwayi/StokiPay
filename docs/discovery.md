# Sprint 0 Discovery

## Status: hypotheses drafted, real interviews NOT YET CONDUCTED

`sprints.md` requires this document to identify launch users, validated pains, pricing hypotheses and unresolved risks from **10–15 target user interviews**. No such interviews have been conducted yet — nobody with access to real Zimbabwean SME owners has run them. Everything below is a hypothesis derived from `project_description.md`'s persona research and stated market context, **not validated field evidence**. Do not cite this document as proof of demand, willingness to pay, or feature priority; treat every claim below as "to be tested," not "known."

This is recorded honestly, per `CLAUDE.md`'s rule against claiming evidence that doesn't exist, rather than fabricating interview notes to close this checklist item.

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

- **No real interviews yet** is itself the top risk: every downstream product decision in Sprint 1+ is currently built on assumption, not evidence.
- Mobile money aggregator terms (Paynow vs. direct EcoCash API access, fee structure) — not yet confirmed with a provider.
- Fiscal/VAT compliance requirements — not yet confirmed with a compliance professional; no fiscal compliance claim is authorized until this happens (`sprints.md` locked decision).
- FX-rate source and approval trust — no shop-owner input yet on which rate source they'd trust for the exchange-rate snapshot model (ADR 0004).

## Recommended next step

Before Sprint 1 begins in earnest, the project owner (or whoever has access to real SME contacts) should run the 10–15 interviews against the questions above and replace this document's hypotheses with recorded findings. This is a human-relationship task an AI assistant cannot perform on its own behalf.
