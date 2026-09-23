"use client";

import { useState, useTransition } from "react";
import { rerouteOrder, type PharmacyOption } from "./actions.ts";

/**
 * The one control in this app that writes to Photon.
 *
 * It moves an order to a different pharmacy — logistics, which is why a machine
 * token is permitted to do it. Nothing here touches a prescription.
 */
export function RerouteButton({
  orderId,
  options,
}: {
  orderId: string;
  options: PharmacyOption[];
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (result) {
    return (
      <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 ring-1 ring-emerald-200">
        {result}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        Move it somewhere easier
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-slate-500">Send this order to:</p>
      {options.map((p) => (
        <button
          key={p.id}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await rerouteOrder(orderId, p.id);
              if (r.ok) {
                setResult(
                  `Sent to ${r.pharmacy ?? p.name}${
                    r.state ? ` — order is now ${r.state}` : ""
                  }. The patient gets a text.`
                );
              } else {
                setError(r.error ?? "Something went wrong");
              }
            })
          }
          className="w-full rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:border-slate-400 disabled:opacity-50"
        >
          <span className="font-medium text-slate-900">{p.name}</span>
          <span className="block text-xs text-slate-500">
            {p.street}, {p.city}
          </span>
        </button>
      ))}
      {pending && <p className="text-xs text-slate-500">Routing…</p>}
      {error && <p className="text-xs text-rose-700">{error}</p>}
      <button onClick={() => setOpen(false)} className="text-xs text-slate-500 underline">
        Cancel
      </button>
    </div>
  );
}
