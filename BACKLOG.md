# What I'd build next

Ordered by what I think matters most, not by what's easiest.

## 1. Ask the patient what they're actually taking

Photon only knows the medications someone told it about. It can't see what another
prescriber wrote or what someone bought off a shelf — so for interaction screening,
**the patient is the only reliable source, and nobody asks them.**

One extra line on a message they're already getting:

> "Before we renew — started anything new since May? New prescriptions, or anything
> over the counter?"

The reply is free text (*"just zyrtec and some magnesium"*), which the model turns into
structured entries → `updatePatient` → re-run Photon's own `prescriptionScreen` → the
recommendation updates. Every step is a call the machine token is permitted to make.

It also makes the recommendation honest. Today it can say "no interactions" off a
medication list that may be a year stale. After this it can say "no interactions, and
she confirmed her list on September 20" — and the physician can see which one they're
getting.

**Guardrails:** don't ask every refill (fatigue trains people to ignore it); never let
silence block a renewal — it still reaches the physician, labelled *med list not
confirmed*; and it supplements the record, never replaces it.

## 2. Actually call `prescriptionScreen`, and re-screen over time

Photon runs drug–drug and drug–allergy screening when a prescription is written. Nothing
ever runs it again. A patient stable on one medication picks up something new from a
different prescriber, and the interaction now exists with nobody watching for it.

Same shape as everything else here: the check is an event, when it should be a standing
property.

Today this tool does not call `prescriptionScreen` at all — the recommendation says so
explicitly rather than implying a clean screen it never ran. Wiring it means drafting the
renewal against `clinical-api` (the query takes `draftedPrescriptions` + `patientId`), which
is the right shape but a second domain and a second call per flag.

## 3. Vacation coverage for a clinician

Before a prescriber goes on leave, list every patient who needs a refill or dose change
during the window, draft each prescription, and hand the covering physician a prepared queue.

This is the runway calculation and the renewal prefill composed — filter one to a date range,
run the other over the result. No new machinery, and it removes a failure that is invisible
by construction: a patient whose supply ends mid-absence is unknown to their own doctor, who
is away, and to the covering doctor, who has never heard of them.

The coordinator version of this is harder and I would not start there — see `DESIGN.md`
feature 8.

## 4. Let people create an item by hand

Everything on the board is computed from Photon. But patients say things the data cannot
know — *"I'm moving to Denver"*, *"the cream is burning"*, *"I lost my EpiPen"* — and there
is nowhere to put that today.

Dana and the prescribers should both be able to open an item: pick the patient, write what
happened, mark whether it needs a signature. It joins the same three queues.

This is what stops it being a read-only report, and it is the landing place for inbound
replies once those exist.

## 5. Real inbound replies

Right now outreach is one-directional. Patients answer in sentences — *"the pharmacy said
they never got it"*, *"I moved to Denver"*, *"it's $340, I can't do that"* — and each of
those maps to a Photon operation (`routeOrder`, `updatePatient`, read `Coverage` and offer
an alternative). Needs an SMS provider; Photon only texts for pharmacy selection.

## 6. Infer supply when `daysSupply` is missing

`Prescription.daysSupply` is nullable, and for a topical it's close to meaningless anyway.
Working out how long a 30 g tube lasts means reading the sig — *"apply a thin layer to
affected areas twice daily"* — against the quantity and the body area. A rule can't do it;
a model can estimate it and say how confident it is.

## 7. Embed Photon instead of deep-linking

Today the sign button opens `app.neutron.health`. In production it's
`<photon-prescribe-workflow>` inside the clinic's own app — same flow, no context switch,
and the physician still signs inside Photon's authorized component. Deliberately skipped:
the auth plumbing wasn't where the risk or the interesting part was.

## 8. Replace the local overlay

Everything in `data/overlay.json` exists because Photon can't express it. Most of it
should come from Photon or the EHR:

| Held locally | Where it belongs |
|---|---|
| Fill dates, pickup state | Photon — the sandbox never advances a fill |
| Refills actually left | Photon — `fillsRemaining` doesn't mean this (see README) |
| Device expiry | Photon — computable from dispense date |
| Renewal policy | Photon — there's no field for it |
| Appointments, labs | The EHR |
