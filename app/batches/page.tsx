import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SyncButton from "@/components/SyncButton";
import { PageHeader, Card, StatusBadge } from "@/components/ui";

export const instant = false;

const ORDER = ["Brewing", "Fermenting", "Conditioning", "Planning", "Completed", "Archived"];

export default async function BatchesPage() {
  const supabase = await createClient();
  const { data: batches } = await supabase
    .from("batches")
    .select("id,recipe_name,batch_number,status,brew_date,batch_size_gal,brewer,brewfather_id")
    .order("updated_at", { ascending: false });

  const groups = new Map<string, NonNullable<typeof batches>>();
  for (const b of batches ?? []) {
    if (!groups.has(b.status)) groups.set(b.status, []);
    groups.get(b.status)!.push(b);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Production"
        title="Batches"
        action={<SyncButton />}
      />
<div className="space-y-4">
        {ORDER.filter((s) => groups.get(s)?.length).map((status) => (
          <Card key={status} title={`${status} — ${groups.get(status)!.length}`}>
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-stone-100">
                  {groups.get(status)!.map((b) => (
                    <tr key={b.id} className="transition hover:bg-stone-50">
                      <td className="px-5 py-3">
                        <Link href={`/batches/${b.id}`} className="font-medium text-stone-900 hover:text-copper-700">
                          {b.recipe_name}
                          {b.batch_number ? <span className="text-stone-400"> #{b.batch_number}</span> : null}
                        </Link>
                        <span className="block text-xs text-stone-500">
                          {[b.brew_date, b.batch_size_gal ? `${b.batch_size_gal} gal` : null, b.brewer, b.brewfather_id ? "via Brewfather" : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <StatusBadge status={b.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
        {(batches ?? []).length === 0 && (
          <Card>
            <p className="py-2 text-center text-sm text-stone-500">
              No batches yet. Run a Brewfather sync or log your first brew day.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
