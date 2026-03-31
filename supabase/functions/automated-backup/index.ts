import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BACKUP_TABLES = [
  "gl_accounts", "bank_accounts", "jobs", "vendors", "employees",
  "transactions", "vendor_invoices", "job_invoices",
  "journal_entries", "journal_entry_lines",
  "employee_deductions", "timesheets",
  "payroll_runs", "payroll_entries",
  "tax_settings", "loans", "assets", "bank_reconciliations",
  "received_payments", "closed_periods",
];

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
const CORS_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
  };
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const folderPath = `backup-${timestamp}`;

    // Create backup_runs record
    const { data: run, error: runErr } = await sb
      .from("backup_runs")
      .insert({ storage_path: folderPath })
      .select()
      .single();
    if (runErr) throw runErr;

    let tablesBackedUp = 0;
    let totalRecords = 0;

    for (const table of BACKUP_TABLES) {
      // Paginate to get all rows
      let allRows: any[] = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await sb
          .from(table)
          .select("*")
          .range(from, from + PAGE - 1);
        if (error) {
          console.error(`Error reading ${table}:`, error.message);
          break;
        }
        if (!data || data.length === 0) break;
        allRows = allRows.concat(data);
        if (data.length < PAGE) break;
        from += PAGE;
      }

      if (allRows.length === 0) continue;

      // Store as JSON in the backups bucket
      const filePath = `${folderPath}/${table}.json`;
      const { error: uploadErr } = await sb.storage
        .from("backups")
        .upload(filePath, JSON.stringify(allRows, null, 2), {
          contentType: "application/json",
          upsert: true,
        });

      if (uploadErr) {
        console.error(`Upload error for ${table}:`, uploadErr.message);
        continue;
      }

      tablesBackedUp++;
      totalRecords += allRows.length;
    }

    // Update run record
    await sb.from("backup_runs").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      tables_backed_up: tablesBackedUp,
      total_records: totalRecords,
    }).eq("id", run.id);

    return new Response(
      JSON.stringify({ success: true, tables: tablesBackedUp, records: totalRecords, path: folderPath }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Backup failed:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
