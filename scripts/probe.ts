/**
 * Step-one spike. Answers, in ~20 seconds:
 *   1. Does my token work, and what scopes did I get?
 *   2. Which of Photon's two domains can I actually read?
 *   3. Where do prescriptions live? (there is no top-level `prescriptions`
 *      query on clinical-api, so this matters)
 *   4. What did the MCP actually create for me — and do fills have dates?
 *
 * Run: npm run probe
 */

import { DOMAINS, getToken, tryGql, type Domain } from "../src/lib/photon.ts";

const line = (s = "") => console.log(s);
const rule = (s: string) => line(`\n${"═".repeat(3)} ${s} ${"═".repeat(Math.max(0, 60 - s.length))}`);

async function main() {
  rule("AUTH");
  const token = await getToken();
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  line(`token ok, expires ${new Date(claims.exp * 1000).toLocaleString()}`);
  line(`scopes: ${claims.scope ?? "(none listed)"}`);

  // ── Which domains answer, and what can they do? ───────────────────────────
  const queryFields: Record<string, string[]> = {};

  for (const domain of Object.keys(DOMAINS) as Domain[]) {
    rule(`DOMAIN: ${domain}  (${DOMAINS[domain]})`);
    const r = await tryGql(domain, `{ __schema { queryType { fields { name } } } }`);
    if (!r.ok) {
      line(`✗ ${r.error?.slice(0, 200)}`);
      continue;
    }
    const fields: string[] = r.data.__schema.queryType.fields.map((f: any) => f.name);
    queryFields[domain] = fields;
    line(`✓ ${fields.length} query fields`);
    line(fields.join(", "));

    const rx = fields.filter((f) => /prescription|fill/i.test(f));
    line(`\n→ prescription/fill-related: ${rx.length ? rx.join(", ") : "NONE"}`);
  }

  // ── What's in the org right now? ──────────────────────────────────────────
  rule("PATIENTS");
  const patientsDomain = (Object.keys(queryFields) as Domain[]).find((d) =>
    queryFields[d]?.includes("patients")
  );
  if (!patientsDomain) {
    line("✗ no domain exposes `patients` — stop and rethink");
    return;
  }
  line(`using domain: ${patientsDomain}`);

  const p = await tryGql(
    patientsDomain,
    `{ patients { id externalId name { full } dateOfBirth sex phone } }`
  );
  if (!p.ok) {
    line(`✗ ${p.error?.slice(0, 300)}`);
  } else {
    const list = p.data.patients ?? [];
    line(`${list.length} patients:`);
    for (const pt of list) line(`  ${pt.id}  ${pt.name?.full ?? "?"}  dob ${pt.dateOfBirth}`);
  }

  // ── The critical question: can I see prescriptions WITH fill dates? ───────
  rule("PRESCRIPTIONS + FILLS (the thing the product depends on)");

  const firstPatient = p.ok ? p.data.patients?.[0]?.id : null;

  // Try every plausible shape; report which one works.
  const attempts: Array<{ label: string; domain: Domain; query: string; vars?: any }> = [];

  for (const d of Object.keys(queryFields) as Domain[]) {
    const f = queryFields[d] ?? [];
    if (f.includes("prescriptions")) {
      attempts.push({
        label: `${d}: top-level prescriptions`,
        domain: d,
        query: `{ prescriptions { id state daysSupply fillsAllowed fillsRemaining writtenAt expirationDate
                   treatment { name } fills { id state filledAt requestedAt } } }`,
      });
    }
    if (firstPatient) {
      attempts.push({
        label: `${d}: patient.prescriptions`,
        domain: d,
        query: `query($id: ID!) { patient(id: $id) { id name { full }
                   prescriptions { id state daysSupply fillsRemaining writtenAt
                     treatment { name } fills { id state filledAt } } } }`,
        vars: { id: firstPatient },
      });
      attempts.push({
        label: `${d}: patient.treatmentHistory`,
        domain: d,
        query: `query($id: ID!) { patient(id: $id) { id treatmentHistory {
                   treatment { name } prescription { id daysSupply fillsRemaining writtenAt
                     fills { id state filledAt } } } } }`,
        vars: { id: firstPatient },
      });
    }
    if (f.includes("orders")) {
      attempts.push({
        label: `${d}: orders → fills → prescription`,
        domain: d,
        query: `{ orders { id state createdAt patient { id name { full } }
                   fills { id state filledAt requestedAt
                     prescription { id daysSupply fillsRemaining writtenAt treatment { name } } } } }`,
      });
    }
  }

  for (const a of attempts) {
    const r = await tryGql(a.domain, a.query, a.vars ?? {});
    if (r.ok) {
      line(`\n✓ ${a.label}`);
      line(JSON.stringify(r.data, null, 2).slice(0, 1600));
    } else {
      line(`\n✗ ${a.label}`);
      line(`   ${r.error?.slice(0, 220)}`);
    }
  }

  rule("VERDICT");
  line("Look for: (a) a query that returns prescriptions, (b) daysSupply populated,");
  line("(c) fills[].filledAt populated with a REAL date.");
  line("If filledAt is null everywhere, the sandbox can't produce fill history →");
  line("seed real patients/prescriptions in Photon, simulate fill dates locally,");
  line("and say so loudly in the README. That's a finding, not a failure.");
}

main().catch((e) => {
  console.error("\nFAILED:", e.message);
  process.exit(1);
});
