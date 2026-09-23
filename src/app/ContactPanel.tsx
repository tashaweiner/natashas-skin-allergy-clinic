"use client";

import { useState } from "react";
import { MessagePreview } from "./MessagePreview.tsx";

/**
 * Who the patient is, on every card.
 *
 * `label` adds a texting button above it. That one is stubbed on purpose —
 * Photon only messages patients for pharmacy selection, so outbound SMS needs a
 * provider the clinic owns, and a button that silently does nothing is worse
 * than one that says so. Without a label, this is just the contact details.
 */
export function ContactPanel({
  label,
  name,
  phone,
  email,
  dateOfBirth,
  address,
  draftInput,
}: {
  label?: string;
  name: string;
  phone: string | null;
  email?: string | null;
  dateOfBirth?: string;
  address?: string | null;
  draftInput?: React.ComponentProps<typeof MessagePreview>["input"];
}) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <div className="mt-3 space-y-2">
      {label && draftInput && (
        <MessagePreview
          label={label}
          firstName={name.split(" ")[0]}
          phone={phone}
          input={draftInput}
        />
      )}

      <button
        onClick={() => setShowInfo((v) => !v)}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800 hover:border-slate-400"
      >
        {showInfo ? "Hide patient info" : "View patient info"}
      </button>

      {showInfo && (
        <dl className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-slate-500">Name</dt>
            <dd>{name}</dd>
          </div>
          {dateOfBirth && (
            <div className="mt-1 flex gap-2">
              <dt className="w-16 shrink-0 text-slate-500">DOB</dt>
              <dd>{dateOfBirth}</dd>
            </div>
          )}
          <div className="mt-1 flex gap-2">
            <dt className="w-16 shrink-0 text-slate-500">Phone</dt>
            <dd>
              {phone ? (
                <a href={`tel:${phone}`} className="font-medium text-slate-900 underline">
                  {phone}
                </a>
              ) : (
                "none on file"
              )}
            </dd>
          </div>
          {email && (
            <div className="mt-1 flex gap-2">
              <dt className="w-16 shrink-0 text-slate-500">Email</dt>
              <dd>{email}</dd>
            </div>
          )}
          {address && (
            <div className="mt-1 flex gap-2">
              <dt className="w-16 shrink-0 text-slate-500">Address</dt>
              <dd>{address}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}
