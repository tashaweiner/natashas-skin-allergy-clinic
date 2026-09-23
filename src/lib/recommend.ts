/**
 * The one place a model is used.
 *
 * Detection is arithmetic and stays in panel.ts. This is the opposite problem:
 * the inputs are language — a free-text sig, an insurer's message, a list of
 * allergies and medications — and the output is a position a physician can
 * accept or override in two seconds.
 *
 * It never decides whether to prescribe. It relays what the chart says and
 * recommends. Photon refuses `write:prescription` to this process anyway, so
 * the constraint is enforced below us.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Flag } from "./panel.ts";
import { buildChart } from "./prompts.ts";

export type Verdict = "APPROVE" | "NEEDS_VISIT" | "HOLD";

export type Recommendation = {
  verdict: Verdict;
  /** One sentence a physician can act on. */
  line: string;
  /** The facts it leaned on, so the human can check its work. */
  basis: string[];
  /** True when no API key is set and this is the deterministic fallback. */
  fallback?: boolean;
};

const SYSTEM = `You support a small allergy and dermatology clinic. A renewal has reached a
physician's signature queue. Summarise whether it looks safe to renew without seeing the patient.

Rules:
- You are not deciding anything. You state a position; a physician signs or overrides.
- Never say a medication should or should not be prescribed on pharmacological grounds.
  You have NOT been given an interaction screen result. Do not claim anything was or
  was not flagged. If interactions matter here, say they have not been re-checked.
- The prescriber's "renewable without a visit" setting is a default from when the
  prescription was written, not an answer. Time and new information can override it.
- Say plainly when information is missing or stale. "Medication list last confirmed 14
  months ago" is more useful than false confidence.
- Be brief. One sentence for the line. Three or four short facts for the basis.

Reply with JSON only, no prose around it:
{"verdict":"APPROVE"|"NEEDS_VISIT"|"HOLD","line":"...","basis":["...","..."]}

APPROVE  — renewing without a visit looks reasonable
NEEDS_VISIT — the patient should be seen first
HOLD — something must resolve first (labs, prior authorisation, a reply)`;

/** Used when no API key is configured, so the app still runs end to end. */
function deterministic(flag: Flag): Recommendation {
  const stale =
    flag.nextAppointment === null ? "No visit on the books." : `Next visit ${flag.nextAppointment}.`;
  if (!flag.renewableWithoutVisit) {
    return {
      verdict: "NEEDS_VISIT",
      line: `${flag.medication} is not marked renewable without a visit.`,
      basis: [flag.reason, stale, `${flag.refillsLeft} refills left.`],
      fallback: true,
    };
  }
  return {
    verdict: "APPROVE",
    line: `Marked renewable without a visit by the prescriber.`,
    basis: [flag.reason, stale, `${flag.refillsLeft} refills left.`],
    fallback: true,
  };
}

/**
 * Pulls the first balanced {...} out of a response.
 *
 * A greedy regex runs to the last brace in the whole string, which swallows any
 * trailing prose the model adds after the object and fails to parse.
 */
function firstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
    } else if (c === "\\" && inString) {
      escaped = true;
    } else if (c === '"') {
      inString = !inString;
    } else if (!inString) {
      if (c === "{") depth++;
      else if (c === "}" && --depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const cache = new Map<string, Recommendation>();

export async function recommend(flag: Flag): Promise<Recommendation> {
  const key = `${flag.prescriptionId}:${flag.kind}`;
  const hit = cache.get(key);
  if (hit) return hit;

  if (!process.env.ANTHROPIC_API_KEY) {
    const r = deterministic(flag);
    cache.set(key, r);
    return r;
  }

  const client = new Anthropic();
  const chart = buildChart(flag);


  try {
    const res = await client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: chart }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const json = firstJsonObject(text);
    if (!json) throw new Error("no JSON object in response");
    const parsed = JSON.parse(json) as Recommendation;

    if (!["APPROVE", "NEEDS_VISIT", "HOLD"].includes(parsed.verdict)) {
      throw new Error(`unexpected verdict: ${parsed.verdict}`);
    }

    const r: Recommendation = {
      verdict: parsed.verdict,
      line: parsed.line,
      basis: Array.isArray(parsed.basis) ? parsed.basis.slice(0, 5) : [],
    };
    cache.set(key, r);
    return r;
  } catch (e) {
    // A failed recommendation must never strand a prescription. Fall back,
    // and let the physician see that it fell back.
    console.error("recommendation failed, falling back:", e);
    const r = deterministic(flag);
    cache.set(key, r);
    return r;
  }
}
