import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, FileText, Check, AlertCircle, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn, parseMoney } from "@/lib/utils";
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

interface ParsedInvoice {
  vendor_name: string;
  invoice_number: string;
  amount: number;
  date: string | null;
  due_date: string | null;
  description: string | null;
  // Resolved fields
  vendor_id?: string;
  job_id?: string;
  selected?: boolean;
  isDuplicate?: boolean;
}

export default function InvoicePdfImport() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [invoices, setInvoices] = useState<ParsedInvoice[]>([]);
  const [fileName, setFileName] = useState("");

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("id, job_number, name").eq("status", "active").order("job_number");
      if (error) throw error;
      return data;
    },
  });

  const extractPdfText = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: string[] = [];
    const totalPages = Math.min(pdf.numPages, 20); // Limit to 20 pages
    for (let i = 1; i <= totalPages; i++) {
      setProgress((i / totalPages) * 40);
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((item: any) => item.str).join(" "));
    }
    return pages.join("\n\n--- Page Break ---\n\n");
  };

  const processPdf = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Please upload a PDF file");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large (max 20MB)");
      return;
    }

    setFileName(file.name);
    setParsing(true);
    setProgress(0);
    setInvoices([]);

    try {
      // Step 1: Extract text from PDF
      setProgressLabel("Extracting text from PDF...");
      const pdfText = await extractPdfText(file);

      if (pdfText.trim().length < 20) {
        toast.error("Could not extract text from PDF. It may be a scanned image.");
        setParsing(false);
        return;
      }

      // Step 2: Send to AI for parsing
      setProgress(50);
      setProgressLabel("AI is reading the invoice...");
      const vendorNames = vendors.map((v) => v.name);

      const { data, error } = await supabase.functions.invoke("parse-vendor-invoice", {
        body: { pdfText, vendorNames },
      });

      if (error) throw new Error(error.message || "Failed to parse invoice");
      if (data?.error) throw new Error(data.error);

      setProgress(90);
      setProgressLabel("Checking for duplicates...");

      // Fetch existing invoice numbers to check for duplicates
      const { data: existingInvoices } = await supabase
        .from("vendor_invoices")
        .select("invoice_no, vendor_id");
      const existingSet = new Set(
        (existingInvoices || []).map((ei) => `${ei.vendor_id}::${ei.invoice_no.toLowerCase()}`)
      );

      const parsed: ParsedInvoice[] = (data.invoices || []).map((inv: any) => {
        const matchedVendor = vendors.find(
          (v) => v.name.toLowerCase() === inv.vendor_name?.toLowerCase()
        ) || vendors.find(
          (v) => v.name.toLowerCase().includes(inv.vendor_name?.toLowerCase()) ||
                 inv.vendor_name?.toLowerCase().includes(v.name.toLowerCase())
        );

        const vendorId = matchedVendor?.id || "";
        const invoiceNo = (inv.invoice_number || "").toLowerCase();
        const isDuplicate = vendorId && invoiceNo
          ? existingSet.has(`${vendorId}::${invoiceNo}`)
          : false;

        return {
          ...inv,
          amount: parseMoney(inv.amount),
          vendor_id: vendorId,
          selected: true,
          isDuplicate,
        };
      });

      setInvoices(parsed);
      setProgress(100);
      setProgressLabel("Done!");

      const dupeCount = parsed.filter((p) => p.isDuplicate).length;
      if (parsed.length === 0) {
        toast.warning("No invoices found in this PDF");
      } else if (dupeCount > 0) {
        toast.warning(`Found ${parsed.length} invoice(s), ${dupeCount} possible duplicate(s)`);
      } else {
        toast.success(`Found ${parsed.length} invoice(s)`);
      }
    } catch (err: any) {
      console.error("PDF parse error:", err);
      toast.error(err.message || "Failed to parse PDF");
    } finally {
      setParsing(false);
    }
  }, [vendors]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processPdf(file);
  }, [processPdf]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processPdf(file);
    if (e.target) e.target.value = "";
  }, [processPdf]);

  const updateInvoice = (idx: number, updates: Partial<ParsedInvoice>) => {
    setInvoices((prev) => prev.map((inv, i) => (i === idx ? { ...inv, ...updates } : inv)));
  };

  const importMutation = useMutation({
    mutationFn: async () => {
      const toImport = invoices.filter((inv) => inv.selected && inv.vendor_id);
      if (toImport.length === 0) throw new Error("No invoices selected or vendors unmatched");

      const records = toImport.map((inv) => ({
        vendor_id: inv.vendor_id!,
        invoice_no: inv.invoice_number || "",
        amount: inv.amount,
        date: inv.date || new Date().toISOString().split("T")[0],
        due_date: inv.due_date || null,
        job_id: inv.job_id || null,
        status: "open",
      }));

      const { error } = await supabase.from("vendor_invoices").insert(records);
      if (error) throw error;
      return records.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
      toast.success(`Imported ${count} invoice(s) into Vendor AP`);
      setInvoices([]);
      setFileName("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const selectedCount = invoices.filter((i) => i.selected).length;
  const unmatchedCount = invoices.filter((i) => i.selected && !i.vendor_id).length;

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        title="Invoice PDF Import"
        description="Drop a vendor invoice PDF to extract and import invoice data automatically"
      />

      {/* Drop zone */}
      <div
        className={cn(
          "glass-card rounded-xl p-12 text-center border-2 border-dashed transition-all duration-200 cursor-pointer",
          dragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/50",
          parsing && "pointer-events-none opacity-60"
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />

        {parsing ? (
          <div className="space-y-4 max-w-md mx-auto">
            <Loader2 className="w-10 h-10 mx-auto text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">{progressLabel}</p>
            <Progress value={progress} className="h-2" />
          </div>
        ) : (
          <>
            <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-card-foreground mb-2">
              {fileName ? `Loaded: ${fileName}` : "Drop Invoice PDF Here"}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Drag & drop a vendor invoice PDF, or click to browse.
              AI will extract the vendor name, invoice number, amount, dates, and more.
            </p>
          </>
        )}
      </div>

      {/* Parsed results */}
      {invoices.length > 0 && (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="text-lg font-semibold text-card-foreground">
              Extracted Invoices
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({selectedCount} selected)
              </span>
            </h3>
            <div className="flex items-center gap-3">
              {unmatchedCount > 0 && (
                <div className="flex items-center gap-1 text-destructive text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {unmatchedCount} unmatched vendor(s)
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setInvoices([]); setFileName(""); }}
              >
                <Trash2 className="w-4 h-4 mr-1" /> Clear
              </Button>
              <Button
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending || selectedCount === 0 || unmatchedCount > 0}
              >
                <Check className="w-4 h-4 mr-2" />
                Import {selectedCount} Invoice(s)
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-3 py-2 text-left w-10">✓</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Vendor</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Invoice #</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Due Date</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Job</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Description</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv, idx) => (
                  <tr key={idx} className={cn("border-b border-border/50", !inv.selected && "opacity-40")}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={inv.selected}
                        onChange={(e) => updateInvoice(idx, { selected: e.target.checked })}
                        className="rounded"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={inv.vendor_id || "__none__"}
                        onValueChange={(v) => updateInvoice(idx, { vendor_id: v === "__none__" ? "" : v })}
                      >
                        <SelectTrigger className={cn("h-8 text-xs w-44", !inv.vendor_id && "border-destructive")}>
                          <SelectValue placeholder="Select vendor" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Select vendor —</SelectItem>
                          {vendors.map((v) => (
                            <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {inv.vendor_name && !inv.vendor_id && (
                        <p className="text-[10px] text-destructive mt-0.5">AI found: "{inv.vendor_name}"</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        className="h-8 text-xs w-28"
                        value={inv.invoice_number}
                        onChange={(e) => updateInvoice(idx, { invoice_number: e.target.value })}
                      />
                      {inv.isDuplicate && (
                        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> Duplicate invoice alert
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        className="h-8 text-xs w-24 text-right"
                        type="number"
                        step="0.01"
                        value={inv.amount}
                        onChange={(e) => updateInvoice(idx, { amount: parseMoney(e.target.value) })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        className="h-8 text-xs w-32"
                        type="date"
                        value={inv.date || ""}
                        onChange={(e) => updateInvoice(idx, { date: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        className="h-8 text-xs w-32"
                        type="date"
                        value={inv.due_date || ""}
                        onChange={(e) => updateInvoice(idx, { due_date: e.target.value })}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Select
                        value={inv.job_id || "__none__"}
                        onValueChange={(v) => updateInvoice(idx, { job_id: v === "__none__" ? "" : v })}
                      >
                        <SelectTrigger className="h-8 text-xs w-36">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— None —</SelectItem>
                          {jobs.map((j) => (
                            <SelectItem key={j.id} value={j.id}>{j.job_number} - {j.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-48 truncate">
                      {inv.description || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
