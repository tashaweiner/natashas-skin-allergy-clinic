/**
 * Asserts that no patient identifier reaches Claude.
 *
 * Builds the exact strings the two model calls send, using the real exported
 * builders rather than a copy, and checks them against every identifier in the
 * live panel. Run it after touching either prompt.
 *
 * Run: npm run audit
 */

import { gql } from "../src/lib/photon.ts";
import { getFlags } from "../src/lib/panel.ts";
import { buildChart, buildSituation } from "../src/lib/prompts.ts";

type P = {
  id: string;
  name: { first: string; last: string; full: string };
  dateOfBirth: string;
  phone: string | null;
  email: string | null;
  address: { street1: string; postalCode: string } | null;
};

const { patients } = await gql<{ patients: P[] }>(
  "api",
  `{ patients(first: 100) { id name { first last full } dateOfBirth phone email
       address { street1 postalCode } } }`
);

// Every string that identifies a person, from the live panel.
const identifiers: { kind: string; value: string }[] = [];
for (const p of patients) {
  identifiers.push({ kind: "patient id", value: p.id });
  identifiers.push({ kind: "full name", value: p.name.full });
  if (p.name.first?.length > 2) identifiers.push({ kind: "first name", value: p.name.first });
  if (p.name.last?.length > 2) identifiers.push({ kind: "last name", value: p.name.last });
  identifiers.push({ kind: "date of birth", value: p.dateOfBirth });
  if (p.phone) identifiers.push({ kind: "phone", value: p.phone.replace(/\D/g, "") });
  if (p.email) identifiers.push({ kind: "email", value: p.email });
  if (p.address?.street1) identifiers.push({ kind: "street", value: p.address.street1 });
  if (p.address?.postalCode) identifiers.push({ kind: "postcode", value: p.address.postalCode });
}

const { flags } = await getFlags();
const prompts: { where: string; text: string }[] = [];

for (const f of flags) {
  prompts.push({ where: `recommend() · ${f.kind}`, text: buildChart(f) });
  prompts.push({
    where: `draftPatientMessage() · ${f.kind}`,
    text: buildSituation({
      medication: f.medication,
      reason: f.reason,
      refillsLeft: f.refillsLeft,
      nextAppointment: f.nextAppointment,
      renewableWithoutVisit: f.renewableWithoutVisit,
      pharmacyName: f.pharmacyName,
    }),
  });
}

let leaks = 0;
for (const prompt of prompts) {
  const haystack = prompt.text.toLowerCase().replace(/\D/g, (c) => c);
  for (const id of identifiers) {
    const needle = id.value.toLowerCase();
    if (!needle) continue;
    const hit =
      id.kind === "phone"
        ? prompt.text.replace(/\D/g, "").includes(needle)
        : haystack.includes(needle);
    if (hit) {
      console.log(`LEAK  ${prompt.where}  →  ${id.kind}: ${id.value}`);
      leaks++;
    }
  }
}

console.log(
  `\nChecked ${prompts.length} prompts against ${identifiers.length} identifiers ` +
    `from ${patients.length} patients.`
);
console.log(leaks === 0 ? "No patient identifier reaches Claude." : `${leaks} LEAKS — fix before shipping.`);

console.log("\n--- a real prompt, in full ---\n");
console.log(prompts[0].text);

process.exit(leaks === 0 ? 0 : 1);
