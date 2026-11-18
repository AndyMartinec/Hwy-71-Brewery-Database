import type { ReactNode } from "react";

/** Page heading block: small-caps eyebrow + condensed display title. */
export function PageHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-copper-700">
          {eyebrow}
        </p>
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-ink-900">
          {title}
        </h1>
      </div>
      {action}
    </div>
  );
}

/** CRM-style panel: white surface, hairline border, restrained shadow. */
export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white shadow-[0_1px_2px_rgba(28,25,23,0.05)] ${className}`}>
      {title && (
        <header className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** Big-number stat for the dashboard. */
export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(28,25,23,0.05)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
        {label}
      </p>
      <p className="tnum font-display mt-1 text-4xl font-semibold text-ink-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-stone-500">{sub}</p>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  Planning: "bg-stone-100 text-stone-600 ring-stone-600/20",
  Brewing: "bg-copper-50 text-copper-700 ring-copper-600/25",
  Fermenting: "bg-emerald-50 text-emerald-700 ring-emerald-600/25",
  Conditioning: "bg-sky-50 text-sky-700 ring-sky-600/25",
  Completed: "bg-stone-100 text-stone-500 ring-stone-500/20",
  Archived: "bg-stone-100 text-stone-400 ring-stone-400/20",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? STATUS_STYLES.Planning;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

/** Shared field styles (forms). */
export const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-stone-900 placeholder:text-stone-400 focus:border-copper-500 focus:outline-none focus:ring-2 focus:ring-copper-500/30";
export const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500";
export const primaryBtn =
  "rounded-lg bg-ink-900 px-4 py-2.5 font-semibold text-white transition hover:bg-ink-800 disabled:opacity-60";
export const accentBtn =
  "rounded-lg bg-copper-600 px-4 py-2.5 font-semibold text-white transition hover:bg-copper-700 disabled:opacity-60";
