import { supabase } from "@/integrations/supabase/client";

/**
 * Fetch all rows from a Supabase table, paginating past the 1000-row default limit.
 * Pass a `build` callback that receives `supabase` and returns a query builder with select/filters/order.
 */
export async function fetchAll<T = any>(
  build: (client: typeof supabase) => any
): Promise<T[]> {
  const PAGE = 1000;
  let all: T[] = [];
  let from = 0;
  while (true) {
    const q = build(supabase).range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data as T[]);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
