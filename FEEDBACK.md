# Product feedback for Photon

Everything here was found by building against the sandbox, not by reading marketing.
Each item says how it showed up.

---

## Traps — things that will bite someone

### 1. `fillsRemaining` does not mean refills remaining

The single most expensive thing I found.

```
fillsAllowed:    3
fills:           3 objects, all state NEW
fillsRemaining:  0
```

Photon appears to instantiate every fill when the order is placed and drop the counter
to zero. So `fillsRemaining` counts fills **not yet created**, not refills the patient can
still collect. Anyone building a refill, adherence, or renewal product will read that
field name, trust it, and be exactly backwards. I ended up counting fills still in `NEW`.

Either rename it, or document it loudly. Right now there is no description on the field
at all (see #4).

### 2. `PatientMedication` has three shapes for one concept

A medication in a patient's history arrives as `medication`, or `substance`, or
`prescription.treatment` — and there is no `treatment` field, which is the obvious guess
and returns a validation error. Nothing in the docs mentions this, so the only way to
learn it is to have a query fail.

### 3. The two API domains aren't documented

The Clinical API page lists `api.neutron.health/graphql` and
`clinical-api.neutron.health/graphql` and says functionality is "split across two
domains" — but never which. In practice `prescriptions`, `prescription`, and `fill` exist
only on `api`; `clinical-api` has no prescription query at all. That's a coin flip for a
new integrator, and the sandbox playground link points at the domain that doesn't have
them.

### 4. No field descriptions anywhere in the schema

Introspection returns `null` for the description of every field I checked. For an
API-first product this is the cheapest possible documentation win — `fillsRemaining`
and `doNotFillBeforeDate` alone would have saved me an hour.

---

## Gaps — things the data model can't express

### 5. There is no concept of "about to run out"

The closest event is `photon:prescription:expired`, which fires a year out and means
nothing clinically. The date that actually matters is fill date plus days supply. Every
ingredient is in the API — `filledAt`, `daysSupply`, `fillsAllowed`, fill state — and
nothing computes it, surfaces it, or emits it.

This is the entire premise of what I built. You already have the data; nobody has made it
a number.

### 6. `daysSupply` is nullable, and meaningless for topicals

For a 30 g tube of clobetasol with "apply a thin layer to affected areas twice daily,"
days supply is a guess. Fine — but when it's null there's no fallback, so any
supply-based product silently drops those prescriptions.

### 7. The clinic can't see what the patient sees

The patient-facing marketplace shows live pharmacy stock and a cash price — I watched it
quote $40.31 against a $289.24 retail price. The clinical API exposes neither. `Pharmacy`
returns id, name, npi, address, fax, phone, fulfillment types, distance, lat/long — no
inventory, no hours, no price. The only price anywhere is `Coverage.price`.

So a clinic can't tell a patient "your usual pharmacy has it," and can't build anything
around cost, even though Photon knows both.

### 8. No concept of a visit

Photon can't answer "will this prescription last until I see them again," because it has
no idea when that is. Reasonable — that's EHR territory — but it means every supply
product needs a second data source for the most basic question it asks.

### 9. Nowhere to record whether a renewal needs a visit

This is the field I most wanted and couldn't find. A physician knows, at the moment they
write a prescription, whether it can be renewed once without seeing the patient. That
judgment is worth capturing and is currently retrieved by phone call. `Prescription` has
`notes` and nothing else.

### 10. A `DRAFT` can't say why it's parked

`DRAFT` is a good primitive — the MCP's `rx_draft` even runs screening before anything is
sent. But a draft blocked on labs, a prior auth, or a patient reply looks identical to one
someone abandoned. A `blockedOn` reason would make the draft queue manageable instead of a
pile.

### 11. Screening is an event, not a standing property

`prescriptionScreen` runs drug–drug and drug–allergy checks when a prescription is
written, and never again. A patient stable on one medication picks up something new from
a different prescriber and the interaction now exists with nothing watching for it.

---

## Sandbox

### 12. The sandbox can't produce fill history

Every fill stays `state: NEW` with `filledAt: null`, and orders sit in `ROUTING` with a
null pharmacy forever, because no real patient is picking one. That's understandable, but
it means **no adherence, supply, or follow-through product can be built or tested against
the sandbox at all.** I had to simulate fill dates locally.

A way to advance an order — a test hook, a "simulate pickup" button, anything — would
unblock a whole category of integration.

### 13. No `deletePatient`

There's no way to clean up test data. I created one patient while probing permissions and
it's now permanently in my sandbox org.

### 14. The MCP server can't read

`rx_intake`, `rx_search`, `rx_draft`, `rx_send` — all four are write-path. There's no tool
to list patients, query prescriptions, or look at fills. So an agent connected to Photon
can **act** but can't **answer a question about a panel**, which means it can only ever do
what a human already told it to do.

That's the difference between an agent and a remote control, and it's the gap my product
sits in.

### 15. Docs point at a settings page that isn't in the nav

The authentication guide says the machine token is at `app.photon.health/settings`. The
sandbox app's nav has three items — Prescriptions, Patients, Orders — and no settings
link; it's behind the avatar menu.

---

## Controlled substances

### 16. Supported in the schema, absent from the docs

I searched all 21 documentation pages. Zero mentions of EPCS, DEA, "controlled,"
"Schedule II," PDMP, or two-factor identity proofing. The word "schedule" does not appear
in the prose documentation in any context.

But the API clearly supports them: `TreatmentOption.schedule`, `Medication.controlled`,
`Medication.schedule`, and `Prescription.doNotFillBeforeDate` — a field that only exists
for sequential Schedule II prescriptions. `doNotFillBeforeDate` does appear in the
Elements docs, three times, all as a bare TypeScript field with no explanation of what
it's for.

For a mental health or pain clinic evaluating Photon, "can you do stimulants" is the first
question, and the documentation doesn't answer it. Separately, since the 2023 DEA rule a
Schedule II e-prescription can only be transferred pharmacist-to-pharmacist, once, at the
patient's request — which means the patient-reroute flow, Photon's best feature, probably
can't work the same way there. That's worth saying explicitly either way.

---

## What's right, and worth keeping

- **`write:prescription` is withheld from machine tokens.** I confirmed it:
  `createPrescription → MISSING_PERMISSIONS: write:prescription`. The most important
  safety property of anything built on Photon is enforced by the platform rather than by
  the integrator's good intentions. That is exactly the right call, and it made my
  architecture decision for me.
- **The MCP's review digest.** Requiring `reviewDigest` and `reviewedFields` copied
  verbatim into `rx_send`, verified server-side, pins the human's signature to precisely
  what was reviewed. That's a genuinely good answer to the hardest problem in agentic
  prescribing.
- **`rx_intake` fails closed on an ambiguous patient match** rather than guessing.
- **Handing pharmacy choice to the patient** is the right idea and visibly better than
  what it replaces.

---

*Added while wiring a real write:*

### 17. `routeOrder` returns the order as it was before the change

The mutation succeeds and returns `state: ROUTING`, `pharmacy: null` — the pre-update
order. Read the order again a moment later and it's `PENDING` with the pharmacy set. A
client that trusts the mutation response concludes nothing happened.

Related: that follow-up read is eventually consistent. Reading immediately still returns
the old state; it takes a second or two to settle. Worth documenting, since the obvious
implementation — mutate, re-read, show the user — is wrong twice over.

### 18. `routeOrder` requires an address, and says so only at route time

`createPatient` accepts a patient with no address quite happily. The failure surfaces much
later, as `INVALID_ORDER: Patient does not have an address on file`, at the point of
routing. The error message is excellent — it's the timing that's awkward. Either require
it at creation, or note it in the sync-patients guide.

### 19. There is no patient-facing link anywhere in the API

Photon texts patients a `sl.neutron.health/…` link where they choose a pharmacy, compare
prices, and track the order. That link is the best thing about the product from a patient's
side — I watched it quote $40.31 against a $289.24 retail price.

The API exposes no way to get it. I searched every type in the schema for a url, link, or
token field: the only hits are `Invite.url`, `WebhookConfig.url`, `Client.whiteListedUrls`
and `Verification.verifyUrl`. Nothing on `Order` or `Fill`.

So a clinic reaching out to a patient about their own prescription cannot send them to their
own order. Every message has to route the reply back through the clinic instead, which is
more work for the staff and a worse experience for the patient than the thing Photon already
built.

### 20. `createPrescriptionTemplate` is allowed where `createPrescription` is not

Noting this as a compliment. A machine token can pre-draft a prescription as a template and
the prescribe deep link accepts `templateIds` — so an integrator can hand a physician a
filled-in form without anything being signed. That is exactly the right line, and it is what
made the safety story of my product easy.

It is not documented as a prefill path anywhere. It reads as a template-management feature,
and the deep-link parameter is one row in a table in the integration guide. Worth surfacing —
it is the cleanest answer to "how do I prepare work for a prescriber without overstepping."
