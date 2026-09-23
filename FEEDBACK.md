# Notes for the Photon team

Seven things I ran into building this, roughly in the order they cost me time. I'm sure
there's context I don't have on some of these — flagging them as a first-time integrator,
not telling you how to run your platform.

---

## 1. `fillsRemaining` doesn't mean what I assumed

This is the one that would have quietly broken my product.

A prescription came back with `fillsAllowed: 3`, three fill objects all in state `NEW`, and
`fillsRemaining: 0`. I read that as "no refills left" and built on it — which is backwards,
because the patient had three refills waiting. It looks like every fill is created up front
and the counter drops to zero at that point.

I ended up counting fills still in `NEW` instead, which seems to be the real number.

If that's intended, it probably just needs a line of documentation. There's no description
on the field, so the name is all you have to go on, and anyone building something
refill-related will read it the way I did.

## 2. Nothing tells you a patient is about to run out

This is the gap my whole project sits in, so I'm biased — but you have `filledAt`, you have
`daysSupply`, and nothing multiplies them.

The closest event is `photon:prescription:expired`, which fires a year out and doesn't mean
much clinically. The date that matters to a clinic is when the person runs out of pills, and
there's no field, event, or screen for it.

I genuinely don't know whether that's deliberately out of scope — it's arguably the EHR's
job. But you're the only system that knows when a prescription was actually *filled*, so
you're the only one who can compute it.

## 3. The sandbox can't produce fill history

Every fill comes back `state: NEW` with `filledAt: null`, and orders sit in `ROUTING`
forever because there's no real patient choosing a pharmacy. That makes sense as a default.

The consequence was that I couldn't test the behaviour my product depends on. I simulated
fill dates locally and noted it everywhere. Anything involving adherence, supply, or
follow-through hits the same wall.

Some way to advance an order in sandbox — a test hook, a "pretend this was picked up"
button — would unblock a whole category of integration.

## 4. The clinic can't see what the patient sees

I sent myself a test prescription and the patient page showed a $40.31 coupon price against
$289.24 retail, plus pharmacy options and stock. It's the best part of the product from the
patient's side.

None of it is in the clinical API. `Pharmacy` gives name, address, distance, phone — no
inventory, no hours, no price. The only price anywhere is `Coverage.price`.

So a clinic can't tell a patient "your usual pharmacy has it in stock," or help with cost,
even though you know both. I'd guess pricing data is contractual and that's the reason — but
from the clinic's side it's a strange asymmetry.

## 5. `patients` silently returns 10 of them

This one actually bit me. I built the dashboard, it looked right, and it was reading ten
patients out of nineteen. No error, no flag, no `hasMore` — the list just ends and looks
complete.

`patients` takes `first` and `after`, so pagination is there. It's the default that's the
problem: for a query like this, a silent cap is indistinguishable from "that's everyone,"
and I only caught it because I happened to count.

For anything doing population work — adherence, recall, outreach, a safety net of any kind —
missing a patient is the failure that matters, and this fails in the direction where the
screen still looks confident. Even a `totalCount` would have told me.

## 6. The MCP server can write but can't read

`rx_intake`, `rx_search`, `rx_draft`, `rx_send` are all write-path. There's no tool to list
patients, query prescriptions, or look at fills.

So an agent connected to Photon can *act*, but can't answer a question about a panel — it
can only do what a human already told it to do. That makes it a very good remote control
and not quite an assistant. Given where the MCP beta seems to be heading, a couple of read
tools would change what people can build on it.

## 7. The schema looks like it supports controlled substances

`Medication.controlled`, `Medication.schedule`, and `Prescription.doNotFillBeforeDate` are
all there, and `doNotFillBeforeDate` is textbook Schedule II. I spent an afternoon reasoning
about C-II workflows off those fields before emailing to ask, and Charles told me they're
not supported yet.

No complaint about the roadmap — just that the schema implies a capability that doesn't
exist, and asking someone is the only way to find out. One line in the getting-started guide
would save every psych or pain clinic the same question during evaluation.

---

## Smaller things

- `routeOrder` returns the order as it was *before* the change — my UI reported "nothing
  happened" after a call that worked. Re-reading a second later shows the new state.
- `routeOrder` needs the patient to have an address, but `createPatient` accepts one without
  it. Clear error, just arrives long after the mistake.
- The two API domains aren't documented — prescriptions only exist on `api`, not
  `clinical-api`. Found by trial and error.
- `PatientMedication` has no `treatment` field; it's `medication`, `substance`, or
  `prescription.treatment` depending on where it came from.
- No field descriptions anywhere in the schema.
- No way to delete a test patient, so my sandbox has a "Probe Writetest" in it forever.

---

## What I'd keep exactly as it is

**A machine token can't write a prescription.** `createPrescription` refused me with
`MISSING_PERMISSIONS: write:prescription`, while `createPrescriptionTemplate` and
`routeOrder` went through.

That one decision made my whole design. I never had to argue with myself about what an AI
should be allowed to do — the line was already drawn, in the right place, and enforced.
Every safety claim I make about this project rests on your permission model rather than on
my own good intentions, which is where it belongs.

The `rx_draft` → `rx_send` review digest is the same instinct, and it's a good answer to the
hardest problem in agentic prescribing.
