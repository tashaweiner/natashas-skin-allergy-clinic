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

/**
 * Every demo patient carries the same number, so the `tel:` links dial something
 * real during a demo instead of a 555 placeholder. Set DEMO_PHONE in .env.local;
 * the fallback is a reserved fictional number.
 */
const DEMO_PHONE = process.env.DEMO_PHONE ?? "+12125550100";

const PATIENTS = [
  {
    externalId: "nas-001",
    name: { first: "Marisol", last: "Ayala" },
    dateOfBirth: "1991-04-12",
    sex: "FEMALE",
    phone: DEMO_PHONE,
    story: "Severe tree-nut allergy. EpiPen picked up 11 months ago.",
    address: { street1: "88 Lafayette St", city: "New York", state: "NY", postalCode: "10013", country: "US" },
  },
  {
    externalId: "nas-002",
    name: { first: "Devon", last: "Hartley" },
    dateOfBirth: "1986-11-03",
    sex: "MALE",
    phone: DEMO_PHONE,
    story: "Atopic dermatitis. Topical steroid, out of refills.",
    address: { street1: "412 W 24th St", city: "New York", state: "NY", postalCode: "10011", country: "US" },
  },
  {
    externalId: "nas-003",
    name: { first: "Renata", last: "Silva" },
    dateOfBirth: "1998-02-25",
    sex: "FEMALE",
    phone: DEMO_PHONE,
    story: "Chronic urticaria. Antihistamine sitting at the pharmacy.",
    address: { street1: "70 Pine St", city: "New York", state: "NY", postalCode: "10005", country: "US" },
  },
  {
    externalId: "nas-004",
    name: { first: "Theo", last: "Brandt" },
    dateOfBirth: "1979-08-17",
    sex: "MALE",
    phone: DEMO_PHONE,
    story: "Moderate-to-severe eczema. Biologic held up by prior auth.",
    address: { street1: "155 E 34th St", city: "New York", state: "NY", postalCode: "10016", country: "US" },
  },
  {
    externalId: "nas-005",
    name: { first: "Junie", last: "Okafor" },
    dateOfBirth: "2004-06-30",
    sex: "FEMALE",
    phone: DEMO_PHONE,
    story: "Eczema flare. Burned through a 30-day tube in 11 days.",
    address: { street1: "9 Barrow St", city: "New York", state: "NY", postalCode: "10014", country: "US" },
  },
  {
    externalId: "nas-006",
    name: { first: "Walt", last: "Kendrick" },
    dateOfBirth: "1968-01-09",
    sex: "MALE",
    phone: DEMO_PHONE,
    story: "Seasonal allergic rhinitis. Stable, nothing needed.",
    address: { street1: "300 Mercer St", city: "New York", state: "NY", postalCode: "10003", country: "US" },
  },
];

const existing = await gql<{ patients: { id: string; externalId: string | null }[] }>(
  "api",
  `{ patients { id externalId } }`
);
const seen = new Map(existing.patients.map((p) => [p.externalId, p.id]));

for (const p of PATIENTS) {
  if (seen.has(p.externalId)) {
    // routeOrder refuses an order whose patient has no address on file, so
    // backfill rather than skip.
    const u = await tryGql(
      "api",
      `mutation($id: ID!, $address: AddressInput!, $phone: AWSPhone!) {
         updatePatient(id: $id, address: $address, phone: $phone) { id }
       }`,
      { id: seen.get(p.externalId), address: p.address, phone: p.phone }
    );
    console.log(
      u.ok
        ? `= ${p.name.first} ${p.name.last} exists — phone + address updated`
        : `! ${p.name.last}: ${u.error?.slice(0, 120)}`
    );
    continue;
  }
  const r = await tryGql(
    "api",
    `mutation($externalId: ID!, $name: NameInput!, $dob: AWSDate!, $sex: SexType!, $phone: AWSPhone!, $address: AddressInput!) {
       createPatient(externalId: $externalId, name: $name, dateOfBirth: $dob, sex: $sex, phone: $phone, address: $address) {
         id name { full }
       }
     }`,
    { externalId: p.externalId, name: p.name, dob: p.dateOfBirth, sex: p.sex, phone: p.phone, address: p.address }
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
