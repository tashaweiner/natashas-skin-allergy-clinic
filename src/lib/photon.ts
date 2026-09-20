/**
 * Thin Photon (Neutron sandbox) client.
 *
 * Photon splits functionality across two GraphQL domains and their docs don't
 * say which fields live where, so we keep both and let callers pick.
 */

const AUTH_URL = "https://auth.neutron.health/oauth/token";
const AUDIENCE = "https://api.neutron.health";

export const DOMAINS = {
  api: "https://api.neutron.health/graphql",
  clinical: "https://clinical-api.neutron.health/graphql",
} as const;

export type Domain = keyof typeof DOMAINS;

let cached: { token: string; expiresAt: number } | null = null;

export async function getToken(): Promise<string> {
  if (cached && Date.now() < cached.expiresAt) return cached.token;

  const clientId = process.env.PHOTON_CLIENT_ID;
  const clientSecret = process.env.PHOTON_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Missing PHOTON_CLIENT_ID / PHOTON_CLIENT_SECRET. Get them from the avatar menu in app.neutron.health."
    );
  }

  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      audience: AUDIENCE,
      grant_type: "client_credentials",
    }),
  });

  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`Auth failed (${res.status}): ${JSON.stringify(body)}`);
  }

  cached = {
    token: body.access_token,
    // refresh a minute early
    expiresAt: Date.now() + (body.expires_in - 60) * 1000,
  };
  return cached.token;
}

export async function gql<T = any>(
  domain: Domain,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const token = await getToken();

  const res = await fetch(DOMAINS[domain], {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // clinical-api asks for x-photon-auth-token; api wants authorization.
      // Sending both is harmless and saves guessing.
      authorization: `Bearer ${token}`,
      "x-photon-auth-token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await res.json();
  if (body.errors?.length) {
    throw new Error(`GraphQL error on ${domain}: ${JSON.stringify(body.errors)}`);
  }
  return body.data as T;
}

/** Same as gql but returns errors instead of throwing — for probing. */
export async function tryGql(
  domain: Domain,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const data = await gql(domain, query, variables);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
