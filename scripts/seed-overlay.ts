/**
 * Stands in for the fill history Photon's sandbox cannot produce.
 *
 * Every fill in the sandbox comes back `state: NEW` with `filledAt: null`, and
 * orders sit in ROUTING forever because no real patient ever picks a pharmacy.
 * Photon also has no concept of an appointment, a device expiry, or whether a
 * renewal needs a visit. Without those, none of the five rules can fire.
 *
 * So this invents the missing history — for EVERY patient, on the same terms.
 * No patient is singled out and no scenario is assigned. Each value is derived
 * deterministically from the prescription's own id and from real drug
 * attributes, so the same panel produces the same history every run, and
 * whoever trips a rule trips it on the merits.
 *
 * In production none of this exists: Photon supplies the fills, the EHR
 * supplies the visits, and the prescriber records the renewal policy.
 *
 * Run: npm run seed
 */

import { gql } from "../src/lib/photon.ts";
import { saveOverlay, addDays, iso, type Overlay, type RxOverlay } from "../src/lib/overlay.ts";

const QUERY = `
  query { patients(first: 100) { id name { full }
    prescriptions {
      id daysSupply fillsAllowed writtenAt
      treatment { id name }
      fills { id state }
    } } }
`;

type Rx = {
  id: string;
  daysSupply: number | null;
  fillsAllowed: number;
  writtenAt: string;
  treatment: { id: string; name: string };
};
type Patient = { id: string; name: { full: string }; prescriptions: Rx[] };

const today = new Date();

/** Stable 0–999 from any id, so a run is reproducible. */
function dial(seed: string, salt: string): number {
  let h = 2166136261;
  for (const c of seed + salt) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 1000;
}

// Real drug attributes, not per-patient decisions.
const isAutoInjector = (n: string) => /auto-?injector|epinephrine|epipen|auvi|symjepi/i.test(n);
const isBiologic = (n: string) => /dupixent|dupilumab|mab\b|nucala|xolair|fasenra/i.test(n);
const isTopical = (n: string) => /cream|ointment|lotion|gel|topical/i.test(n);

function historyFor(rx: Rx, patientId: string): RxOverlay {
  const ds = rx.daysSupply ?? 30;
  const written = new Date(rx.writtenAt);

  // A biologic that needs prior authorisation never gets filled at all.
  if (isBiologic(rx.treatment.name) && dial(rx.id, "pa") < 850) {
    return {
      filledAt: null,
      renewableWithoutVisit: false,
      coverage: "PA_REQUIRED",
      coverageMessage:
        "Step therapy requirements apply. Documented trial of a topical corticosteroid is required.",
      waitingOn: dial(rx.id, "sub") < 500 ? "a prior authorisation decision" : undefined,
      lastSeen: iso(addDays(today, -(60 + (dial(patientId, "seen") % 240)))),
    };
  }

  // How long ago it was collected — spread across the supply period so some
  // people are early in a cycle and some are at the end of one.
  const age = Math.round((dial(rx.id, "age") / 1000) * ds * 1.4);
  const filledAt = addDays(today, -Math.min(age, 360));

  const collected = dial(rx.id, "pickup") > 130; // most people do collect
  const lastSeen = iso(addDays(today, -(20 + (dial(patientId, "seen") % 400))));

  return {
    filledAt: iso(filledAt),
    // Maintenance medication is usually fine to renew once; devices and
    // topicals that need review are not.
    renewableWithoutVisit: !isTopical(rx.treatment.name) || dial(rx.id, "policy") > 400,
    refillsLeft: Math.max(0, rx.fillsAllowed - Math.floor(age / Math.max(ds, 1))),
    // Auto-injectors carry an expiry about a year from dispense. That is a
    // property of the device, not a choice about this patient.
    deviceExpiresAt: isAutoInjector(rx.treatment.name)
      ? iso(addDays(filledAt, 365))
      : undefined,
    // Left at the pharmacy and never collected.
    readySince: collected ? undefined : iso(filledAt),
    // A topical refilled far too early — a flare burned through it.
    previousFilledAt:
      isTopical(rx.treatment.name) && dial(rx.id, "flare") < 220
        ? iso(addDays(filledAt, -Math.round(ds * 0.35)))
        : undefined,
    lastSeen,
  };
}

const data = await gql<{ patients: Patient[] }>("api", QUERY);
const overlay: Overlay = { appointments: {}, prescriptions: {} };

for (const patient of data.patients) {
  // Roughly two thirds of a panel has a visit on the books.
  const d = dial(patient.id, "appt");
  overlay.appointments[patient.id] = d < 330 ? null : iso(addDays(today, 7 + (d % 120)));

  for (const rx of patient.prescriptions ?? []) {
    overlay.prescriptions[rx.id] = historyFor(rx, patient.id);
  }
}

await saveOverlay(overlay);
console.log(
  `Wrote data/overlay.json — history for ${Object.keys(overlay.prescriptions).length} prescriptions ` +
    `across ${data.patients.length} patients. No patient treated specially.`
);
