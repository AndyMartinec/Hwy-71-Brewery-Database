import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import InvoiceReview from "@/components/InvoiceReview";
import { PageHeader, Card } from "@/components/ui";
import { ArrowLeft, FileText } from "lucide-react";

export const instant = false;

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: invoice }, { data: lines }, { data: ingredients }] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).single(),
    supabase.from("invoice_lines").select("*").eq("invoice_id", id).order("created_at"),
    // "*" so saved pack sizes come through when supabase/product-details.sql
    // has run, without breaking the page when it hasn't.
    supabase.from("ingredients").select("*").order("name"),
  ]);

  if (!invoice) notFound();

  let fileUrl: string | null = null;
  if (invoice.file_path) {
    const { data } = await supabase.storage
      .from("invoices")
      .createSignedUrl(invoice.file_path, 3600);
    fileUrl = data?.signedUrl ?? null;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/invoices"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 transition hover:text-copper-700"
      >
        <ArrowLeft className="h-4 w-4" /> All invoices
      </Link>
      <div className="mt-3">
        <PageHeader
          eyebrow={invoice.status === "posted" ? "Posted invoice" : "Review invoice"}
          title={invoice.supplier || "New invoice"}
          action={
            fileUrl ? (
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-sm font-semibold text-stone-700 transition hover:border-copper-400 hover:text-copper-700"
              >
                <FileText className="h-4 w-4" /> Original
              </a>
            ) : undefined
          }
        />
      </div>

      {invoice.status === "posted" ? (
        <Card title={`Invoice ${invoice.invoice_number ? `#${invoice.invoice_number}` : ""} — posted`}>
          <ul className="-my-1 divide-y divide-stone-100 text-sm">
            {(lines ?? []).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-stone-800">{l.raw_name}</span>
                  <span className="block text-xs text-stone-500">
                    Added {l.qty_to_add ?? l.qty} to inventory
                  </span>
                </span>
                <span className="tnum shrink-0 font-semibold text-stone-900">
                  {l.line_total != null ? `$${Number(l.line_total).toFixed(2)}` : "—"}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-stone-100 pt-3 text-sm text-stone-600">
            <span>Freight: <span className="tnum font-medium">${Number(invoice.freight).toFixed(2)}</span></span>
            <span>Tax: <span className="tnum font-medium">${Number(invoice.tax).toFixed(2)}</span></span>
            <span>Total: <span className="tnum font-semibold text-stone-900">${Number(invoice.total ?? 0).toFixed(2)}</span></span>
            {invoice.invoice_date && <span>Date: {invoice.invoice_date}</span>}
          </div>
        </Card>
      ) : (
        <InvoiceReview
          invoice={invoice}
          lines={lines ?? []}
          ingredients={ingredients ?? []}
          hasAiKey={!!process.env.OPENAI_API_KEY}
        />
      )}
    </div>
  );
}
