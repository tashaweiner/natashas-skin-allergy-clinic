/**
 * Builds data/overlay.json from whatever is actually in Photon right now.
 *
 * Photon's sandbox can't produce fill history, appointments, device expiry, a
 * renewal policy, or a visit date, so those are assigned here.
 *
 * Scenarios are keyed to the six demo patients by their externalId, not by drug
 * name. That way the panel can grow, prescriptions can be edited, and other
 * patients can come and go without the demo changing underneath you — everyone
 * outside the six is simply read and found fine, which is what most of a real
 * panel looks like anyway.
 *
 * Run: npm run seed
 */

import { gql } from "../src/lib/photon.ts";
import { saveOverlay, addDays, iso, type Overlay, type RxOverlay } from "../src/lib/overlay.ts";

const QUERY = `
  query { patients(first: 100) { id externalId name { full }
    prescriptions { id daysSupply treatment { name } fills { id state } } } }
`;

type Rx = { id: string; daysSupply: number | null; treatment: { name: string } };
type Patient = {
  id: string;
  externalId: string | null;
  name: { full: string };
  prescriptions: Rx[];
};

const today = new Date();

type Scenario = {
  /** externalId of the demo patient this scenario belongs to. */
  patient: string;
  label: string;
  appointmentInDays: number | null;
  rx: (daysSupply: number) => RxOverlay;
};

const SCENARIOS: Scenario[] = [
  {
    patient: "nas-001",
    label: "device expiring · renewable without a visit → Dr. Reyes",
    appointmentInDays: null,
    rx: () => ({
      filledAt: iso(addDays(today, -334)),
      renewableWithoutVisit: true,
      deviceExpiresAt: iso(addDays(today, 31)),
      lastSeen: iso(addDays(today, -426)),
      refillsLeft: 0,
    }),
  },
  {
    patient: "nas-005",
    label: "running out · no refills, no visit booked → Dr. Reyes",
    appointmentInDays: null,
    rx: (ds) => ({
      filledAt: iso(addDays(today, -(ds - 5))),
      renewableWithoutVisit: true,
      refillsLeft: 0,
      lastSeen: iso(addDays(today, -122)),
    }),
  },
  {
    patient: "nas-002",
    label: "supply ran short · refilled far too early → Dr. Reyes",
    appointmentInDays: 60,
    rx: (ds) => ({
      filledAt: iso(addDays(today, -3)),
      previousFilledAt: iso(addDays(today, -3 - Math.round(ds * 0.35))),
      renewableWithoutVisit: false,
      lastSeen: iso(addDays(today, -47)),
    }),
  },
  {
    patient: "nas-003",
    label: "stranded at the pharmacy → Dana",
    appointmentInDays: 40,
    rx: (ds) => ({
      filledAt: iso(addDays(today, -Math.min(9, ds))),
      renewableWithoutVisit: true,
      readySince: iso(addDays(today, -9)),
      lastSeen: iso(addDays(today, -63)),
    }),
  },
  {
    patient: "nas-006",
    label: "running out · renewal needs a visit first → Dana books",
    appointmentInDays: null,
    rx: (ds) => ({
      filledAt: iso(addDays(today, -(ds - 8))),
      renewableWithoutVisit: false,
      refillsLeft: 0,
      lastSeen: iso(addDays(today, -398)),
    }),
  },
  {
    patient: "nas-004",
    label: "prior auth submitted, awaiting a decision → Waiting",
    appointmentInDays: 21,
    rx: () => ({
      filledAt: null,
      renewableWithoutVisit: false,
      coverage: "PA_REQUIRED",
      coverageMessage:
        "Step therapy requirements apply. Documented trial of a topical corticosteroid is required.",
      waitingOn: "a prior authorisation decision",
      lastSeen: iso(addDays(today, -88)),
    }),
  },
];

/** Everyone else has plenty of supply and a visit on the books. */
const HEALTHY: Scenario = {
  patient: "",
  label: "healthy · nothing needed",
  appointmentInDays: 45,
  rx: (ds) => ({
    filledAt: iso(addDays(today, -Math.round(ds * 0.2))),
    renewableWithoutVisit: true,
    lastSeen: iso(addDays(today, -30)),
  }),
};

const data = await gql<{ patients: Patient[] }>("api", QUERY);
const overlay: Overlay = { appointments: {}, prescriptions: {} };

for (const patient of data.patients) {
  for (const rx of patient.prescriptions ?? []) {
    const scenario = SCENARIOS.find((s) => s.patient === patient.externalId) ?? HEALTHY;
    overlay.prescriptions[rx.id] = scenario.rx(rx.daysSupply ?? 30);
    overlay.appointments[patient.id] =
      scenario.appointmentInDays === null ? null : iso(addDays(today, scenario.appointmentInDays));

    console.log(
      `${patient.name.full.padEnd(18)} ${rx.treatment.name.slice(0, 42).padEnd(44)} ${scenario.label}`
    );
  }
}

await saveOverlay(overlay);
console.log(`\nWrote data/overlay.json — ${Object.keys(overlay.prescriptions).length} prescriptions.`);
