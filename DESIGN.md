# Dana's Dashboard — design

## In one sentence

**The clinic finds out a patient is in trouble before the patient does.**

---

## The problem

Every prescription has a date it stops working: the day it was filled plus its days supply.
Photon knows both numbers. Nothing multiplies them.

So nobody at the clinic knows a patient has run out — or is carrying an expired EpiPen —
until the patient calls. Every task arrives as a complaint, days after the failure, from the
person least able to fix it. **The patient is the clinic's error-handling mechanism.**

---

## The value, concretely

One patient, one prescription:

| | Today | With this |
|---|---|---|
| Sep 3 | Renata's antihistamine is sent | same |
| Sep 13 | — | *ready 10 days, never collected* → Dana moves it to a pharmacy near her office, in one click |
| Sep 14 | — | Renata gets a text. She has her medication |
| Sep 24 | Renata calls, out of medication, upset | nothing happened |
| Sep 24 | Dana: 25 minutes on hold | Dana: 20 seconds, ten days earlier |

Three people get something different out of it:

| | What changes |
|---|---|
| **Dana** | Her morning is four things to approve, not six complaints to chase. She acts ten days early instead of ten days late |
| **A prescriber** | One batched signature queue instead of interruptions, and each one arrives with the chart already read |
| **The patient** | Finds out from the clinic, with a fix attached — not from an empty bottle |

**The number that says whether it works:** what fraction of problems never reach a
physician. Today's panel reads 67%. A version of this that escalates everything would score
badly on that, which is the correct behaviour for that metric.

---

## What this deliberately is not

Narrowness is the design. This product watches exactly one thing: **whether the medicine
actually arrives, and keeps arriving.**

- Not an EHR, and not a replacement for one
- Not a scribe — it is not in the room, and the prescribing moment already works fine
- Not prior-auth automation — it notices a PA is blocking something and stops there
- Not a patient app — everything goes out as the clinic, approved by a person
- Not a chat box. A chat box requires you to already know what to ask; the whole problem is
  that nobody knew

Photon solved getting a prescription *sent*. This solves noticing when it did not *land*.

---

## How it works

Three steps. Only one of them uses a model.

| | What it does | How |
|---|---|---|
| **Notice** | Compute who is about to fail | Rules. No AI |
| **Sort** | Put each problem in front of whoever can actually clear it | Rules. No AI |
| **Prepare** | Read the messy parts and take a position | A model |

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

### 8. Vacation coverage — *not built, and the first thing I'd add*

Before a clinician goes on leave, the assistant lists every patient who will need a refill
or a dose change while they are away, drafts each prescription, and hands the covering
physician a prepared queue instead of a surprise.

Today that transfer happens by memory, or not at all. A patient whose supply ends on the
Thursday of someone's holiday is invisible to everyone: their own doctor is gone, and the
covering doctor has no idea they exist until the pharmacy calls.

**This is the two things already built, composed.** The runway calculation already knows who
runs out and when — filter it to the leave window instead of the next ten days. The renewal
prefill already turns a prescription into a Photon template — run it over the list. The
covering physician opens a queue where every item is drafted, with the same recommendation
and the same copied-forward sig.

| Input | Already have it |
|---|---|
| Who runs out between the 12th and the 20th | The runway computation |
| What to write for each | The renewal draft — copy, plus computed changes |
| Whether it can go without a visit | The renewal policy flag |
| Whether it looks safe to sign | The recommendation |

What it adds is a **date window** and a **second reader**.

*The coordinator version is harder, and I would not start there.* When Dana takes leave
there is nobody to hand her queue to — this clinic has one coordinator and three
prescribers, and pushing front-office work onto physicians inverts the point of the product.
Before designing that I would want to know what short-staffed front offices actually do
today, whether coverage is a real role in a three-person practice, and how differently a
thirty-person practice behaves. That is interview work, not engineering work.

The clinician version has none of those unknowns. It is the one to build.

### 9. Create a ticket by hand — *not built*

Everything on the board today is computed. But a patient calls and says something the data
cannot know — *"I'm moving to Denver next month"*, *"the cream is burning"*, *"I lost the
EpiPen"* — and right now there is nowhere to put that.

Both Dana and a prescriber should be able to open an item by hand: pick the patient, write
what happened, choose whether it needs a signature. It then lives in the same three queues
as everything else.

This is what stops the product being a read-only report. It also closes the loop on inbound
replies later: a text back from a patient becomes exactly this kind of item.

Small to build, and it needs the same missing piece as the two below — items have no owner,
no author, and no manual state.

### 10. Forward to the front office — *not built*

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
| Creating an item by hand | A user model and a writable item store — everything is computed today |
| Vacation coverage | Nothing structural — a date window over what already exists. See feature 8 |
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
