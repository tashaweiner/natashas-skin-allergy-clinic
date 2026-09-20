/**
 * The local overlay.
 *
 * Photon's sandbox never advances a fill: every fill comes back state NEW with
 * filledAt = null, and orders sit in ROUTING forever because no real patient
 * picks a pharmacy. It also has no concept of an appointment, no field for
 * whether a renewal needs a visit, and no device expiry date.
 *
 * So the facts Photon can't hold live here, keyed by Photon's own ids. In
 * production every one of these except `renewableWithoutVisit` would come from
 * Photon directly.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "overlay.json");

export type RxOverlay = {
  /** When the patient actually picked it up. Photon would know this. */
  filledAt: string | null;
  /** Set by the prescriber at write time. Photon has nowhere to put this. */
  renewableWithoutVisit: boolean;
  /** Auto-injectors expire ~12 months from dispense. Photon doesn't track it. */
  deviceExpiresAt?: string;
  /** Outcome of the benefit check, if one came back unhappy. */
  coverage?: "COVERED" | "PA_REQUIRED" | "NOT_COVERED";
  /** Order sat READY at the pharmacy since this date and was never collected. */
  readySince?: string;
  /** Previous pickup, to spot a refill that came far too early. */
  previousFilledAt?: string;
  /**
   * How many refills the patient can still collect. Photon cannot express
   * this: its sandbox leaves every fill in state NEW forever, and
   * fillsRemaining is already 0 the moment the order is placed.
   */
  refillsLeft?: number;
  /** Free text from the insurer's benefit check. Photon returns this verbatim. */
  coverageMessage?: string;
  /** When the patient was last seen. Photon has no concept of a visit. */
  lastSeen?: string;
  /**
   * Set when the item is parked on something that has not happened yet —
   * "labs", "prior authorisation", "a reply". A watcher clears it.
   */
  waitingOn?: string;
};

export type Overlay = {
  /** patientId -> ISO date of their next scheduled visit */
  appointments: Record<string, string | null>;
  /** prescriptionId -> the facts above */
  prescriptions: Record<string, RxOverlay>;
};

const EMPTY: Overlay = { appointments: {}, prescriptions: {} };

export async function loadOverlay(): Promise<Overlay> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Overlay;
  } catch {
    return EMPTY;
  }
}

export async function saveOverlay(o: Overlay): Promise<void> {
  await writeFile(FILE, JSON.stringify(o, null, 2) + "\n");
}

export const daysBetween = (a: Date, b: Date) =>
  Math.round((b.getTime() - a.getTime()) / 86_400_000);

export const addDays = (d: Date, n: number) =>
  new Date(d.getTime() + n * 86_400_000);

export const iso = (d: Date) => d.toISOString().slice(0, 10);
