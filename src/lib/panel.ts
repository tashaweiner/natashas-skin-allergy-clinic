/**
 * The watcher. Reads the panel from Photon, joins the local overlay, and
 * computes flags. No AI in here on purpose — these are rules, and rules are
 * cheaper, auditable, and safer than asking a model to do arithmetic.
 */

import { gql } from "./photon.ts";
import { loadOverlay, daysBetween, type RxOverlay } from "./overlay.ts";

const PANEL_QUERY = `
  query Panel {
    patients {
      id
      name { full }
      phone
      allergies { allergen { name } }
      allergyStatus
      medicationHistory { active comment
        medication { name controlled schedule }
        substance { name }
        prescription { treatment { name } } }
      prescriptions {
        id
        state
        daysSupply
        dispenseQuantity
        dispenseUnit
        instructions
        fillsAllowed
        fillsRemaining
        writtenAt
        expirationDate
        treatment { id name }
        fills { id state filledAt requestedAt }
      }
    }
  }
`;

export type FlagKind =
  | "DEVICE_EXPIRING"
  | "RUNNING_OUT"
  | "STRANDED"
  | "BLOCKED"
  | "SHORT_SUPPLY";

export type Queue = "dana" | "waiting" | "physician";

export type Flag = {
  kind: FlagKind;
  /** Which of the three columns this belongs in. */
  queue: Queue;
  patientId: string;
  patientName: string;
  phone: string | null;
  prescriptionId: string;
  medication: string;
  /** Plain-language reason. Shown to Dana; also fed to the drafter. */
  reason: string;
  /** Days until the bad thing happens. Negative means it already has. */
  daysUntil: number;
  refillsLeft: number;
  renewableWithoutVisit: boolean;
  nextAppointment: string | null;
  /** Lower sorts first. */
  urgency: number;

  // Context for the recommendation. Language, not numbers.
  sig?: string;
  allergies?: string[];
  medicationHistory?: string[];
  screenAlerts?: string[];
  coverageMessage?: string;
  lastSeen?: string;
  /** Set when the item is parked: "labs", "prior authorisation", "a reply". */
  waitingOn?: string;
};

type PhotonFill = { id: string; state: string; filledAt: string | null; requestedAt: string };
type PhotonRx = {
  id: string;
  state: string;
  daysSupply: number | null;
  dispenseQuantity: number;
  dispenseUnit: string;
  instructions: string;
  fillsAllowed: number;
  fillsRemaining: number;
  writtenAt: string;
  expirationDate: string;
  treatment: { id: string; name: string };
  fills: PhotonFill[];
};
type PhotonPatient = {
  id: string;
  name: { full: string };
  phone: string | null;
  allergies: { allergen: { name: string } }[] | null;
  allergyStatus: string | null;
  medicationHistory:
    | {
        active: boolean;
        comment: string | null;
        medication: { name: string; controlled: boolean; schedule: string | null } | null;
        substance: { name: string } | null;
        prescription: { treatment: { name: string } } | null;
      }[]
    | null;
  prescriptions: PhotonRx[];
};

/**
 * Which column an item lands in.
 *
 * Only a physician can sign, so anything needing a signature goes to them and
 * everything else is Dana's. Parked items go nowhere until their watcher fires.
 */
function queueFor(kind: FlagKind, renewableWithoutVisit: boolean, waitingOn?: string): Queue {
  if (waitingOn) return "waiting";
  switch (kind) {
    case "DEVICE_EXPIRING":
    case "RUNNING_OUT":
      // Renewable without a visit means a signature is all that's missing.
      // Otherwise it's an appointment, which is Dana's to book.
      return renewableWithoutVisit ? "physician" : "dana";
    case "SHORT_SUPPLY":
      // The quantity may be wrong, which is a prescribing judgement.
      return "physician";
    case "STRANDED":
    case "BLOCKED":
      // Pure logistics. A patient should never be asked to handle either.
      return "dana";
  }
}

/**
 * How many refills the patient can still collect.
 *
 * NOT `fillsRemaining`. Photon pre-creates every fill object the moment an
 * order is placed and drops fillsRemaining straight to 0 — we saw a
 * prescription with fillsAllowed 3, three untouched fills, and fillsRemaining
 * 0. The field counts fills not yet instantiated, not refills the patient has
 * left. Counting fills still in NEW is the honest number.
 */
export function refillsLeft(rx: PhotonRx): number {
  return rx.fills.filter((f) => f.state === "NEW").length;
}

/** The date this person runs out. The number the whole product exists to surface. */
export function runsOutOn(rx: PhotonRx, ov: RxOverlay | undefined): Date | null {
  const filled = ov?.filledAt ?? rx.fills.find((f) => f.filledAt)?.filledAt ?? null;
  if (!filled || !rx.daysSupply) return null;
  const d = new Date(filled);
  return new Date(d.getTime() + rx.daysSupply * 86_400_000);
}

export async function getFlags(today = new Date()): Promise<Flag[]> {
  const overlay = await loadOverlay();
  const data = await gql<{ patients: PhotonPatient[] }>("api", PANEL_QUERY);

  const flags: Omit<Flag, "queue">[] = [];

  for (const patient of data.patients) {
    const nextAppointment = overlay.appointments[patient.id] ?? null;

    for (const rx of patient.prescriptions ?? []) {
      const ov = overlay.prescriptions[rx.id];
      const refills = ov?.refillsLeft ?? refillsLeft(rx);
      const base = {
        patientId: patient.id,
        patientName: patient.name.full,
        phone: patient.phone,
        prescriptionId: rx.id,
        medication: rx.treatment.name,
        refillsLeft: refills,
        renewableWithoutVisit: ov?.renewableWithoutVisit ?? false,
        nextAppointment,
        sig: rx.instructions,
        allergies: (patient.allergies ?? []).map((a) => a.allergen.name),
        medicationHistory: (patient.medicationHistory ?? [])
          .filter((m) => m.active)
          .map(
            (m) =>
              m.medication?.name ?? m.prescription?.treatment.name ?? m.substance?.name ?? null
          )
          .filter((n): n is string => Boolean(n)),
        coverageMessage: ov?.coverageMessage,
        lastSeen: ov?.lastSeen,
        waitingOn: ov?.waitingOn,
      };

      // 1. A device quietly expiring. Nobody checks these, including the patient.
      if (ov?.deviceExpiresAt) {
        const days = daysBetween(today, new Date(ov.deviceExpiresAt));
        if (days <= 45) {
          flags.push({
            ...base,
            kind: "DEVICE_EXPIRING",
            daysUntil: days,
            urgency: days < 0 ? 0 : 1,
            reason:
              days < 0
                ? `Expired ${Math.abs(days)} days ago and has not been replaced.`
                : `Expires in ${days} days.`,
          });
        }
      }

      // 2. Running out of supply with nothing left to collect.
      const out = runsOutOn(rx, ov);
      if (out && refills === 0) {
        const days = daysBetween(today, out);
        if (days <= 14) {
          const apptCovers =
            nextAppointment !== null && new Date(nextAppointment) <= out;
          if (!apptCovers) {
            flags.push({
              ...base,
              kind: "RUNNING_OUT",
              daysUntil: days,
              urgency: days < 0 ? 0 : 2,
              reason:
                days < 0
                  ? `Ran out ${Math.abs(days)} days ago. No refills left.`
                  : `Runs out in ${days} days with no refills left${
                      nextAppointment
                        ? ` — next visit is ${nextAppointment}, which is after that.`
                        : " and no visit scheduled."
                    }`,
            });
          }
        }
      }

      // 3. Filled and sitting at the pharmacy, never collected.
      if (ov?.readySince) {
        const waiting = daysBetween(new Date(ov.readySince), today);
        if (waiting >= 7) {
          flags.push({
            ...base,
            kind: "STRANDED",
            daysUntil: -waiting,
            urgency: 3,
            reason: `Ready at the pharmacy for ${waiting} days and never picked up.`,
          });
        }
      }

      // 4. Coverage blocked it. Clinic handles this; the patient never sees it.
      if (ov?.coverage === "PA_REQUIRED" || ov?.coverage === "NOT_COVERED") {
        flags.push({
          ...base,
          kind: "BLOCKED",
          daysUntil: 0,
          urgency: 2,
          reason:
            ov.coverage === "PA_REQUIRED"
              ? "Insurance requires a prior authorization before this can be filled."
              : "Insurance will not cover this. Alternatives may be available.",
        });
      }

      // 5. Refilled far sooner than the days supply allows. For a topical this
      //    usually means a flare, and the quantity may simply be wrong.
      if (ov?.previousFilledAt && ov?.filledAt && rx.daysSupply) {
        const gap = daysBetween(new Date(ov.previousFilledAt), new Date(ov.filledAt));
        if (gap > 0 && gap < rx.daysSupply * 0.6) {
          flags.push({
            ...base,
            kind: "SHORT_SUPPLY",
            daysUntil: 0,
            urgency: 4,
            reason: `Prescribed for ${rx.daysSupply} days but refilled after ${gap}. The quantity may be too small.`,
          });
        }
      }
    }
  }

  return flags
    .map((f) => ({
      ...f,
      queue: queueFor(f.kind, f.renewableWithoutVisit, f.waitingOn),
    }))
    .sort((a, b) => a.urgency - b.urgency || a.daysUntil - b.daysUntil);
}
