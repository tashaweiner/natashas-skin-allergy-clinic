# Dana's Dashboard — design

## The problem

Every prescription has a date it stops working: the day it was filled plus its days supply.
Photon knows both numbers. Nothing multiplies them.

So nobody at the clinic knows a patient has run out — or is carrying an expired EpiPen —
until the patient calls. Every task arrives as a complaint, days late, from the person least
able to fix it.

## How we fix it

**Compute that date for every patient, and put each problem in front of whoever can actually
clear it — before the patient notices.**

Measured by: what fraction of problems never reach a physician. Today's panel reads 67%.

---

## What it does

| Feature | What it does |
|---|---|
| **Five flags** | Nightly, computes who's failing: device expiring, running out, never picked up, coverage blocked, supply ran short |
| **Three queues** | Sorts each one to **Dana** (logistics), **Waiting** (parked on labs or a PA), or **Dr. Reyes** (signatures only) |
| **Move a pharmacy** | Dana picks from Photon's directory; the app calls `routeOrder`. A real write — the order moves and the patient gets a text |
| **Recommendation** | For items reaching a physician, Claude reads the chart and says approve / see them first / hold, with its reasons |
| **Review and sign** | Pre-drafts the renewal as a Photon template and opens the prescribe form filled in |
| **Patient message** | Claude drafts the text the clinic would send. Shown as a preview — nothing is sent |
| **View patient info** | Name, DOB, address, and a tap-to-dial number on every card |

### Two rules worth knowing

**Routing is deliberate.** *Ran short* goes to Dana, not the physician — a tube gone in a
third of its days supply usually has an ordinary explanation, and finding out is a phone
call. It reaches a prescriber only with the answer attached.

**Prefill what you can prove, ask about what you can't.** The refill count is arithmetic, so
it's carried into the form. The quantity suggestion is a question, so it deliberately isn't.

---

## Where AI is used, and where it isn't

| Used | Not used |
|---|---|
| Recommending on a renewal — reads a messy chart | Working out when someone runs out |
| Writing the patient message — tone, and what they can do | Deciding which queue something belongs in |
| | Any arithmetic, ever |

Two calls, both on language. Everything numeric is rules: auditable, testable, and unable to
invent a date.

**No patient identifier reaches the model.** Both prompts live in `src/lib/prompts.ts`, and
`npm run audit` builds the real strings and checks them against every name, date of birth,
phone, email, address, and Photon id in the live panel. It currently checks 12 prompts
against 128 identifiers across 19 patients and finds nothing.

The patient message is the interesting case: the model writes the literal token `{{name}}`
and the app substitutes afterwards. A draft that loses the token is rejected rather than
patched — a message addressed to the wrong person is worse than no message.

---

## The safety boundary

```
createPrescription         → MISSING_PERMISSIONS: write:prescription
createPrescriptionTemplate → OK
routeOrder                 → OK
```

A machine token may pre-draft and may move logistics. It may not prescribe. Photon enforces
that, so the safety of this app doesn't depend on my code being correct.

---

## What I'd build next

| | Why it isn't here |
|---|---|
| **Vacation coverage for a clinician** | The runway calculation and the renewal prefill, over a date window. Nothing structural missing — just didn't get to it |
| Ask the patient what they're actually taking | Needs the reply loop below |
| Create an item by hand | Everything is computed today; items have no owner or author |
| Real inbound replies | Needs an SMS provider — Photon only texts for pharmacy selection |
| Re-run interaction screening | A second Photon domain and a call per flag |
| Controlled substances | Photon doesn't support them yet — confirmed with Charles |

Fuller versions of these in [`BACKLOG.md`](BACKLOG.md).

---

## What's simulated

Photon's sandbox never advances a fill — every fill returns `state: NEW` with
`filledAt: null` — and it has no concept of an appointment, a device expiry, or whether a
renewal needs a visit. Without those, none of the five rules can fire.

So `scripts/seed-overlay.ts` invents that history — **for every patient, on the same terms.**
No patient is singled out and no scenario is assigned. Each value is derived deterministically
from the prescription's own id, plus real drug attributes: auto-injectors get a one-year
expiry because that is a property of the device, biologics usually hit prior authorisation
because they usually do.

Then the rules run, and whoever trips one trips it on the merits. Which patients appear on
the board is not a decision anyone made — today it happens to be six of nineteen, and two of
them are patients I never intended to surface.

Everything else is live: patients, prescriptions, fills, allergies, medication history,
pharmacies, drug search, permissions.
