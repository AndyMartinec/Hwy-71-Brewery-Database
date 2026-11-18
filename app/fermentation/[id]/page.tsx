import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ScanReview from "@/components/ScanReview";
import { PageHeader, Card } from "@/components/ui";
import { ArrowLeft } from "lucide-react";

export const instant = false;

export default async function ScanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ batch?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const fixedBatchId = sp.batch ?? null;
  const supabase = await createClient();

  const [{ data: scan }, { data: lines }, { data: batches }] = await Promise.all([
    supabase.from("fermentation_scans").select("*").eq("id", id).single(),
    supabase.from("fermentation_scan_lines").select("*").eq("scan_id", id).order("taken_at"),
    supabase
      .from("batches")
      .select("id,batch_number,recipe_name,status")
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);

  if (!scan) notFound();

  let fileUrl: string | null = null;
  if (scan.file_path) {
    const { data } = await supabase.storage
      .from("fermentation-sheets")
      .createSignedUrl(scan.file_path, 3600);
    fileUrl = data?.signedUrl ?? null;
  }

  return (
    <div>
      <Link
        href="/fermentation"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 transition hover:text-copper-700"
      >
        <ArrowLeft className="h-4 w-4" /> All scans
      </Link>
      <PageHeader
        eyebrow={scan.status === "posted" ? "Posted" : "Review scan"}
        title={scan.file_name ?? "Fermentation sheet"}
      />

      <div className="mt-5 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ScanReview
            scanId={scan.id}
            status={scan.status}
            fixedBatchId={fixedBatchId}
            initialLines={(lines ?? []).map((l) => ({
              id: l.id,
              batch_id: fixedBatchId ?? l.batch_id,
              batch_label: l.batch_label,
              taken_at: l.taken_at,
              plato: l.plato != null ? Number(l.plato) : null,
              temp_f: l.temp_f != null ? Number(l.temp_f) : null,
              action: l.action,
            }))}
            batches={(batches ?? []).map((b) => ({
              id: b.id,
              batch_number: b.batch_number,
              recipe_name: b.recipe_name,
              status: b.status,
            }))}
          />
        </div>
        <div className="lg:col-span-2">
          <Card title="Original sheet">
            {fileUrl ? (
              <div className="-mx-5 -my-4 max-h-[700px] overflow-auto">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl} alt="Fermentation sheet" className="w-full" />
              </div>
            ) : (
              <p className="py-2 text-sm text-stone-500">No image stored.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
