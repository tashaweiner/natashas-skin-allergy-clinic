"use server";

import { revalidatePath } from "next/cache";
import { gql } from "@/lib/photon.ts";
import { buildSituation } from "@/lib/prompts.ts";

/**
 * Pharmacies the clinic can route to. Photon's search is by lat/long, so this
 * is the clinic's own location — in production it would be the patient's.
 */
const CLINIC = { latitude: 40.7128, longitude: -74.006, radius: 15 };

export type PharmacyOption = { id: string; name: string; street: string; city: string };

export async function nearbyPharmacies(): Promise<PharmacyOption[]> {
  const data = await gql<{
    pharmacies: { id: string; name: string; address: { street1: string; city: string } | null }[];
  }>(
    "api",
    `query($loc: LatLongSearch!) {
       pharmacies(location: $loc, first: 12) { id name address { street1 city } }
     }`,
    { loc: CLINIC }
  );

  // Independents and clinic pharmacies come back alongside retail; a coordinator
  // picking a destination wants the chains they actually route to.
  const retail = data.pharmacies.filter((p) =>
    /cvs|walgreens|rite aid|duane reade|target|costco/i.test(p.name)
  );
  return (retail.length ? retail : data.pharmacies).slice(0, 3).map((p) => ({
    id: p.id,
    name: p.name,
    street: p.address?.street1 ?? "",
    city: p.address?.city ?? "",
  }));
}

/**
 * Send an order to a different pharmacy. A real write to Photon.
 *
 * This is logistics, not a clinical decision, which is exactly why a machine
 * token is allowed to do it — `write:order` is granted, `write:prescription`
 * is not.
 *
 * Two Photon quirks handled here: the mutation returns the order as it was
 * BEFORE the change, and the subsequent read is eventually consistent — so the
 * order is re-read, with a short poll, rather than trusted on the first look.
 */
export async function rerouteOrder(
  orderId: string,
  pharmacyId: string
): Promise<{ ok: boolean; state?: string; pharmacy?: string; error?: string }> {
  try {
    await gql(
      "api",
      `mutation($id: ID!, $pharmacyId: ID!) {
         routeOrder(id: $id, pharmacyId: $pharmacyId) { id }
       }`,
      { id: orderId, pharmacyId }
    );

    let state: string | undefined;
    let pharmacy: string | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise((r) => setTimeout(r, attempt === 0 ? 400 : 1200));
      const after = await gql<{
        order: { state: string; pharmacy: { name: string } | null };
      }>("api", `query($id: ID!) { order(id: $id) { state pharmacy { name } } }`, { id: orderId });
      state = after.order.state;
      pharmacy = after.order.pharmacy?.name;
      if (pharmacy) break;
    }

    revalidatePath("/");
    return { ok: true, state, pharmacy };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Pre-draft the renewal so the physician lands on a filled-in form.
 *
 * Photon lets a machine token create a prescription TEMPLATE but not a
 * prescription — exactly the right line — and the prescribe deep link accepts
 * `templateIds`. So the renewal can be prepared without anything being signed.
 *
 * What gets carried: every field copied verbatim from the prescription being
 * renewed, plus changes marked `computed` (arithmetic — the refill count needed
 * to reach the next visit). Changes marked `suggested` are deliberately NOT
 * applied; those are questions for the physician, and baking a guess into a
 * form someone may sign on autopilot is how you get a wrong dose.
 */
export async function prepareRenewal(
  prescriptionId: string,
  patientId: string,
  computedRefills?: number
): Promise<{ ok: boolean; url?: string; prefilled?: boolean; error?: string }> {
  try {
    const { prescription: rx } = await gql<{
      prescription: {
        dispenseQuantity: number;
        dispenseUnit: string;
        daysSupply: number | null;
        instructions: string;
        fillsAllowed: number;
        treatment: { id: string; name: string };
      };
    }>(
      "api",
      `query($id: ID!) {
         prescription(id: $id) {
           dispenseQuantity dispenseUnit daysSupply instructions fillsAllowed
           treatment { id name }
         }
       }`,
      { id: prescriptionId }
    );

    const { catalogs } = await gql<{ catalogs: { id: string }[] }>("api", `{ catalogs { id } }`);
    const catalogId = catalogs[0]?.id;
    if (!catalogId) return { ok: false, error: "No catalog on this organization" };

    const { createPrescriptionTemplate: tpl } = await gql<{
      createPrescriptionTemplate: { id: string };
    }>(
      "api",
      `mutation($catalogId: ID!, $treatmentId: ID!, $name: String!, $q: Float!, $u: String!,
                $fills: Int!, $days: Int!, $sig: String!) {
         createPrescriptionTemplate(
           catalogId: $catalogId, treatmentId: $treatmentId, name: $name,
           dispenseQuantity: $q, dispenseUnit: $u, fillsAllowed: $fills,
           daysSupply: $days, instructions: $sig, isPrivate: false
         ) { id }
       }`,
      {
        catalogId,
        treatmentId: rx.treatment.id,
        name: `Renewal — ${rx.treatment.name.slice(0, 40)}`,
        q: rx.dispenseQuantity,
        u: rx.dispenseUnit,
        // the only value that differs from what was signed before
        fills: computedRefills ?? rx.fillsAllowed,
        days: rx.daysSupply ?? 30,
        sig: rx.instructions,
      }
    );

    return {
      ok: true,
      prefilled: true,
      url: `https://app.neutron.health/prescriptions/new?patientId=${patientId}&templateIds=${tpl.id}`,
    };
  } catch (e) {
    // Prefilling is an enhancement, not a dependency. If the template can't be
    // created, the physician still needs to reach the prescribe form — a blank
    // form beats a dead button.
    console.error("prefill failed, falling back to a plain deep link:", e);
    return {
      ok: true,
      prefilled: false,
      url: `https://app.neutron.health/prescriptions/new?patientId=${patientId}`,
    };
  }
}

/**
 * Draft the text the clinic would send this patient.
 *
 * The second and last place a model is used. Templating this badly is how
 * clinics end up sending "our records show you have not picked up your
 * medication" — technically true, and it reads as an accusation. The right
 * message depends on the drug, the runway, the refills, whether a visit is
 * booked, and above all whether the patient can DO anything about it.
 *
 * The model never sees a name. It writes {{name}} and we substitute, so nothing
 * identifying leaves this process.
 */
const MESSAGE_SYSTEM = `You write short SMS messages a small allergy and dermatology clinic
sends to its own patients. One message, under 300 characters, plain language.

Rules, in order of importance:
- Never imply fault. Most people who miss a prescription are blocked, not careless — the
  wrong pharmacy, the cost, the hours, the queue. Treat it as the clinic's job to fix.
- Never send a message the patient cannot act on. Every message ends with something they
  can do in one reply.
- Never ask a question the clinic already knows the answer to. If a visit is already
  booked, say so; don't ask whether they want one.
- Say what is happening and by when, concretely. A date beats "soon".
- No emoji. No marketing tone. Write the way a competent person at a front desk writes.

Address the patient as the literal token {{name}} — five characters, two braces each side —
exactly once, near the start. Never invent or guess a name. The message is rejected if the
token {{name}} does not appear in it verbatim.

Reply with JSON only:
{"message":"...","replies":[{"keyword":"...","meaning":"..."}]}

"replies" lists what the patient can text back — 2 or 3 options, each a single word or a
short phrase, with what it means. Always include a way to reach a human.`;

export type DraftedMessage = {
  message: string;
  replies: { keyword: string; meaning: string }[];
  fallback?: boolean;
};

export async function draftPatientMessage(input: {
  firstName: string;
  medication: string;
  reason: string;
  kind: string;
  refillsLeft: number;
  nextAppointment: string | null;
  renewableWithoutVisit: boolean;
  pharmacyName?: string;
}): Promise<DraftedMessage> {
  const situation = buildSituation(input);

  const withName = (m: DraftedMessage): DraftedMessage => ({
    ...m,
    message: m.message.replace(/\{\{name\}\}/g, input.firstName),
  });

  if (!process.env.ANTHROPIC_API_KEY) {
    return withName({
      message: `Hi {{name}} — your ${input.medication.split(" ")[0]} needs attention. Reply CALL and we'll ring you.`,
      replies: [{ keyword: "CALL", meaning: "Someone from the clinic phones them" }],
      fallback: true,
    });
  }

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const res = await new Anthropic().messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: MESSAGE_SYSTEM,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: situation }],
    });
    const text = res.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("");
    const start = text.indexOf("{");
    const parsed = JSON.parse(text.slice(start, text.lastIndexOf("}") + 1)) as DraftedMessage;

    // The model occasionally writes a name of its own instead of the token. A
    // message addressed to the wrong person is worse than no message, so this
    // is treated as a failed draft rather than patched up — there is no safe
    // way to guess which word was meant to be the name.
    if (!parsed.message.includes("{{name}}")) {
      throw new Error("draft omitted the {{name}} token");
    }
    return withName(parsed);
  } catch (e) {
    console.error("message draft failed:", e);
    return withName({
      message: `Hi {{name}} — your ${input.medication.split(" ")[0]} needs attention. Reply CALL and we'll ring you.`,
      replies: [{ keyword: "CALL", meaning: "Someone from the clinic phones them" }],
      fallback: true,
    });
  }
}
