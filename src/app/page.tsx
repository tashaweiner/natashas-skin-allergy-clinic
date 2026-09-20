import { getFlags, type Flag, type FlagKind, type Queue } from "@/lib/panel.ts";
import { recommend, type Recommendation } from "@/lib/recommend.ts";

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
    default:
      return "Book a visit";
  }
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

function DanaCard({ f }: { f: Flag }) {
  return (
    <Card>
      <Head f={f} />
      <button className="mt-3 w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
        {danaAction(f)}
      </button>
    </Card>
  );
}

function WaitingCard({ f }: { f: Flag }) {
  return (
    <Card>
      <Head f={f} />
      <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
        Parked on <span className="font-medium text-slate-800">{f.waitingOn}</span>. Runway is
        watching and will move this the moment it lands.
      </p>
      {f.coverageMessage ? (
        <p className="mt-2 text-xs italic text-slate-500">“{f.coverageMessage}”</p>
      ) : null}
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

      <a
        href={prescribeUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 block rounded-md bg-slate-900 px-3 py-2 text-center text-sm font-medium text-white hover:bg-slate-700"
      >
        Review and sign in Photon
      </a>
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
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Runway</h1>
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
              <DanaCard key={`${f.prescriptionId}-${f.kind}`} f={f} />
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
        Runway never sends a prescription. Photon grants{" "}
        <code className="font-mono">write:prescription</code> only to authorized providers — a
        machine token is refused — so every signature happens in Photon, by a physician.
      </p>
    </main>
  );
}
