"use client";

import { useState, useTransition } from "react";
import { prepareRenewal } from "./actions.ts";

/**
 * Prepares the renewal in Photon, then opens the prescribe form with it filled
 * in. The physician reviews and signs there — nothing is signed from here.
 */
export function SignButton({
  prescriptionId,
  patientId,
  computedRefills,
}: {
  prescriptionId: string;
  patientId: string;
  computedRefills?: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await prepareRenewal(prescriptionId, patientId, computedRefills);
            if (r.ok && r.url) window.open(r.url, "_blank", "noopener");
            else setError(r.error ?? "Couldn't prepare the renewal");
          })
        }
        className="mt-3 block w-full rounded-md bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
      >
        {pending ? "Preparing in Photon…" : "Review and sign in Photon"}
      </button>
      {error && <p className="mt-1 text-xs text-rose-700">{error}</p>}
    </>
  );
}
