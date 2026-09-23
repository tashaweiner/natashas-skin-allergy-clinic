# Dana's Dashboard

A between-visits assistant for a small allergy and dermatology clinic, built on Photon.

**The problem:** nobody at the clinic knows a patient has run out of medication — or is
carrying an expired EpiPen — until the patient tells them. Every prescription has a date
it stops working. That date is knowable the moment the medication is dispensed. It is
displayed nowhere, alerted on by nothing, and owned by no one.

Photon has every fact needed to compute it and never does.

---

## Run it

```bash
npm install
cp .env.local.example .env.local     # add PHOTON_CLIENT_ID / PHOTON_CLIENT_SECRET
npm run probe                        # confirms auth + shows what the API returns
npm run reseed                       # creates six demo patients in your sandbox
```

Prescriptions must be created through Photon's MCP server or the Neutron app — a machine
token is refused `write:prescription` (see below). The prompt is in
[`scripts/reseed-patients.ts`](scripts/reseed-patients.ts).

```bash
npm run seed                         # builds the local overlay from what's in Photon
npm run dev                          # http://localhost:3000
```

`ANTHROPIC_API_KEY` is optional. Without it the recommendation layer falls back to a
deterministic rule and says so on screen.

---

## What it does

**1. Watches.** Reads the clinic's panel from Photon and computes five conditions. This is
arithmetic and deliberately not AI.

| Flag | Rule |
|---|---|
| Device expiring | An auto-injector approaching a year from dispense |
| Running out | `filledAt + daysSupply` lands before the next visit, no refills left |
| Stranded | Order ready at the pharmacy ≥ 7 days, never collected |
| Blocked | Coverage came back not-covered or prior-auth-required |
| Ran short | Refilled far sooner than the days supply allows — for a topical, usually a flare |

**2. Sorts.** Into three queues:

| Queue | Holds | Cleared by |
|---|---|---|
| **Dana** | Logistics — reroute, switch to delivery, start a prior auth, book a visit | The coordinator |
| **Waiting** | Parked on labs, a prior auth decision, or a patient reply. A watcher moves it when the trigger fires | Nobody, yet |
| **Dr. Reyes** | Signatures, and only signatures | The physician |

The number that matters is **what fraction of problems never reach a physician.** A version
of this that escalates everything scores badly on that, correctly.

**3. Recommends.** For items reaching a physician, Claude reads the chart — the free-text
sig, allergies, medication history, the insurer's coverage message, time since last visit
— and states one line: approve, see them first, or hold, with the facts it leaned on.

That is the only place a model is used, because it is the only place the input is language
rather than numbers. It never makes a pharmacological judgment of its own — and it is told
explicitly that interaction screening was **not** re-run for the renewal, rather than being
handed a clean result nobody fetched. Wiring `prescriptionScreen` is
[`BACKLOG.md`](BACKLOG.md) item 2.

---

## The safety boundary is Photon's, not mine

```
createPrescription → MISSING_PERMISSIONS: write:prescription
```

A machine token gets `read:patient write:patient read:prescription read:order write:order`.
It does not get `write:prescription` — Photon reserves that for authorized providers.

So this assistant can fix **logistics** on its own (`routeOrder`, `updatePatient`,
`cancelOrder`) and **cannot** make a clinical decision, even if instructed to. That line is
enforced by the platform rather than by my prompt, which is the right place for it.

Every signature happens in Photon, by a physician.

---

## What's real and what isn't

| Real, from Photon | Simulated in `data/overlay.json` |
|---|---|
| Patients, prescriptions, treatments, fills | Fill dates and pickup state |
| Days supply, fills allowed, fill state | Refills actually collected |
| Allergies, medication history | Device expiry |
| Drug search | Appointments, last visit |
| Auth, scopes, permission errors | Coverage message, renewal policy, what an item waits on |

**Why:** Photon's sandbox never advances a fill. Every fill comes back `state: NEW` with
`filledAt: null`, and orders sit in `ROUTING` with a null pharmacy, because no real patient
is picking one. Fill history is the thing this product is built on, so it had to be
simulated. Photon also has no concept of an appointment, a device expiry, or a renewal
policy.

Each simulated field is commented in [`src/lib/overlay.ts`](src/lib/overlay.ts) with what
Photon would supply in production. [`BACKLOG.md`](BACKLOG.md) has the table of what should
move back.

---

## Two findings worth reading

**`fillsRemaining` does not mean refills remaining.** A prescription came back with
`fillsAllowed: 3`, three fill objects all in `NEW`, and `fillsRemaining: 0`. Photon
instantiates every fill at order time and zeroes the counter, so the field counts fills not
yet created. Anyone building a refill product on that field name gets it backwards. This
code counts fills still in `NEW` — see the comment in
[`src/lib/panel.ts`](src/lib/panel.ts).

**Photon has no concept of "about to run out."** Its nearest event,
`photon:prescription:expired`, fires a year out and means nothing clinically. Every
ingredient for the date that matters is in the API and nothing assembles it.

Sixteen more in [`FEEDBACK.md`](FEEDBACK.md), including what Photon gets right.

---

## Layout

```
src/lib/photon.ts      auth + GraphQL against api.neutron.health
src/lib/panel.ts       the watcher — five flags, three queues, no AI
src/lib/overlay.ts     local store for what Photon can't hold
src/lib/recommend.ts   the one model call
src/app/page.tsx       the screen
scripts/probe.ts       what the API actually returns
scripts/reseed-patients.ts
scripts/seed-overlay.ts
```

---

## On scope and time

The build is about three hours. I spent considerably longer than that on the API, the
docs, and the sandbox app — and that's where most of [`FEEDBACK.md`](FEEDBACK.md) came
from. It's also what I'd have done before joining regardless.

Deliberately left out, and why:

- **Controlled substances.** EPCS is undocumented across all 21 doc pages, and the DEA's
  transfer rules likely break the patient-reroute flow. I'd want answers before building.
- **Embedding Photon Elements.** The sign button deep-links instead. Same flow, and the
  auth plumbing wasn't where the risk or the interesting part was.
- **Real SMS.** Photon only texts for pharmacy selection; inbound replies need a provider.
- **Anything that sends without a human.**
