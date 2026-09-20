/**
 * Builds data/overlay.json from whatever is actually in Photon right now.
 *
 * Photon's sandbox can't produce fill history, appointments, device expiry, a
 * renewal policy, or a visit date, so those are assigned here — matched by drug
 * name, so the demo reads the same no matter what order Photon returns things
 * in, and stays correct if the prescriptions are re-created.
 *
 * Run: npm run seed
 */

import { gql } from "../src/lib/photon.ts";
import { saveOverlay, addDays, iso, type Overlay, type RxOverlay } from "../src/lib/overlay.ts";

const QUERY = `
  query { patients { id name { full }
    prescriptions { id daysSupply treatment { name } fills { id state } } } }
`;

type Rx = { id: string; daysSupply: number | null; treatment: { name: string } };
type Patient = { id: string; name: { full: string }; prescriptions: Rx[] };

const today = new Date();

type Scenario = {
  /** Matched case-insensitively against the drug name. */
  match: RegExp;
  label: string;
  appointmentInDays: number | null;
  rx: (daysSupply: number) => RxOverlay;
};

const SCENARIOS: Scenario[] = [
  {
    match: /epinephrine|epipen|auvi|symjepi/i,
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
    match: /clobetasol/i,
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
    match: /triamcinolone/i,
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
    match: /levocetirizine|cetirizine|hydroxyzine|montelukast/i,
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
    match: /dupixent|dupilumab/i,
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
  match: /.^/,
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
    const scenario = SCENARIOS.find((s) => s.match.test(rx.treatment.name)) ?? HEALTHY;
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
