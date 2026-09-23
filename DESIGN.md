# Dana's Dashboard — design

What this is, what each feature does, and where the line sits between what the software
decides and what a person decides.

---

## The problem

A small allergy and dermatology clinic has one coordinator and three prescribers. Nobody
knows a patient has run out of medication — or is carrying an expired EpiPen — until the
patient calls.

Every prescription has a date it stops working: the day it was filled plus its days
supply. Photon knows both numbers. Nothing multiplies them.

So the clinic is reactive. Every task arrives as a complaint, days after the failure, from
the person least able to fix it.

---

## The shape

Three steps, and only one of them uses a model.

| | What it does | How |
|---|---|---|
| **Notice** | Compute who is about to fail | Rules. No AI |
| **Sort** | Put each problem in front of whoever can actually clear it | Rules. No AI |
| **Prepare** | Read the messy parts and take a position | A model |

The number that matters: **what fraction of problems never reach a physician.** Today it
reads 67%. A version of this that escalates everything would score badly on that, which is
the correct behaviour for that metric.

---

## Features

### 1. The five flags — *built*

Computed nightly from Photon. Pure arithmetic.

| Flag | Rule | Example |
|---|---|---|
| Device expiring | Auto-injector approaching a year from dispense | Marisol's EpiPen, 27 days |
| Running out | Fill date + days supply lands before the next visit, no refills left | Walt's Flonase, 7 days |
| Stranded | Order ready at the pharmacy ≥ 7 days, never collected | Renata's antihistamine, 10 days |
| Blocked | Coverage returned not-covered or prior-auth-required | Theo's Dupixent |
| Ran short | Refilled far sooner than the days supply allows | Devon's tube, 30 days gone in 11 |

**Never picked up** is the one worth calling out. It is the clinic's only signal that
something went wrong after the prescription left the building, and nothing surfaces it
today. Most non-collection is logistics — wrong pharmacy, cost, hours, a queue — not
refusal. The product treats it that way.

### 2. Three queues — *built*

| Queue | Holds | Who clears it |
|---|---|---|
| **Dana** | Reroute, switch to delivery, call, book, start a prior auth | The coordinator |
| **Waiting** | Parked on labs, a prior auth decision, or a patient reply | Nobody, yet |
| **Sent to Dr. Reyes** | Signatures, and only signatures | A prescriber |

Routing is deliberate, not incidental. *Ran short* goes to **Dana**, not the physician: a
tube gone in a third of its days supply has an ordinary explanation, and finding it out is
a phone call. It reaches a prescriber only once it has an answer attached.

### 3. Reroute a stranded order — *built, and it really writes*

Dana picks from real pharmacies in Photon's directory; the app calls `routeOrder`. The
order moves and Photon texts the patient.

This is the one place the app writes clinical-adjacent data, and it is allowed precisely
because it is **logistics, not medicine** — see *The boundary* below.

### 4. Recommendation to the physician — *built, uses a model*

For the two items that reach a prescriber, the assistant has already read the chart: the
free-text sig, allergies and allergy status, medication history, the insurer's own
wording, and how long since the patient was last seen. It states one line — approve, see
them first, or hold — with the facts it leaned on.

On Marisol it wrote: *"Allergy list and medication list are both empty on file — no
documented anaphylaxis trigger for an allergy clinic patient."* Nobody told it that was
strange.

**It does not re-run interaction screening**, and it says so rather than implying a clean
result. Wiring `prescriptionScreen` is backlog item 2.

### 5. Review and sign — *built, prefilled*

The button prepares the renewal in Photon and opens the prescribe form with it filled in.

| Carried into the form | Left out |
|---|---|
| Drug, quantity, unit, days supply | Any *suggested* change |
| The sig, word for word | Anything the model wrote itself |
| The refill count, when it is arithmetic | |

**The rule: prefill what can be proven, ask about what cannot.** The refill count is
computed — *"her next visit is Nov 12, one refill covers it"* — so it is carried. The
quantity suggestion on a short-supply item is a question, so it is deliberately **not**
baked into the form. Filling a guessed dose into something a busy person may sign on
autopilot is how you get a wrong prescription.

*Not yet built:* signing should also text the patient to say a renewal is on its way.
Today they find out when the pharmacy tells them.

### 6. View patient info — *built*

On every card, in all three columns. Name, date of birth, address, and the phone number as
a dial link. Whatever is wrong, whoever is handling it can reach the patient without
leaving the screen.

### 7. The patient message — *built as a preview, uses a model*

Clicking a text action drafts the message and shows it as a preview. **Nothing is sent** —
outbound SMS needs a provider the clinic owns.

What it wrote for Renata:

> *"…your levocetirizine has been waiting at Duane Reade for 10 days, and you have 3
> refills left. If that pharmacy is hard to get to, or the cost is the issue, we can move
> it somewhere easier today. Your visit on Nov 2 is still set. Text MOVE with a pharmacy
> name, COST, or CALL."*

The rules it works under:

- **Never imply fault.** Most people who miss a prescription are blocked, not careless.
- **Never send a message the patient cannot act on.** Every one ends in a reply they can send.
- **Never ask a question the clinic already knows the answer to.** She has a visit booked, so
  it says so rather than asking.

The model never sees a name. It writes a placeholder and the app substitutes, so nothing
identifying leaves the process. A draft that loses the placeholder is **rejected**, not
patched — a message addressed to the wrong person is worse than no message.

Replies would come back to the clinic, not into Photon: **Photon exposes no
patient-facing link** for an order anywhere in its API, so there is nothing to send someone
to. `MOVE` maps onto `routeOrder`, which the app can already do.

### 8. Going out of office — *not built, and the first thing I'd add*

Whoever holds a clinic's coordination work is a single point of failure. When Dana takes
four days off, nobody knows what will quietly fail while she is gone — and the failures are
invisible by construction, because the whole premise of this product is that they are
already invisible.

The shape seems obvious: pick your dates, see what falls due in that window, hand each item
to someone who is in, and push anything needing a signature up before you go.

**I did not build it, because I do not yet understand the problem well enough.** A clinic
of this size has one coordinator and three prescribers. If Dana is away there is no second
coordinator to hand her queue to — the only people left are the physicians, and pushing
front-office work onto them inverts the entire point of the product. So the obvious design
is wrong for the clinic it was designed for.

What I would need to find out first:

- When the front office is short-staffed, what actually happens today? Does the work wait,
  get triaged, or get absorbed by clinical staff?
- Is coverage a real role in small practices, or does a queue simply hold?
- Does this differ between a three-person practice and a thirty-person one? A design that
  assumes a colleague to hand off to only works above some size.
- What does a physician genuinely want to be handed while the coordinator is away, and what
  would they consider someone else's job?

That is interview work, not engineering work, and guessing at it would produce a feature
that demos well and nobody uses.

What I am confident about is the underlying need: **it is hard to know what will go unnoticed
while you are gone.** That is true of the coordinator and equally true of a physician. It is
the same problem this product already solves for patients, pointed at staff instead.

### 9. Forward to the front office — *not built*

A prescriber looking at a signature request should be able to push it back down: *this needs
a conversation before I sign*. Dana would not have the same button, because the flow runs one
way — she escalates, he returns.

Blocked on the same missing piece as handover: items have no owner, so there is nothing to
reassign.

---

## The boundary

The most important design decision was not made by me.

```
createPrescription       → MISSING_PERMISSIONS: write:prescription
createPrescriptionTemplate → OK
routeOrder               → OK
updatePatient            → OK
```

A machine token may **pre-draft** and may move **logistics**. It may not **prescribe**.
Photon enforces that in its permission model, so the safety property of this app does not
depend on my prompt, my judgement, or my code being correct.

Everything else follows from it. The assistant reroutes orders by itself. It prepares
renewals and stops at the signature. It never decides whether a patient needs to be seen —
a prescriber records that at write time, and the assistant only routes on it.

---

## Where a model is used, and where it is not

| Used | Not used |
|---|---|
| Recommending on a renewal (reads a messy chart) | Working out when someone runs out |
| Writing the message to a patient (tone, and what they can do) | Deciding which queue something belongs in |
| | Any arithmetic, ever |

Two calls, both on language or judgement. Everything numeric is rules, because rules are
auditable, cheap, testable, and cannot invent a date.

---

## Not built, and what each would need

| | Blocked on |
|---|---|
| Handover before time off | Research first — see feature 8. Then a user model |
| Assigning and forwarding work | A user model — items have no owner today, so there is nothing to reassign |
| Sending the patient message | An SMS provider; Photon texts only for pharmacy selection |
| Reading patient replies | The same, plus a webhook |
| Re-running interaction screening | A second Photon domain and a call per flag |
| Texting on signature | Depends on the SMS provider above |
| Controlled substances | EPCS is undocumented across all 21 Photon doc pages |

---

## What is simulated, and why

Photon's sandbox never advances a fill: every fill returns `state: NEW` with
`filledAt: null`, and orders sit in `ROUTING` forever because no real patient picks a
pharmacy. Fill history is what this product is built on, so it is simulated in
`data/overlay.json`.

Photon also has no concept of an appointment, a device expiry, or a renewal policy. Each
of those is a line in `FEEDBACK.md`.

Everything else — patients, prescriptions, treatments, fills, allergies, medication
history, pharmacies, drug search, permissions — is real, live, and read from the sandbox.
