import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Upload, Loader2, CheckCircle2, AlertCircle, FileText, Clock, Play, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { format } from "date-fns";

const BACKUP_TABLES = [
  { name: "gl_accounts", label: "Chart of Accounts" },
  { name: "bank_accounts", label: "Bank Accounts" },
  { name: "jobs", label: "Jobs" },
  { name: "transactions", label: "Transactions (Checkbook)" },
  { name: "vendors", label: "Vendors" },
  { name: "vendor_invoices", label: "Vendor Invoices (AP)" },
  { name: "job_invoices", label: "Invoices (AR)" },
  { name: "journal_entries", label: "Journal Entries" },
  { name: "journal_entry_lines", label: "Journal Entry Lines" },
  { name: "employees", label: "Employees" },
  { name: "employee_deductions", label: "Employee Deductions" },
  { name: "timesheets", label: "Timesheets" },
  { name: "payroll_runs", label: "Payroll Runs" },
  { name: "payroll_entries", label: "Payroll Entries" },
  { name: "tax_settings", label: "Tax Settings" },
  { name: "loans", label: "Loans" },
  { name: "assets", label: "Assets" },
  { name: "bank_reconciliations", label: "Bank Reconciliations" },
  { name: "received_payments", label: "Received Payments" },
  { name: "closed_periods", label: "Closed Periods" },
  { name: "audit_log", label: "Audit Log" },
] as const;

type TableName = typeof BACKUP_TABLES[number]["name"];

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          if (val === null || val === undefined) return "";
          const str = String(val);
          if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(",")
    ),
  ];
  return lines.join("\n");
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          result.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  };

  const headers = parseRow(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] ?? "";
    });
    return obj;
  });
}

function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DataBackup() {
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreResults, setRestoreResults] = useState<{ table: string; status: string; count: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");

  // Backup history
  const { data: backupRuns = [] } = useQuery({
    queryKey: ["backup-runs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("backup_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  const runBackupNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("automated-backup");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["backup-runs"] });
      toast.success(`Backup complete — ${data.tables} tables, ${data.records} records`);
    },
    onError: (e: any) => toast.error("Backup failed: " + e.message),
  });

  // Tables to DELETE during reset (order matters — children first)
  const RESET_TABLES = [
    "journal_entry_lines", "journal_entries",
    "payroll_entries", "payroll_runs",
    "received_payments", "bank_reconciliations",
    "transactions", "vendor_invoices", "job_invoices",
    "timesheets", "pto_ledger", "closed_periods",
    "audit_log",
  ] as const;

  // Tables PRESERVED during reset:
  // gl_accounts, bank_accounts, jobs, vendors, employees, employee_deductions,
  // employee_pto, tax_settings, loans, assets, user_roles, user_page_permissions

  const resetMutation = useMutation({
    mutationFn: async () => {
      for (const table of RESET_TABLES) {
        // Delete all rows — supabase needs a filter, use gte on created_at
        const { error } = await supabase
          .from(table as any)
          .delete()
          .gte("created_at", "1900-01-01");
        if (error) {
          console.error(`Reset error on ${table}:`, error.message);
          // Continue even if one table fails (e.g. audit_log may be restricted)
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast.success("All transaction data has been cleared. Setup data preserved.");
      setResetConfirmOpen(false);
      setResetConfirmText("");
    },
    onError: (e: any) => toast.error("Reset failed: " + e.message),
  });

  const handleExportAll = async () => {
    setExporting(true);
    try {
      const timestamp = new Date().toISOString().slice(0, 10);
      let fileCount = 0;

      for (const table of BACKUP_TABLES) {
        try {
          const data = await fetchAll((sb) => sb.from(table.name as any).select("*"));
          if (data && data.length > 0) {
          const csv = toCsv(data);
            downloadFile(csv, `${table.name}_${timestamp}.csv`);
            fileCount++;
          }
        } catch (err) {
          console.error(`Error exporting ${table.name}:`, err);
        }
      }

      if (fileCount === 0) {
        toast.info("No data to export — all tables are empty");
      } else {
        toast.success(`Exported ${fileCount} table(s) as CSV files`);
      }
    } catch (err) {
      toast.error("Export failed: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setExporting(false);
    }
  };

  const handleExportSingle = async (tableName: TableName, label: string) => {
    try {
      const data = await fetchAll((sb) => sb.from(tableName as any).select("*"));
      if (!data || data.length === 0) {
        toast.info(`${label} has no data to export`);
        return;
      }
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadFile(toCsv(data), `${tableName}_${timestamp}.csv`);
      toast.success(`Exported ${data.length} ${label} records`);
    } catch (err) {
      toast.error(`Failed to export ${label}`);
    }
  };

  const handleRestoreFiles = async (files: FileList) => {
    setImporting(true);
    setRestoreOpen(true);
    const results: { table: string; status: string; count: number }[] = [];

    // Determine restore order (parents before children)
    const restoreOrder: TableName[] = [
      "gl_accounts", "bank_accounts", "jobs", "vendors", "employees",
      "transactions", "vendor_invoices", "job_invoices",
      "journal_entries", "journal_entry_lines",
      "employee_deductions", "timesheets",
      "payroll_runs", "payroll_entries",
      "tax_settings", "loans", "assets", "bank_reconciliations",
      "received_payments", "closed_periods",
    ];

    // Map files to table names
    const fileMap = new Map<string, File>();
    for (const file of Array.from(files)) {
      const match = file.name.match(/^([a-z_]+?)(?:_\d{4}-\d{2}-\d{2})?\.csv$/i);
      if (match) {
        fileMap.set(match[1].toLowerCase(), file);
      }
    }

    for (const tableName of restoreOrder) {
      const file = fileMap.get(tableName);
      if (!file) continue;

      try {
        const text = await file.text();
        const rows = parseCsv(text);
        if (rows.length === 0) {
          results.push({ table: tableName, status: "skipped", count: 0 });
          continue;
        }

        // Clean rows: remove empty strings for nullable fields, handle booleans/numbers
        const cleanedRows = rows.map((row) => {
          const clean: Record<string, any> = {};
          for (const [key, val] of Object.entries(row)) {
            if (key === "created_at" || key === "updated_at") {
              clean[key] = val || undefined;
              continue;
            }
            if (val === "") {
              clean[key] = null;
            } else if (val === "true") {
              clean[key] = true;
            } else if (val === "false") {
              clean[key] = false;
            } else {
              clean[key] = val;
            }
          }
          return clean;
        });

        // Upsert in batches of 100
        const batchSize = 100;
        let inserted = 0;
        for (let i = 0; i < cleanedRows.length; i += batchSize) {
          const batch = cleanedRows.slice(i, i + batchSize);
          const { error } = await (supabase.from(tableName as any).upsert(batch as any, { onConflict: "id" }) as any);
          if (error) throw error;
          inserted += batch.length;
        }

        results.push({ table: tableName, status: "success", count: inserted });
      } catch (err) {
        console.error(`Restore error for ${tableName}:`, err);
        results.push({ table: tableName, status: "error", count: 0 });
      }
    }

    setRestoreResults(results);
    setImporting(false);

    const successCount = results.filter((r) => r.status === "success").length;
    if (successCount > 0) {
      toast.success(`Restored ${successCount} table(s) successfully`);
    }
  };

  return (
    <div className="p-8">
      <PageHeader
        title="Data Backup & Restore"
        description="Export all your data as CSV files for safekeeping, or restore from a previous backup."
      />

      <div className="grid gap-6 md:grid-cols-2 mt-6">
        {/* Export Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" />
              Export / Backup
            </CardTitle>
            <CardDescription>
              Download all your data as CSV files. Each table exports as a separate file. Store these files safely — you can re-import them anytime.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleExportAll} disabled={exporting} className="w-full">
              {exporting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Exporting…</>
              ) : (
                <><Download className="w-4 h-4 mr-2" />Download All Tables</>
              )}
            </Button>

            <div className="border-t border-border pt-4">
              <p className="text-xs text-muted-foreground mb-3">Or export individual tables:</p>
              <div className="grid grid-cols-2 gap-2">
                {BACKUP_TABLES.map((t) => (
                  <Button
                    key={t.name}
                    variant="outline"
                    size="sm"
                    className="text-xs justify-start"
                    onClick={() => handleExportSingle(t.name, t.label)}
                  >
                    <FileText className="w-3 h-3 mr-1.5 flex-shrink-0" />
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Restore Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" />
              Restore from Backup
            </CardTitle>
            <CardDescription>
              Select your previously exported CSV files to restore data. Files are matched by name (e.g. <code className="text-xs bg-muted px-1 rounded">gl_accounts_2026-03-10.csv</code>). Existing records with the same ID will be updated; new ones will be inserted.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleRestoreFiles(e.target.files);
                }
              }}
            />
            <Button
              variant="outline"
              className="w-full"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              {importing ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Restoring…</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" />Select CSV Files to Restore</>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              💡 Tip: Select all exported CSV files at once. The restore process handles them in the correct order to respect data relationships.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Automated Backup Card */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Automated Weekly Backups
          </CardTitle>
          <CardDescription>
            A full snapshot of all tables runs automatically every Sunday at 3:00 AM UTC and is stored securely in cloud storage. You can also trigger a backup manually.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => runBackupNow.mutate()}
            disabled={runBackupNow.isPending}
            variant="outline"
          >
            {runBackupNow.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running Backup…</>
            ) : (
              <><Play className="w-4 h-4 mr-2" />Run Backup Now</>
            )}
          </Button>

          {backupRuns.length > 0 && (
            <div className="border-t border-border pt-4">
              <p className="text-xs text-muted-foreground mb-3">Recent backup history:</p>
              <div className="space-y-2">
                {backupRuns.map((run: any) => (
                  <div key={run.id} className="flex items-center gap-3 text-sm">
                    {run.status === "completed" ? (
                      <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                    ) : run.status === "running" ? (
                      <Loader2 className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                    )}
                    <span className="text-muted-foreground">
                      {format(new Date(run.started_at), "MMM d, yyyy h:mm a")}
                    </span>
                    <span className="font-medium">
                      {run.status === "completed"
                        ? `${run.tables_backed_up} tables · ${run.total_records} records`
                        : run.status === "running"
                        ? "In progress…"
                        : "Failed"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reset Transaction Data Card */}
      <Card className="mt-6 border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" />
            Reset Transaction Data
          </CardTitle>
          <CardDescription>
            Wipe all transactional records to start fresh — perfect for cutover from another system. 
            This <strong>deletes</strong> checkbook transactions, journal entries, payroll runs, AP/AR invoices, 
            timesheets, reconciliations, and audit logs. It <strong>preserves</strong> your Chart of Accounts, 
            tax tables, employees, vendors, jobs, bank accounts, loans, assets, and deductions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-destructive">⚠️ This action cannot be undone. Run a backup first!</p>
            <p className="text-xs text-muted-foreground">
              Type <span className="font-mono font-bold">RESET</span> below to confirm, then click the button.
            </p>
            <Input
              placeholder='Type "RESET" to confirm'
              value={resetConfirmText}
              onChange={(e) => setResetConfirmText(e.target.value)}
              className="max-w-xs font-mono"
            />
            <Button
              variant="destructive"
              disabled={resetConfirmText !== "RESET" || resetMutation.isPending}
              onClick={() => resetMutation.mutate()}
            >
              {resetMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Resetting…</>
              ) : (
                <><Trash2 className="w-4 h-4 mr-2" />Erase All Transaction Data</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Results</DialogTitle>
            <DialogDescription>Summary of the data restore operation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            {importing && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Restoring data…</span>
              </div>
            )}
            {restoreResults.map((r) => (
              <div key={r.table} className="flex items-center gap-3 text-sm">
                {r.status === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                ) : r.status === "error" ? (
                  <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                ) : (
                  <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="font-medium">{BACKUP_TABLES.find((t) => t.name === r.table)?.label || r.table}</span>
                <span className="text-muted-foreground ml-auto">
                  {r.status === "success" ? `${r.count} records` : r.status === "error" ? "Failed" : "Skipped"}
                </span>
              </div>
            ))}
            {!importing && restoreResults.length > 0 && (
              <Button className="w-full mt-4" onClick={() => setRestoreOpen(false)}>
                Done
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
