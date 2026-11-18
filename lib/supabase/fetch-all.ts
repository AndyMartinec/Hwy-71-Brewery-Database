/** Read every row of a query, page by page.
 *
 *  Supabase (PostgREST) caps a single response at 1,000 rows by default and
 *  truncates silently — no error, just missing rows. The ledgers this app
 *  reports from (inventory_transactions, finished_goods_transactions) pass
 *  that within months, after which period reports, COGS, and tax numbers
 *  would quietly undercount. Every full-ledger read goes through here.
 *
 *  The query must have a stable order (e.g. .order("created_at").order("id"))
 *  so pages don't overlap or skip rows. */
const PAGE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>
): Promise<{ data: T[] }> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { data: out };
}
