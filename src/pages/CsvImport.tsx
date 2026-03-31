import { useState, useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileSpreadsheet, Check, AlertCircle, Trash2, Edit2 } from "lucide-react";
import { toast } from "sonner";
import { cn, parseMoney } from "@/lib/utils";

type ImportTarget = "gl_accounts" | "vendors" | "jobs" | "job_invoices" | "vendor_invoices";

interface ColumnMapping {
  csvHeader: string;
  dbColumn: string;
}

const TARGET_CONFIG: Record<ImportTarget, { label: string; requiredColumns: string[]; optionalColumns: string[]; description: string }> = {
  gl_accounts: {
    label: "Chart of Accounts",
    requiredColumns: ["account_number", "name"],
    optionalColumns: ["account_type", "normal_balance", "active"],
    description: "Import GL accounts. Required: account_number, name",
  },
  vendors: {
    label: "Vendors",
    requiredColumns: ["name"],
    optionalColumns: ["contact", "email", "phone", "address"],
    description: "Import vendor list. Required: name",
  },
  jobs: {
    label: "Jobs",
    requiredColumns: ["job_number", "name"],
    optionalColumns: ["client", "status", "budget"],
    description: "Import jobs/projects. Required: job_number, name",
  },
  job_invoices: {
    label: "AR Invoices",
    requiredColumns: ["invoice_number", "client", "amount"],
    optionalColumns: ["date", "due_date", "description", "status", "paid", "job_number"],
    description: "Import customer invoices (AR). Required: invoice_number, client, amount. Use job NUMBER to link to jobs.",
  },
  vendor_invoices: {
    label: "AP Invoices",
    requiredColumns: ["invoice_no", "vendor", "amount"],
    optionalColumns: ["date", "due_date", "client", "job_number", "status", "paid"],
    description: "Import vendor bills (AP). Use vendor NAME, job NUMBER, and client name — they'll be auto-matched",
  },
};

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
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow);
  return { headers, rows };
}

export default function CsvImport() {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<ImportTarget>("gl_accounts");
  const [csvData, setCsvData] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [fileName, setFileName] = useState("");
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [editedData, setEditedData] = useState<Record<string, string>>({});

  const config = TARGET_CONFIG[target];
  const allDbColumns = [...config.requiredColumns, ...config.optionalColumns];

  // Pre-fetch vendors and jobs for name resolution
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => fetchAll((s) => s.from("vendors").select("id,name")),
  });
  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => fetchAll((s) => s.from("jobs").select("id,job_number,name,client")),
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.headers.length === 0) {
        toast.error("Could not parse CSV file");
        return;
      }
      setCsvData(parsed);
      setSelectedRows(new Set(parsed.rows.map((_, i) => i)));
      setEditedData({});

      // Auto-map columns by fuzzy matching
      const autoMap: Record<string, string> = {};
      parsed.headers.forEach((h) => {
        const normalized = h.toLowerCase().replace(/[^a-z0-9]/g, "");
        // Special aliases for common CSV headers
        const aliases: Record<string, string> = {
          "job": "job_number", "jobno": "job_number", "jobnumber": "job_number",
          "invoiceno": "invoice_number", "invoice": "invoice_number",
          "invoicenum": "invoice_number", "inv": "invoice_number",
        };
        const aliasMatch = aliases[normalized];
        const match = aliasMatch && allDbColumns.includes(aliasMatch)
          ? aliasMatch
          : allDbColumns.find((col) => {
              const normCol = col.toLowerCase().replace(/_/g, "");
              return normalized.includes(normCol) || normCol.includes(normalized);
            });
        if (match) autoMap[h] = match;
      });
      setColumnMap(autoMap);
    };
    reader.readAsText(file);
  }, [target]);

  const getCellValue = (rowIdx: number, colIdx: number): string => {
    const key = `${rowIdx}-${colIdx}`;
    if (editedData[key] !== undefined) return editedData[key];
    return csvData?.rows[rowIdx]?.[colIdx] ?? "";
  };

  const setCellValue = (rowIdx: number, colIdx: number, value: string) => {
    setEditedData((prev) => ({ ...prev, [`${rowIdx}-${colIdx}`]: value }));
  };

  const mappedColumns = useMemo(() => {
    if (!csvData) return [];
    return csvData.headers.map((h, i) => ({
      csvIndex: i,
      csvHeader: h,
      dbColumn: columnMap[h] || "",
    }));
  }, [csvData, columnMap]);

  const missingRequired = config.requiredColumns.filter(
    (req) => !Object.values(columnMap).includes(req)
  );

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!csvData || missingRequired.length > 0) throw new Error("Missing required column mappings");
      
      const rowsToImport = Array.from(selectedRows).sort();
      if (rowsToImport.length === 0) throw new Error("No rows selected");

      let records = rowsToImport.map((rowIdx) => {
        const record: Record<string, any> = {};
        mappedColumns.forEach((mc) => {
          if (mc.dbColumn) {
            let val: any = getCellValue(rowIdx, mc.csvIndex);
            if (["budget", "amount", "paid", "rate", "cost"].includes(mc.dbColumn)) {
              val = parseMoney(val);
            }
            if (mc.dbColumn === "active") {
              val = val.toLowerCase() !== "false" && val !== "0" && val.toLowerCase() !== "no";
            }
            record[mc.dbColumn] = val;
          }
        });
        return record;
      });

      // For vendor_invoices: resolve vendor names → IDs, job numbers → IDs
      if (target === "vendor_invoices") {
        // Build lookup maps (case-insensitive)
        const vendorMap = new Map(vendors.map((v: any) => [v.name.toLowerCase().trim(), v.id]));
        const jobMap = new Map(jobs.map((j: any) => [j.job_number.toLowerCase().trim(), j.id]));

        const missingVendors = new Set<string>();
        const missingJobs: { number: string; client: string }[] = [];
        const seenMissingJobs = new Set<string>();

        // First pass: identify missing vendors and jobs
        for (const rec of records) {
          const vendorName = (rec.vendor || "").trim();
          if (vendorName && !vendorMap.has(vendorName.toLowerCase())) {
            missingVendors.add(vendorName);
          }
          const jobNum = (rec.job_number || "").trim();
          if (jobNum && !jobMap.has(jobNum.toLowerCase()) && !seenMissingJobs.has(jobNum.toLowerCase())) {
            seenMissingJobs.add(jobNum.toLowerCase());
            missingJobs.push({ number: jobNum, client: (rec.client || "").trim() });
          }
        }

        // Auto-create missing vendors
        if (missingVendors.size > 0) {
          const newVendors = Array.from(missingVendors).map((name) => ({ name }));
          const { data: created, error } = await supabase.from("vendors").insert(newVendors).select("id,name");
          if (error) throw new Error(`Failed to create vendors: ${error.message}`);
          created?.forEach((v: any) => vendorMap.set(v.name.toLowerCase().trim(), v.id));
          toast.info(`Auto-created ${missingVendors.size} new vendor(s)`);
        }

        // Auto-create missing jobs
        if (missingJobs.length > 0) {
          const newJobs = missingJobs.map((j) => ({
            job_number: j.number,
            name: j.number,
            client: j.client || "",
          }));
          const { data: created, error } = await supabase.from("jobs").insert(newJobs).select("id,job_number");
          if (error) throw new Error(`Failed to create jobs: ${error.message}`);
          created?.forEach((j: any) => jobMap.set(j.job_number.toLowerCase().trim(), j.id));
          toast.info(`Auto-created ${missingJobs.length} new job(s)`);
        }

        // Resolve names to IDs in each record
        for (const rec of records) {
          const vendorName = (rec.vendor || "").trim();
          rec.vendor_id = vendorMap.get(vendorName.toLowerCase()) || null;
          delete rec.vendor;

          const jobNum = (rec.job_number || "").trim();
          if (jobNum) {
            rec.job_id = jobMap.get(jobNum.toLowerCase()) || null;
          }
          delete rec.job_number;
          delete rec.client; // client is used for job creation, not stored on invoice

          if (!rec.vendor_id) {
            throw new Error(`Could not resolve vendor: "${vendorName}"`);
          }
        }
      }

      // For job_invoices: resolve job_number → job_id
      if (target === "job_invoices") {
        const jobMap = new Map(jobs.map((j: any) => [j.job_number.toLowerCase().trim(), j.id]));
        const missingJobs: { number: string; client: string }[] = [];
        const seenMissingJobs = new Set<string>();

        for (const rec of records) {
          const jobNum = (rec.job_number || "").trim();
          if (jobNum && !jobMap.has(jobNum.toLowerCase()) && !seenMissingJobs.has(jobNum.toLowerCase())) {
            seenMissingJobs.add(jobNum.toLowerCase());
            missingJobs.push({ number: jobNum, client: (rec.client || "").trim() });
          }
        }

        if (missingJobs.length > 0) {
          const newJobs = missingJobs.map((j) => ({
            job_number: j.number,
            name: j.number,
            client: j.client || "",
          }));
          const { data: created, error } = await supabase.from("jobs").insert(newJobs).select("id,job_number");
          if (error) throw new Error(`Failed to create jobs: ${error.message}`);
          created?.forEach((j: any) => jobMap.set(j.job_number.toLowerCase().trim(), j.id));
          toast.info(`Auto-created ${missingJobs.length} new job(s)`);
        }

        for (const rec of records) {
          const jobNum = (rec.job_number || "").trim();
          if (jobNum) {
            rec.job_id = jobMap.get(jobNum.toLowerCase()) || null;
          }
          delete rec.job_number;
        }
      }

      // For vendor_invoices, skip duplicates by invoice_no
      if (target === "vendor_invoices") {
        const invoiceNos = records.map((r) => r.invoice_no).filter(Boolean);
        if (invoiceNos.length > 0) {
          const { data: existing } = await supabase
            .from("vendor_invoices")
            .select("invoice_no")
            .in("invoice_no", invoiceNos);
          const existingSet = new Set((existing || []).map((e: any) => e.invoice_no));
          const before = records.length;
          records = records.filter((r) => !existingSet.has(r.invoice_no));
          const skipped = before - records.length;
          if (skipped > 0) toast.info(`Skipped ${skipped} duplicate invoice(s)`);
        }
      }

      // Batch insert in chunks of 100
      const chunkSize = 100;
      for (let i = 0; i < records.length; i += chunkSize) {
        const chunk = records.slice(i, i + chunkSize);
        const { error } = await supabase.from(target).insert(chunk);
        if (error) throw error;
      }

      return records.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries();
      toast.success(`Imported ${count} records into ${config.label}`);
      setCsvData(null);
      setFileName("");
      setSelectedRows(new Set());
      setEditedData({});
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleAll = () => {
    if (!csvData) return;
    if (selectedRows.size === csvData.rows.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(csvData.rows.map((_, i) => i)));
    }
  };

  const toggleRow = (idx: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        title="CSV Import"
        description="Import data from QuickBooks or other CSV exports with preview and selection"
      />

      {/* Step 1: Select target and upload */}
      <div className="glass-card rounded-xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-card-foreground">1. Select Import Target & Upload File</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Import Into</Label>
            <Select value={target} onValueChange={(v) => { setTarget(v as ImportTarget); setCsvData(null); setFileName(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(TARGET_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">{config.description}</p>
          </div>
          <div className="md:col-span-2">
            <Label>CSV File</Label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 px-4 py-2 border border-dashed border-border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                <Upload className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{fileName || "Choose CSV file..."}</span>
                <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
              </label>
              {csvData && (
                <span className="text-sm text-muted-foreground">
                  <FileSpreadsheet className="w-4 h-4 inline mr-1" />
                  {csvData.rows.length} rows, {csvData.headers.length} columns
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Step 2: Column mapping */}
      {csvData && (
        <div className="glass-card rounded-xl p-6 space-y-4">
          <h3 className="text-lg font-semibold text-card-foreground">2. Map Columns</h3>
          <p className="text-sm text-muted-foreground">Match your CSV headers to database fields. Required fields are marked with *</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {csvData.headers.map((header) => (
              <div key={header} className="space-y-1">
                <Label className="text-xs font-mono truncate block" title={header}>{header}</Label>
                <Select value={columnMap[header] || "__skip__"} onValueChange={(v) => setColumnMap((prev) => {
                  const next = { ...prev };
                  if (v === "__skip__") delete next[header];
                  else next[header] = v;
                  return next;
                })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__skip__">— Skip —</SelectItem>
                    {allDbColumns.map((col) => (
                      <SelectItem key={col} value={col}>
                        {config.requiredColumns.includes(col) ? `${col} *` : col}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {missingRequired.length > 0 && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="w-4 h-4" />
              Missing required mappings: {missingRequired.join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Preview and select rows */}
      {csvData && missingRequired.length === 0 && (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="text-lg font-semibold text-card-foreground">
              3. Preview & Select Rows
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({selectedRows.size} of {csvData.rows.length} selected)
              </span>
            </h3>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={toggleAll}>
                {selectedRows.size === csvData.rows.length ? "Deselect All" : "Select All"}
              </Button>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending || selectedRows.size === 0}
              >
                <Check className="w-4 h-4 mr-2" />
                Import {selectedRows.size} Rows
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-3 py-2 text-left w-10">
                    <Checkbox
                      checked={selectedRows.size === csvData.rows.length}
                      onCheckedChange={toggleAll}
                    />
                  </th>
                  <th className="px-3 py-2 text-left text-muted-foreground font-medium w-10">#</th>
                  {mappedColumns.filter((m) => m.dbColumn).map((mc) => (
                    <th key={mc.csvIndex} className="px-3 py-2 text-left font-medium text-muted-foreground">
                      <div className="text-xs">{mc.csvHeader}</div>
                      <div className="text-[10px] font-mono text-primary">→ {mc.dbColumn}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvData.rows.map((row, rowIdx) => {
                  const isSelected = selectedRows.has(rowIdx);
                  return (
                    <tr
                      key={rowIdx}
                      className={cn(
                        "border-b border-border/50 transition-colors",
                        isSelected ? "bg-background" : "bg-muted/20 opacity-50"
                      )}
                    >
                      <td className="px-3 py-1.5">
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleRow(rowIdx)} />
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground text-xs">{rowIdx + 1}</td>
                      {mappedColumns.filter((m) => m.dbColumn).map((mc) => {
                        const isEditing = editingCell?.row === rowIdx && editingCell?.col === mc.csvIndex;
                        const value = getCellValue(rowIdx, mc.csvIndex);
                        const wasEdited = editedData[`${rowIdx}-${mc.csvIndex}`] !== undefined;
                        return (
                          <td
                            key={mc.csvIndex}
                            className={cn("px-3 py-1.5 cursor-pointer group", wasEdited && "bg-accent/30")}
                            onClick={() => setEditingCell({ row: rowIdx, col: mc.csvIndex })}
                          >
                            {isEditing ? (
                              <Input
                                className="h-7 text-xs"
                                defaultValue={value}
                                autoFocus
                                onBlur={(e) => {
                                  setCellValue(rowIdx, mc.csvIndex, e.target.value);
                                  setEditingCell(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    setCellValue(rowIdx, mc.csvIndex, (e.target as HTMLInputElement).value);
                                    setEditingCell(null);
                                  }
                                  if (e.key === "Escape") setEditingCell(null);
                                }}
                              />
                            ) : (
                              <span className="text-card-foreground text-xs">
                                {value || <span className="text-muted-foreground italic">empty</span>}
                                <Edit2 className="w-3 h-3 inline ml-1 opacity-0 group-hover:opacity-40" />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!csvData && (
        <div className="glass-card rounded-xl p-12 text-center">
          <FileSpreadsheet className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium text-card-foreground mb-2">No file loaded</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Select your import target above, then upload a CSV file exported from QuickBooks or another system. 
            You'll be able to preview all rows, map columns, edit values, and select exactly which records to import.
          </p>
        </div>
      )}
    </div>
  );
}
