"use server";

import { revalidatePath } from "next/cache";
import { gql } from "@/lib/photon.ts";

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
