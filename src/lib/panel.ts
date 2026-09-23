/**
 * Why this file exists: every prescription has a date it stops working — the day
 * it was filled plus its days supply. Photon stores both numbers and nothing
 * multiplies them, so no clinic knows a patient has run out until the patient
 * calls. This computes that date for the whole panel.
 *
 * The watcher. Reads the panel from Photon, joins the local overlay, and
 * computes flags. No AI in here on purpose — these are rules, and rules are
 * cheaper, auditable, and safer than asking a model to do arithmetic.
 */

import { gql } from "./photon.ts";
import { loadOverlay, daysBetween, type RxOverlay } from "./overlay.ts";

const PANEL_QUERY = `
  query Panel($first: Int!, $after: ID) {
    patients(first: $first, after: $after) {
      id
      name { full }
      phone
      email
      dateOfBirth
      address { street1 street2 city state postalCode }
      orders { id state pharmacy { id name } fills { prescription { id } } }
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

/**
 * One field that differs from the prescription this renews.
 *
 * `computed` means arithmetic — it is either right or it is a bug.
 * `suggested` means a judgement is involved, so it is shown as a question and
 * the physician answers it. Nothing here is ever applied automatically.
 */
export type Change = {
  field: string;
  from: string;
  to: string;
  reason: string;
  certainty: "computed" | "suggested";
};

/**
 * A renewal is a COPY of the previous prescription plus a highlighted diff.
 *
 * The fields are never generated. A model that paraphrases "apply a thin layer
 * to affected areas twice daily" into something looser is a dosing change that
 * reads as plausible — so the sig, the drug, and the unit are copied verbatim,
 * and only the fields that should change are surfaced, with a reason.
 */
export type Proposal = {
  /** The parts carried over untouched, for the physician to skim. */
  unchanged: string;
  changes: Change[];
  /** When the prescription being renewed was written. */
  writtenAt: string;
};

export type Flag = {
  kind: FlagKind;
  /** Which of the three columns this belongs in. */
  queue: Queue;
  patientId: string;
  patientName: string;
  phone: string | null;
  email?: string | null;
  dateOfBirth?: string;
  address?: string | null;
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
  /** Photon's own "no known allergies" vs "never asked" distinction. */
  allergyStatus?: string | null;
  coverageMessage?: string;
  lastSeen?: string;
  /** Set when the item is parked: "labs", "prior authorisation", "a reply". */
  waitingOn?: string;
  /** Only built for items reaching a physician. */
  proposal?: Proposal;
  /** The live order this prescription sits in, when there is one. */
  orderId?: string;
  orderState?: string;
  pharmacyName?: string;
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
  email: string | null;
  dateOfBirth: string;
  address: {
    street1: string;
    street2: string | null;
    city: string;
    state: string;
    postalCode: string;
  } | null;
  orders:
    | {
        id: string;
        state: string;
        pharmacy: { id: string; name: string } | null;
        fills: { prescription: { id: string } | null }[];
      }[]
    | null;
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
      // A tube gone in a third of its days supply has an ordinary explanation —
      // lost, a worse flare, a larger area than anyone assumed. Finding out is a
      // phone call. It only reaches a physician WITH the answer attached;
      // sending it up first makes them ask what Dana could have asked.
      return "dana";
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

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * How many refills it takes to reach the next visit.
 *
 * The habit is 90 days plus one refill, written without checking when the
 * patient is next seen. When that lands short, they run out and nobody knows.
 */
function buildProposal(
  rx: PhotonRx,
  kind: FlagKind,
  nextAppointment: string | null,
  today: Date
): Proposal {
  const ds = rx.daysSupply ?? 30;
  const changes: Change[] = [];

  if (nextAppointment) {
    const daysToCover = daysBetween(today, new Date(nextAppointment));
    const fillsNeeded = Math.max(1, Math.ceil(daysToCover / ds));
    const refillsNeeded = fillsNeeded - 1;
    if (refillsNeeded !== rx.fillsAllowed) {
      const gap = daysToCover - (rx.fillsAllowed + 1) * ds;
      changes.push({
        field: "Refills",
        from: String(rx.fillsAllowed),
        to: String(refillsNeeded),
        certainty: "computed",
        reason:
          gap > 0
            ? `Next visit is ${fmtDate(nextAppointment)}. At ${rx.fillsAllowed} refill${
                rx.fillsAllowed === 1 ? "" : "s"
              } they run out ${gap} days before it.`
            : `Next visit is ${fmtDate(nextAppointment)}. ${refillsNeeded} covers it without over-supplying.`,
      });
    }
  } else if (rx.fillsAllowed !== 1) {
    // Without a visit date there is nothing to size against, so bridge one
    // cycle and let the booking settle it. A no-op is not worth showing.
    changes.push({
      field: "Refills",
      from: String(rx.fillsAllowed),
      to: "1",
      certainty: "suggested",
      reason: `No visit scheduled. One refill bridges about ${ds * 2} days while one is booked.`,
    });
  }

  if (kind === "SHORT_SUPPLY") {
    changes.push({
      field: "Quantity",
      from: `${rx.dispenseQuantity} ${rx.dispenseUnit}`,
      to: `${rx.dispenseQuantity * 2} ${rx.dispenseUnit}?`,
      certainty: "suggested",
      reason: `The last ${rx.dispenseQuantity} ${rx.dispenseUnit} did not last the ${ds} days it was written for. The quantity may be too small — or the flare may need a different plan.`,
    });
  }

  return {
    unchanged: `${rx.treatment.name} · ${rx.dispenseQuantity} ${rx.dispenseUnit} · ${rx.daysSupply ?? "?"} days · "${rx.instructions}"`,
    changes,
    writtenAt: fmtDate(rx.writtenAt),
  };
}

/**
 * Every patient in the organisation.
 *
 * `patients` silently defaults to 10. Nothing in the schema or the docs says
 * so — you discover it by counting. For a product whose whole promise is that
 * it watches the entire panel, a quietly truncated list is the worst possible
 * failure: the patient who was about to run out is simply absent, and the
 * screen looks just as confident either way. So this pages to exhaustion.
 */
const PAGE = 100;

async function allPatients(): Promise<PhotonPatient[]> {
  const everyone: PhotonPatient[] = [];
  let after: string | undefined;

  for (let guard = 0; guard < 200; guard++) {
    const { patients } = await gql<{ patients: PhotonPatient[] }>("api", PANEL_QUERY, {
      first: PAGE,
      after,
    });
    everyone.push(...patients);
    if (patients.length < PAGE) return everyone;
    after = patients[patients.length - 1].id;
  }

  throw new Error("patient pagination did not terminate");
}

export type Panel = {
  flags: Flag[];
  /** How many patients were looked at. The denominator matters: "6 need
   *  something" means nothing without "out of 19". */
  patientsChecked: number;
};

export async function getFlags(today = new Date()): Promise<Panel> {
  const overlay = await loadOverlay();
  const data = { patients: await allPatients() };

  const flags: Omit<Flag, "queue">[] = [];
  const rxById = new Map<string, PhotonRx>();

  for (const patient of data.patients) {
    const nextAppointment = overlay.appointments[patient.id] ?? null;

    for (const rx of patient.prescriptions ?? []) {
      const ov = overlay.prescriptions[rx.id];
      rxById.set(rx.id, rx);
      const refills = ov?.refillsLeft ?? refillsLeft(rx);
      const base = {
        patientId: patient.id,
        patientName: patient.name.full,
        phone: patient.phone,
        email: patient.email,
        dateOfBirth: patient.dateOfBirth,
        address: patient.address
          ? [
              patient.address.street1,
              patient.address.street2,
              `${patient.address.city}, ${patient.address.state} ${patient.address.postalCode}`,
            ]
              .filter(Boolean)
              .join(", ")
          : null,
        prescriptionId: rx.id,
        medication: rx.treatment.name,
        refillsLeft: refills,
        renewableWithoutVisit: ov?.renewableWithoutVisit ?? false,
        nextAppointment,
        sig: rx.instructions,
        allergies: (patient.allergies ?? []).map((a) => a.allergen.name),
        allergyStatus: patient.allergyStatus,
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
        ...(() => {
          const order = (patient.orders ?? []).find((o) =>
            o.fills.some((f) => f.prescription?.id === rx.id)
          );
          return order
            ? { orderId: order.id, orderState: order.state, pharmacyName: order.pharmacy?.name }
            : {};
        })(),
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
            reason: `Prescribed for ${rx.daysSupply} days but refilled after ${gap}. Worth asking why before anyone changes the quantity.`,
          });
        }
      }
    }
  }

  const out = flags
    .map((f) => {
      const queue = queueFor(f.kind, f.renewableWithoutVisit, f.waitingOn);
      return {
        ...f,
        queue,
        proposal:
          queue === "physician"
            ? buildProposal(rxById.get(f.prescriptionId)!, f.kind, f.nextAppointment, today)
            : undefined,
      };
    })
    .sort((a, b) => a.urgency - b.urgency || a.daysUntil - b.daysUntil);

  return { flags: out, patientsChecked: data.patients.length };
}
