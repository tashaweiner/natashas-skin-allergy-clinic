import { getFlags, type Change, type Flag, type FlagKind, type Queue } from "@/lib/panel.ts";
import { recommend, type Recommendation } from "@/lib/recommend.ts";
import { nearbyPharmacies, type PharmacyOption } from "./actions.ts";
import { RerouteButton } from "./RerouteButton.tsx";
import { ContactPanel } from "./ContactPanel.tsx";

export const dynamic = "force-dynamic";

const LABEL: Record<FlagKind, string> = {
  DEVICE_EXPIRING: "Expiring",
  RUNNING_OUT: "Running out",
  STRANDED: "Not picked up",
  BLOCKED: "Coverage",
  SHORT_SUPPLY: "Ran short",
};

const TONE: Record<FlagKind, string> = {
  DEVICE_EXPIRING: "bg-amber-100 text-amber-900 ring-amber-200",
  RUNNING_OUT: "bg-rose-100 text-rose-900 ring-rose-200",
  STRANDED: "bg-sky-100 text-sky-900 ring-sky-200",
  BLOCKED: "bg-violet-100 text-violet-900 ring-violet-200",
  SHORT_SUPPLY: "bg-slate-100 text-slate-900 ring-slate-200",
};

const VERDICT: Record<Recommendation["verdict"], { text: string; tone: string }> = {
  APPROVE: { text: "Recommend: approve", tone: "bg-emerald-50 text-emerald-900 ring-emerald-200" },
  NEEDS_VISIT: { text: "Recommend: see them first", tone: "bg-amber-50 text-amber-900 ring-amber-200" },
  HOLD: { text: "Recommend: hold", tone: "bg-slate-50 text-slate-800 ring-slate-200" },
};

function danaAction(f: Flag): string {
  switch (f.kind) {
    case "STRANDED":
      return "Offer delivery or another pharmacy";
    case "BLOCKED":
      return "Start the prior authorisation";
    case "SHORT_SUPPLY":
      return "Call and ask what happened";
    default:
      return "Book a visit — renewal needs one";
  }
}

function Contact({ f, label }: { f: Flag; label?: string }) {
  return (
    <ContactPanel
      label={label}
      name={f.patientName}
      phone={f.phone}
      email={f.email}
      dateOfBirth={f.dateOfBirth}
      address={f.address}
    />
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <li className="rounded-lg border border-slate-200 bg-white p-4">{children}</li>;
}

function Head({ f }: { f: Flag }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${TONE[f.kind]}`}>
          {LABEL[f.kind]}
        </span>
        <span className="font-medium text-slate-900">{f.patientName}</span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{f.medication}</p>
      <p className="mt-1 text-sm text-slate-700">{f.reason}</p>
    </>
  );
}

function DanaCard({ f, pharmacies }: { f: Flag; pharmacies: PharmacyOption[] }) {
  // A stranded order is the one case we can actually resolve from here.
  const canReroute = f.kind === "STRANDED" && f.orderId && pharmacies.length > 0;

  return (
    <Card>
      <Head f={f} />
      {f.pharmacyName && (
        <p className="mt-1 text-xs text-slate-500">Currently at {f.pharmacyName}</p>
      )}
      {f.kind === "SHORT_SUPPLY" && (
        <p className="mt-2 rounded bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
          Goes to Dr. Reyes once there&apos;s an answer — lost it, worse flare, or a bigger
          area than the quantity assumed.
        </p>
      )}
      {canReroute ? (
        <>
          <RerouteButton orderId={f.orderId!} options={pharmacies} />
          <Contact f={f} />
        </>
      ) : (
        <Contact
          f={f}
          label={
            f.kind === "SHORT_SUPPLY"
              ? "Text them to call the clinic"
              : "Text them to book a visit"
          }
        />
      )}
    </Card>
  );
}

function WaitingCard({ f }: { f: Flag }) {
  return (
    <Card>
      <Head f={f} />
      <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
        Parked on <span className="font-medium text-slate-800">{f.waitingOn}</span>. This is
        watched, and moves the moment it lands.
      </p>
      {f.coverageMessage ? (
        <p className="mt-2 text-xs italic text-slate-500">“{f.coverageMessage}”</p>
      ) : null}
      <Contact f={f} />
    </Card>
  );
}

async function PhysicianCard({ f }: { f: Flag }) {
  const rec = await recommend(f);
  const v = VERDICT[rec.verdict];
  const prescribeUrl = `https://app.neutron.health/prescriptions/new?patientId=${f.patientId}`;

  return (
    <Card>
      <Head f={f} />

      <div className={`mt-3 rounded-md px-3 py-2 ring-1 ${v.tone}`}>
        <p className="text-sm font-medium">{v.text}</p>
        <p className="mt-1 text-sm">{rec.line}</p>
        {rec.basis.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs opacity-80">
            {rec.basis.map((b, i) => (
              <li key={i}>— {b}</li>
            ))}
          </ul>
        )}
        {rec.fallback && (
          <p className="mt-2 text-xs opacity-70">
            No ANTHROPIC_API_KEY set — deterministic fallback, not a read of the chart.
          </p>
        )}
      </div>

      {f.proposal && (
        <div className="mt-3 rounded-md border border-slate-200 p-3">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Renewal draft
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Copied from the prescription written {f.proposal.writtenAt}:
          </p>
          <p className="mt-1 text-xs text-slate-700">{f.proposal.unchanged}</p>

          {f.proposal.changes.map((c: Change, i: number) => (
            <div key={i} className="mt-2 rounded bg-amber-50 px-2 py-1.5 ring-1 ring-amber-200">
              <p className="text-xs font-medium text-amber-900">
                {c.field}: {c.from} → {c.to}
                {c.certainty === "suggested" && (
                  <span className="ml-1 font-normal opacity-70">(suggested)</span>
                )}
              </p>
              <p className="text-xs text-amber-800">{c.reason}</p>
            </div>
          ))}
        </div>
      )}

      <a
        href={prescribeUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 block rounded-md bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-slate-700"
      >
        Review and sign in Photon
      </a>
      <Contact f={f} />
    </Card>
  );
}

function Column({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex-1">
      <div className="mb-3">
        <h2 className="text-sm font-semibold tracking-wide text-slate-900 uppercase">
          {title} <span className="font-normal text-slate-400">{count}</span>
        </h2>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

export default async function Page() {
  let flags: Flag[] = [];
  let error: string | null = null;

  try {
    flags = await getFlags();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  let pharmacies: PharmacyOption[] = [];
  try {
    pharmacies = await nearbyPharmacies();
  } catch {
    // A pharmacy list that won't load shouldn't take the whole board down.
  }

  const by = (q: Queue) => flags.filter((f) => f.queue === q);
  const dana = by("dana");
  const waiting = by("waiting");
  const physician = by("physician");

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const neverReachedADoctor =
    flags.length === 0 ? 0 : Math.round(((flags.length - physician.length) / flags.length) * 100);

  return (
    <main className="mx-auto min-h-screen max-w-6xl bg-slate-50 px-4 py-10 sm:px-6">
      <header className="mb-8">
        <p className="text-sm text-slate-500">Natasha&apos;s Allergy &amp; Skin</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Dana&apos;s Dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">
          {today} — {flags.length} {flags.length === 1 ? "problem" : "problems"} found.{" "}
          <span className="font-medium text-slate-900">
            {neverReachedADoctor}% never reach a physician.
          </span>
        </p>
      </header>

      {error ? (
        <div className="rounded-md bg-rose-50 p-4 text-sm text-rose-900 ring-1 ring-rose-200">
          <p className="font-medium">Couldn&apos;t reach Photon</p>
          <p className="mt-1 font-mono text-xs">{error}</p>
        </div>
      ) : flags.length === 0 ? (
        <p className="rounded-md bg-white p-6 text-sm text-slate-600 ring-1 ring-slate-200">
          Nobody is at risk today. Run <code className="font-mono">npm run seed</code> to build the
          demo panel.
        </p>
      ) : (
        <div className="flex flex-col gap-8 lg:flex-row lg:gap-6">
          <Column title="Dana" subtitle="Logistics — no doctor needed" count={dana.length}>
            {dana.map((f) => (
              <DanaCard key={`${f.prescriptionId}-${f.kind}`} f={f} pharmacies={pharmacies} />
            ))}
          </Column>

          <Column title="Waiting" subtitle="Parked until something happens" count={waiting.length}>
            {waiting.map((f) => (
              <WaitingCard key={`${f.prescriptionId}-${f.kind}`} f={f} />
            ))}
          </Column>

          <Column title="Dr. Reyes" subtitle="Signatures only" count={physician.length}>
            {physician.map((f) => (
              <PhysicianCard key={`${f.prescriptionId}-${f.kind}`} f={f} />
            ))}
          </Column>
        </div>
      )}

      <p className="mt-10 text-xs leading-relaxed text-slate-500">
        Nothing here sends a prescription. Photon grants{" "}
        <code className="font-mono">write:prescription</code> only to authorized providers — a
        machine token is refused — so every signature happens in Photon, by a physician.
      </p>
    </main>
  );
}
