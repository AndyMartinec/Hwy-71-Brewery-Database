import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import InvoiceUpload from "@/components/InvoiceUpload";
import { PageHeader, Card } from "@/components/ui";
import { ArrowRight } from "lucide-react";

export const instant = false;

export default async function InvoicesPage() {
  const supabase = await createClient();
  const { data: invoices } = await supabase
    .from("invoices")
    .select("id,supplier,invoice_number,invoice_date,total,status,created_at")
    .order("created_at", { ascending: false });

  const drafts = (invoices ?? []).filter((i) => i.status === "draft");
  const posted = (invoices ?? []).filter((i) => i.status === "posted");
  const monthSpend = posted
    .filter((i) => {
      const d = new Date(i.invoice_date ?? i.created_at);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((n, i) => n + Number(i.total ?? 0), 0);

  const row = (i: NonNullable<typeof invoices>[number]) => (
    <li key={i.id}>
      <Link
        href={`/invoices/${i.id}`}
        className="flex items-center justify-between gap-3 py-3 transition hover:bg-stone-50"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium text-stone-900">
            {i.supplier || "Unknown supplier"}
            {i.invoice_number ? <span className="text-stone-400"> #{i.invoice_number}</span> : null}
          </span>
          <span className="block text-xs text-stone-500">
            {i.invoice_date ?? new Date(i.created_at).toLocaleDateString()}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {i.total != null && (
            <span className="tnum font-semibold text-stone-900">${Number(i.total).toFixed(2)}</span>
          )}
          {i.status === "draft" && (
            <span className="rounded-full bg-copper-50 px-2.5 py-0.5 text-xs font-semibold text-copper-700 ring-1 ring-inset ring-copper-600/25">
              Needs review
            </span>
          )}
          <ArrowRight className="h-4 w-4 text-stone-300" />
        </span>
      </Link>
    </li>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Purchasing" title="Invoices" />

      <InvoiceUpload />

      {drafts.length > 0 && (
        <Card title="Waiting for review" className="mt-4">
          <ul className="-my-2 divide-y divide-stone-100">{drafts.map(row)}</ul>
        </Card>
      )}

      <Card
        title="Posted"
        className="mt-4"
        action={
          monthSpend > 0 ? (
            <span className="text-xs text-stone-500">
              This month: <span className="tnum font-semibold text-stone-800">${monthSpend.toFixed(2)}</span>
            </span>
          ) : undefined
        }
      >
        {posted.length === 0 ? (
          <p className="py-1 text-sm text-stone-500">
            No posted invoices yet. Posted invoices are what keep inventory counts and
            ingredient prices current.
          </p>
        ) : (
          <ul className="-my-2 divide-y divide-stone-100">{posted.map(row)}</ul>
        )}
      </Card>
    </div>
  );
}
