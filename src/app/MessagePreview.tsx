"use client";

import { useState, useTransition } from "react";
import { draftPatientMessage, type DraftedMessage } from "./actions.ts";

/**
 * Shows the text the clinic would send, as a preview. Nothing is sent —
 * outbound SMS needs a provider the clinic owns, and Photon only messages
 * patients to choose a pharmacy.
 */
export function MessagePreview({
  label,
  firstName,
  phone,
  input,
}: {
  label: string;
  firstName: string;
  phone: string | null;
  input: Parameters<typeof draftPatientMessage>[0];
}) {
  const [draft, setDraft] = useState<DraftedMessage | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => setDraft(await draftPatientMessage(input)))
        }
        className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {pending ? "Writing it…" : label}
      </button>

      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
          onClick={() => setDraft(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl bg-white p-4 shadow-xl"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500">To {firstName}</p>
                <p className="font-mono text-xs text-slate-400">{phone ?? "no number on file"}</p>
              </div>
              <button
                onClick={() => setDraft(null)}
                aria-label="Close"
                className="-mt-1 rounded px-2 py-1 text-lg leading-none text-slate-400 hover:text-slate-700"
              >
                ×
              </button>
            </div>

            <div className="mt-3 rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-3 text-sm text-slate-900">
              {draft.message}
            </div>

            {draft.replies?.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  They can reply
                </p>
                <ul className="mt-2 space-y-1.5">
                  {draft.replies.map((r) => (
                    <li key={r.keyword} className="text-xs text-slate-700">
                      <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-white">
                        {r.keyword}
                      </span>{" "}
                      {r.meaning}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Preview only — not sent. Outbound SMS needs the clinic&apos;s own provider; Photon
              messages patients solely to choose a pharmacy.
              {draft.fallback && " (Drafted without a model — no API key set.)"}
            </p>
          </div>
        </div>
      )}
    </>
  );
}
