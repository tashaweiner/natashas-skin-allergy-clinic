/**
 * Every string that is sent to a model, in one place.
 *
 * Kept here, free of framework imports, so `npm run audit` can build the exact
 * prompts the app sends and assert that no patient identifier appears in them.
 * If you add a field to either prompt, the audit checks it automatically.
 */

import type { Flag } from "./panel.ts";

/**
 * Exactly what the model is shown.
 *
 * Exported so `npm run audit` can assert against the real string rather than a
 * copy of it. There is no name, no date of birth, no phone, no address, and no
 * Photon id here — the model reasons about a chart, not a person.
 */
export function buildChart(flag: Flag): string {
  return [
    `Medication: ${flag.medication}`,
    `Why this surfaced: ${flag.reason}`,
    `Refills the patient can still collect: ${flag.refillsLeft}`,
    `Prescriber marked renewable without a visit: ${flag.renewableWithoutVisit ? "yes" : "no"}`,
    `Next scheduled visit: ${flag.nextAppointment ?? "none"}`,
    flag.sig ? `Directions as written: ${flag.sig}` : null,
    flag.allergies?.length
      ? `Allergies on file: ${flag.allergies.join(", ")}`
      : flag.allergyStatus
        ? `Allergies on file: none — recorded status is "${flag.allergyStatus}"`
        : "Allergies on file: none, and no allergy status was ever recorded — absence here means nobody asked, not that there are none",
    flag.medicationHistory?.length
      ? `Other medications on file: ${flag.medicationHistory.join(", ")}`
      : "Other medications on file: none recorded",
    // Photon screens at write time via prescriptionScreen; this tool does not
    // re-run it, so the model is told that rather than handed a result we never
    // fetched. Wiring it is BACKLOG item 2.
    "Interaction screening: NOT re-run for this renewal. The last screen was at the time the original prescription was written.",
    flag.coverageMessage ? `Insurer returned: "${flag.coverageMessage}"` : null,
    flag.lastSeen ? `Last seen: ${flag.lastSeen}` : "Last seen: not recorded",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Exactly what the model is shown when drafting a patient message.
 *
 * Exported so `npm run audit` can assert against the real string. Note what is
 * absent: the patient's name never reaches the model. It writes the literal
 * token {{name}} and the app substitutes afterwards, so no identifier leaves
 * this process.
 */
export function buildSituation(input: {
  medication: string;
  reason: string;
  refillsLeft: number;
  nextAppointment: string | null;
  renewableWithoutVisit: boolean;
  pharmacyName?: string;
}): string {
  return [
    `Medication: ${input.medication}`,
    `Situation: ${input.reason}`,
    `Refills they can still collect: ${input.refillsLeft}`,
    `Visit already scheduled: ${input.nextAppointment ?? "none"}`,
    `Can be renewed without a visit: ${input.renewableWithoutVisit ? "yes" : "no"}`,
    input.pharmacyName ? `Currently at: ${input.pharmacyName}` : null,
    `The clinic can move the prescription to another pharmacy on their behalf if they name one.`,
    `The clinic cannot link them into an app — replies come back to the clinic by text.`,
  ]
    .filter(Boolean)
    .join("\n");
}
