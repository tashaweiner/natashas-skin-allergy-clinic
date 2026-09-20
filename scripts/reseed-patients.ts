/**
 * Creates the demo panel for Natasha's Allergy & Skin.
 *
 * Patients only. Prescriptions have to be written through the MCP server or
 * the Neutron app, because a machine token is refused `write:prescription` —
 * Photon reserves prescribing for authorized providers. That refusal is the
 * point, not an obstacle.
 *
 * Run: npm run reseed
 */

import { gql, tryGql } from "../src/lib/photon.ts";

const PATIENTS = [
  {
    externalId: "nas-001",
    name: { first: "Marisol", last: "Ayala" },
    dateOfBirth: "1991-04-12",
    sex: "FEMALE",
    phone: "+12125550141",
    story: "Severe tree-nut allergy. EpiPen picked up 11 months ago.",
  },
  {
    externalId: "nas-002",
    name: { first: "Devon", last: "Hartley" },
    dateOfBirth: "1986-11-03",
    sex: "MALE",
    phone: "+12125550142",
    story: "Atopic dermatitis. Topical steroid, out of refills.",
  },
  {
    externalId: "nas-003",
    name: { first: "Renata", last: "Silva" },
    dateOfBirth: "1998-02-25",
    sex: "FEMALE",
    phone: "+12125550143",
    story: "Chronic urticaria. Antihistamine sitting at the pharmacy.",
  },
  {
    externalId: "nas-004",
    name: { first: "Theo", last: "Brandt" },
    dateOfBirth: "1979-08-17",
    sex: "MALE",
    phone: "+12125550144",
    story: "Moderate-to-severe eczema. Biologic held up by prior auth.",
  },
  {
    externalId: "nas-005",
    name: { first: "Junie", last: "Okafor" },
    dateOfBirth: "2004-06-30",
    sex: "FEMALE",
    phone: "+12125550145",
    story: "Eczema flare. Burned through a 30-day tube in 11 days.",
  },
  {
    externalId: "nas-006",
    name: { first: "Walt", last: "Kendrick" },
    dateOfBirth: "1968-01-09",
    sex: "MALE",
    phone: "+12125550146",
    story: "Seasonal allergic rhinitis. Stable, nothing needed.",
  },
];

const existing = await gql<{ patients: { id: string; externalId: string | null }[] }>(
  "api",
  `{ patients { id externalId } }`
);
const seen = new Map(existing.patients.map((p) => [p.externalId, p.id]));

for (const p of PATIENTS) {
  if (seen.has(p.externalId)) {
    console.log(`= ${p.name.first} ${p.name.last} already exists (${seen.get(p.externalId)})`);
    continue;
  }
  const r = await tryGql(
    "api",
    `mutation($externalId: ID!, $name: NameInput!, $dob: AWSDate!, $sex: SexType!, $phone: AWSPhone!) {
       createPatient(externalId: $externalId, name: $name, dateOfBirth: $dob, sex: $sex, phone: $phone) {
         id name { full }
       }
     }`,
    { externalId: p.externalId, name: p.name, dob: p.dateOfBirth, sex: p.sex, phone: p.phone }
  );
  console.log(
    r.ok
      ? `+ ${r.data.createPatient.name.full.padEnd(18)} ${r.data.createPatient.id}  — ${p.story}`
      : `! ${p.name.last}: ${r.error?.slice(0, 140)}`
  );
}

console.log(
  "\nPatients done. Prescriptions must be written through the MCP server or the\n" +
    "Neutron app — a machine token cannot hold write:prescription."
);
