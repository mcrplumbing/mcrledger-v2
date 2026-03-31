import { useState, useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileSpreadsheet, Check, AlertCircle, CheckCircle2, XCircle, Edit2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedRow {
  vendor_name: string;
  invoice_no: string;
  amount: number;
  date: string;
  due_date: string;
  job_number: string;
  // resolved IDs
  vendor_id?: string;
  job_id?: string;
}

const EXPECTED_HEADERS = ["vendor", "invoice", "amount", "date", "due_date", "job"];
const HEADER_ALIASES: Record<string, string[]> = {
  vendor: ["vendor", "vendorname", "vendor_name", "supplier", "payee", "name"],
  invoice: ["invoice", "invoiceno", "invoice_no", "invoicenumber", "invoice_number", "billno", "bill_no", "num", "refno"],
  amount: ["amount", "total", "balance", "amountdue", "amount_due", "openbalance", "open_balance"],
  date: ["date", "invoicedate", "invoice_date", "billdate", "bill_date", "txndate"],
  due_date: ["duedate", "due_date", "paymentdue", "due"],
  job: ["job", "jobnumber", "job_number", "project", "jobno", "class"],
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function autoDetectColumn(header: string): string | null {
  const norm = normalize(header);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => norm.includes(a) || a.includes(norm))) return field;
  }
  return null;
}

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; }
      else current += ch;
    }
    result.push(current.trim());
    return result;
  };
  return { headers: parseRow(lines[0]), rows: lines.slice(1).map(parseRow) };
}

export default function BulkApImportDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [csvData, setCsvData] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [fileName, setFileName] = useState("");
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isOpeningBalance, setIsOpeningBalance] = useState(false);

  // Load vendors and jobs for matching
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("id, job_number, name");
      if (error) throw error;
      return data;
    },
  });

  const { data: glAccounts = [] } = useQuery({
    queryKey: ["gl-accounts-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts").select("*").eq("active", true);
      if (error) throw error;
      return data || [];
    },
    enabled: isOpeningBalance,
  });

  const vendorLookup = useMemo(() => {
    const map = new Map<string, string>();
    vendors.forEach((v) => map.set(normalize(v.name), v.id));
    return map;
  }, [vendors]);

  const jobLookup = useMemo(() => {
    const map = new Map<string, string>();
    jobs.forEach((j) => {
      map.set(normalize(j.job_number), j.id);
      map.set(normalize(j.name), j.id);
    });
    return map;
  }, [jobs]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseCsv(ev.target?.result as string);
      if (parsed.headers.length === 0) { toast.error("Could not parse CSV"); return; }
      setCsvData(parsed);
      setSelectedRows(new Set(parsed.rows.map((_, i) => i)));
      // Auto-map
      const autoMap: Record<string, string> = {};
      parsed.headers.forEach((h) => {
        const detected = autoDetectColumn(h);
        if (detected) autoMap[h] = detected;
      });
      setColumnMap(autoMap);
    };
    reader.readAsText(file);
  }, []);

  // Build resolved rows
  const resolvedRows: ParsedRow[] = useMemo(() => {
    if (!csvData) return [];
    const colIdx: Record<string, number> = {};
    csvData.headers.forEach((h, i) => { if (columnMap[h]) colIdx[columnMap[h]] = i; });

    return csvData.rows.map((row) => {
      const vendorName = row[colIdx.vendor] || "";
      const jobNumber = row[colIdx.job] || "";
      const vendor_id = vendorLookup.get(normalize(vendorName));
      const job_id = jobNumber ? jobLookup.get(normalize(jobNumber)) : undefined;

      return {
        vendor_name: vendorName,
        invoice_no: row[colIdx.invoice] || "",
        amount: parseFloat((row[colIdx.amount] || "0").replace(/[$,]/g, "")) || 0,
        date: row[colIdx.date] || new Date().toISOString().split("T")[0],
        due_date: row[colIdx.due_date] || "",
        job_number: jobNumber,
        vendor_id,
        job_id,
      };
    });
  }, [csvData, columnMap, vendorLookup, jobLookup]);

  const unmatchedVendors = useMemo(() => {
    const names = new Set<string>();
    resolvedRows.forEach((r, i) => {
      if (selectedRows.has(i) && !r.vendor_id && r.vendor_name) names.add(r.vendor_name);
    });
    return names;
  }, [resolvedRows, selectedRows]);

  const mappedFields = new Set(Object.values(columnMap));
  const missingVendor = !mappedFields.has("vendor");
  const missingInvoice = !mappedFields.has("invoice");
  const missingAmount = !mappedFields.has("amount");
  const hasRequired = !missingVendor && !missingInvoice && !missingAmount;

  const importMutation = useMutation({
    mutationFn: async () => {
      const rows = Array.from(selectedRows)
        .sort()
        .map((i) => resolvedRows[i])
        .filter((r) => r.vendor_id && r.amount > 0);

      if (rows.length === 0) throw new Error("No valid rows to import (all vendors must match)");

      // Batch insert vendor invoices
      const chunkSize = 50;
      let imported = 0;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize).map((r) => ({
          vendor_id: r.vendor_id!,
          invoice_no: r.invoice_no,
          amount: r.amount,
          date: r.date,
          due_date: r.due_date || null,
          job_id: r.job_id || null,
          status: "open",
          paid: 0,
        }));
        const { error } = await supabase.from("vendor_invoices").insert(chunk);
        if (error) throw error;
        imported += chunk.length;
      }

      // If opening balance mode, post reversal JE: DR OBE / CR Expense (untagged)
      // This neutralizes the P&L expense the trigger created while keeping job-tagged costs
      if (isOpeningBalance && imported > 0) {
        const oeId = glAccounts.find((a: any) => a.account_number === "3900")?.id;
        const triggerExpenseId = glAccounts
          .filter((a: any) => a.account_type === "expense" && a.active)
          .sort((a: any, b: any) => a.account_number.localeCompare(b.account_number))[0]?.id;

        if (!oeId) throw new Error("GL account 3900 (Opening Balance Equity) not found");
        if (!triggerExpenseId) throw new Error("No expense account found for reversal");

        const { data: je, error: jeErr } = await supabase.from("journal_entries").insert({
          entry_number: `AP-OB-CSV-${Date.now().toString(36).toUpperCase()}`,
          date: new Date().toISOString().slice(0, 10),
          description: `AP opening balance reversal — CSV import of ${imported} invoice(s)`,
          status: "draft",
        }).select().single();
        if (jeErr) throw jeErr;

        const jeLines: any[] = [];
        for (const r of rows) {
          jeLines.push({
            journal_entry_id: je.id,
            account_id: oeId,
            debit: r.amount,
            credit: 0,
            description: `AP OB reversal: ${r.vendor_name} #${r.invoice_no}`,
            job_id: null,
          });
          jeLines.push({
            journal_entry_id: je.id,
            account_id: triggerExpenseId,
            debit: 0,
            credit: r.amount,
            description: `AP OB reversal: ${r.vendor_name} #${r.invoice_no}`,
            job_id: null,
          });
        }

        const lineChunkSize = 100;
        for (let i = 0; i < jeLines.length; i += lineChunkSize) {
          const { error: lineErr } = await supabase.from("journal_entry_lines").insert(jeLines.slice(i, i + lineChunkSize));
          if (lineErr) throw lineErr;
        }

        const { error: postErr } = await supabase.from("journal_entries").update({ status: "posted" }).eq("id", je.id);
        if (postErr) throw postErr;
      }

      return imported;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["migration-ap"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Imported ${count} AP invoices${isOpeningBalance ? " (opening balance mode — expense reversed to OBE)" : ""}`);
      onOpenChange(false);
      setCsvData(null);
      setFileName("");
      setIsOpeningBalance(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reset = () => {
    setCsvData(null);
    setFileName("");
    setColumnMap({});
    setSelectedRows(new Set());
    setIsOpeningBalance(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Import — Open AP Invoices</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload */}
          <div className="space-y-2">
            <Label>Upload CSV from QuickBooks (Open Bills report)</Label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{fileName || "Choose CSV file..."}</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
              </label>
              {csvData && (
                <span className="text-sm text-muted-foreground">
                  <FileSpreadsheet className="w-4 h-4 inline mr-1" />
                  {csvData.rows.length} rows
                </span>
              )}
              {csvData && (
                <Button variant="ghost" size="sm" onClick={reset}>Clear</Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Expected columns: Vendor Name, Invoice #, Amount, Date, Due Date, Job # (optional). 
              Headers are auto-detected.
            </p>
          </div>

          {/* Opening Balance toggle */}
          <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
            <Checkbox
              id="opening-bal"
              checked={isOpeningBalance}
              onCheckedChange={(v) => setIsOpeningBalance(!!v)}
            />
            <div>
              <label htmlFor="opening-bal" className="text-sm font-medium cursor-pointer">
                Opening Balance Mode
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                For pre-ledger invoices: creates AP records for aging &amp; payment, reverses expense to Opening Balance Equity (3900) so P&amp;L isn't inflated. Job costs are preserved for job profitability.
              </p>
            </div>
          </div>

          {/* Column mapping */}
          {csvData && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Column Mapping</Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {csvData.headers.map((header) => (
                  <div key={header} className="space-y-0.5">
                    <span className="text-xs font-mono text-muted-foreground truncate block" title={header}>{header}</span>
                    <Select
                      value={columnMap[header] || "__skip__"}
                      onValueChange={(v) => setColumnMap((prev) => {
                        const next = { ...prev };
                        if (v === "__skip__") delete next[header];
                        else next[header] = v;
                        return next;
                      })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__skip__">— Skip —</SelectItem>
                        <SelectItem value="vendor">Vendor Name *</SelectItem>
                        <SelectItem value="invoice">Invoice # *</SelectItem>
                        <SelectItem value="amount">Amount *</SelectItem>
                        <SelectItem value="date">Invoice Date</SelectItem>
                        <SelectItem value="due_date">Due Date</SelectItem>
                        <SelectItem value="job">Job Number</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              {(!hasRequired) && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4" />
                  Map required columns: {[missingVendor && "Vendor", missingInvoice && "Invoice #", missingAmount && "Amount"].filter(Boolean).join(", ")}
                </div>
              )}
            </div>
          )}

          {/* Unmatched vendors warning */}
          {csvData && hasRequired && unmatchedVendors.size > 0 && (
            <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                <AlertCircle className="w-4 h-4 text-warning" />
                {unmatchedVendors.size} vendor(s) not found in system — these rows will be skipped
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {Array.from(unmatchedVendors).slice(0, 10).map((name) => (
                  <span key={name} className="text-xs px-2 py-0.5 rounded bg-warning/20 text-warning font-medium">{name}</span>
                ))}
                {unmatchedVendors.size > 10 && <span className="text-xs text-muted-foreground">+{unmatchedVendors.size - 10} more</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                Add these vendors on the Vendors tab first, then re-import.
              </p>
            </div>
          )}

          {/* Preview table */}
          {csvData && hasRequired && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/20">
                <span className="text-sm font-medium text-card-foreground">
                  {selectedRows.size} of {resolvedRows.length} rows selected
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => {
                    if (selectedRows.size === resolvedRows.length) setSelectedRows(new Set());
                    else setSelectedRows(new Set(resolvedRows.map((_, i) => i)));
                  }}>
                    {selectedRows.size === resolvedRows.length ? "Deselect All" : "Select All"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => importMutation.mutate()}
                    disabled={importMutation.isPending || selectedRows.size === 0}
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Import {Array.from(selectedRows).filter((i) => resolvedRows[i]?.vendor_id).length} Invoices
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto max-h-[40vh] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="px-3 py-2 w-8"></th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Vendor</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Match</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Invoice #</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground text-xs">Amount</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Date</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Due</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs">Job</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resolvedRows.map((row, i) => {
                      const selected = selectedRows.has(i);
                      const matched = !!row.vendor_id;
                      return (
                        <tr
                          key={i}
                          className={cn(
                            "border-b border-border/50 transition-colors",
                            !selected && "opacity-40",
                            !matched && selected && "bg-warning/5"
                          )}
                        >
                          <td className="px-3 py-1.5">
                            <Checkbox checked={selected} onCheckedChange={() => {
                              setSelectedRows((prev) => {
                                const next = new Set(prev);
                                if (next.has(i)) next.delete(i); else next.add(i);
                                return next;
                              });
                            }} />
                          </td>
                          <td className="px-3 py-1.5 text-xs font-medium text-card-foreground">{row.vendor_name}</td>
                          <td className="px-3 py-1.5">
                            {matched ? (
                              <CheckCircle2 className="w-4 h-4 text-success" />
                            ) : (
                              <XCircle className="w-4 h-4 text-warning" />
                            )}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-xs">{row.invoice_no}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs">${row.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{row.date}</td>
                          <td className="px-3 py-1.5 text-xs text-muted-foreground">{row.due_date || "—"}</td>
                          <td className="px-3 py-1.5 text-xs">
                            {row.job_id ? (
                              <span className="text-primary font-mono">{row.job_number}</span>
                            ) : row.job_number ? (
                              <span className="text-warning">{row.job_number} ✗</span>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
