import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, Upload, Loader2, FileText, Download } from "lucide-react";
import { parseMoney } from "@/lib/utils";
import { toast } from "sonner";
import { useMutation as useRqMutation } from "@tanstack/react-query";
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs`;

const TAX_TYPES = [
  { value: "federal", label: "Federal Income Tax" },
  { value: "state", label: "State Income Tax" },
  { value: "fica_ss", label: "FICA - Social Security" },
  { value: "fica_medicare", label: "FICA - Medicare" },
  { value: "futa", label: "FUTA" },
  { value: "suta", label: "SUTA" },
  { value: "ett", label: "ETT" },
  { value: "sdi", label: "SDI" },
];

const METHODS = [
  { value: "percentage", label: "Percentage" },
  { value: "wage_bracket", label: "Wage Bracket" },
];

const PAY_PERIODS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "semimonthly", label: "Semimonthly" },
  { value: "monthly", label: "Monthly" },
];

export default function TaxSettings() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState({
    tax_type: "federal",
    bracket_min: "",
    bracket_max: "",
    rate: "",
    withholding_amount: "",
    filing_status: "single",
    effective_year: "2026",
    description: "",
    allowances: "0",
    method: "percentage",
    pay_period: "weekly",
  });

  // Import state
  const [importForm, setImportForm] = useState({
    content: "",
    tax_type: "federal",
    effective_year: "2026",
    state_name: "",
  });
  const [importPreview, setImportPreview] = useState<any[] | null>(null);
  const [importSummary, setImportSummary] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfFileName, setPdfFileName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fetchingSource, setFetchingSource] = useState<string | null>(null);

  // Fetch latest IRS/CA PDF, extract text, populate import dialog
  const fetchAndParse = useCallback(async (source: "federal" | "california") => {
    setFetchingSource(source);
    try {
      toast.info(`Fetching ${source === "federal" ? "IRS Pub 15-T" : "CA DE 44"} PDF…`);
      const { data, error } = await supabase.functions.invoke("fetch-tax-pdfs", {
        body: { source },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Fetch failed");

      toast.info(`Downloaded ${data.size_kb}KB — extracting text…`);

      // Decode base64 to Uint8Array
      const binaryStr = atob(data.pdf_base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Extract text with pdf.js
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const textParts: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str).join(" ");
        textParts.push(pageText);
      }
      const fullText = textParts.join("\n\n");

      // Pre-populate import dialog
      setImportForm({
        content: fullText,
        tax_type: data.tax_type,
        effective_year: String(new Date().getFullYear()),
        state_name: data.state_name || "",
      });
      setPdfFileName(data.label);
      setImportOpen(true);
      toast.success(`Extracted text from ${pdf.numPages} pages — click "Parse with AI" to extract brackets`);
    } catch (err: any) {
      console.error("Fetch tax PDF error:", err);
      toast.error(err.message || "Failed to fetch tax PDF");
    } finally {
      setFetchingSource(null);
    }
  }, []);

  const extractTextFromPdf = useCallback(async (file: File) => {
    setPdfLoading(true);
    setPdfFileName(file.name);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const textParts: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str).join(" ");
        textParts.push(pageText);
      }
      const fullText = textParts.join("\n\n");
      setImportForm((prev) => ({ ...prev, content: fullText }));
      toast.success(`Extracted text from ${pdf.numPages} pages`);
    } catch (err) {
      console.error("PDF parse error:", err);
      toast.error("Failed to read PDF. Try pasting the text instead.");
    } finally {
      setPdfLoading(false);
    }
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.type === "application/pdf") {
      extractTextFromPdf(file);
    } else {
      toast.error("Please drop a PDF file");
    }
  }, [extractTextFromPdf]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) extractTextFromPdf(file);
  }, [extractTextFromPdf]);

  const { data: settings = [], isLoading } = useQuery({
    queryKey: ["tax-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tax_settings").select("*").order("tax_type").order("method").order("pay_period").order("filing_status").order("allowances").order("bracket_min");
      if (error) throw error;
      return data;
    },
  });

  const createSetting = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("tax_settings").insert({
        tax_type: form.tax_type,
        bracket_min: parseMoney(form.bracket_min),
        bracket_max: form.bracket_max ? parseMoney(form.bracket_max) : null,
        rate: parseFloat(form.rate) || 0,
        withholding_amount: parseMoney(form.withholding_amount),
        filing_status: form.filing_status,
        effective_year: parseInt(form.effective_year) || 2026,
        description: form.description,
        allowances: parseInt(form.allowances) || 0,
        method: form.method,
        pay_period: form.pay_period,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-settings"] });
      setDialogOpen(false);
      setForm({ tax_type: "federal", bracket_min: "", bracket_max: "", rate: "", withholding_amount: "", filing_status: "single", effective_year: "2026", description: "", allowances: "0", method: "percentage", pay_period: "weekly" });
      toast.success("Tax setting saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteSetting = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tax_settings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-settings"] });
      toast.success("Deleted");
    },
  });

  const [parseJobId, setParseJobId] = useState<string | null>(null);
  const [parsePolling, setParsePolling] = useState(false);

  // Poll for job completion
  const pollForResult = useCallback(async (jobId: string) => {
    setParsePolling(true);
    const maxAttempts = 60; // 2 minutes max
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const { data, error } = await supabase.functions.invoke("parse-tax-tables", {
          body: { job_id: jobId },
        });
        if (error) throw error;
        if (data?.status === "complete") {
          const result = data.result;
          setImportPreview(result.brackets || []);
          setImportSummary(result.summary || "");
          toast.success(`Parsed ${result.brackets?.length || 0} brackets`);
          setParsePolling(false);
          setParseJobId(null);
          return;
        }
        if (data?.status === "failed") {
          toast.error(data.error || "Parse failed");
          setParsePolling(false);
          setParseJobId(null);
          return;
        }
        // still processing, continue polling
      } catch (err) {
        console.error("Poll error:", err);
      }
    }
    toast.error("Parsing timed out. The document may be too large — try pasting just the relevant tables.");
    setParsePolling(false);
    setParseJobId(null);
  }, []);

  // AI Parse mutation - now creates a background job
  const parseMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("parse-tax-tables", {
        body: {
          content: importForm.content,
          tax_type: importForm.tax_type,
          effective_year: importForm.effective_year,
          state_name: importForm.state_name,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Parse failed");
      return data.job_id;
    },
    onSuccess: (jobId: string) => {
      setParseJobId(jobId);
      toast.info("Parsing started — this may take up to a minute for large documents...");
      pollForResult(jobId);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Bulk insert parsed brackets
  const bulkInsertMutation = useMutation({
    mutationFn: async () => {
      if (!importPreview?.length) throw new Error("Nothing to import");
      const rows = importPreview.map((b: any) => ({
        tax_type: importForm.tax_type,
        bracket_min: b.bracket_min || 0,
        bracket_max: b.bracket_max ?? null,
        rate: b.rate || 0,
        withholding_amount: b.withholding_amount || 0,
        filing_status: b.filing_status || "single",
        effective_year: parseInt(importForm.effective_year) || 2026,
        description: b.description || "",
        allowances: b.allowances || 0,
        method: b.method || "percentage",
        pay_period: b.pay_period || "weekly",
      }));
      const { error } = await supabase.from("tax_settings").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-settings"] });
      setImportOpen(false);
      setImportPreview(null);
      setImportSummary("");
      setImportForm({ content: "", tax_type: "federal", effective_year: "2026", state_name: "" });
      toast.success("Tax brackets imported successfully!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const renderTable = (taxType: string) => {
    const filtered = settings.filter((s: any) => s.tax_type === taxType);
    const isWageBracket = filtered.some((s: any) => s.method === "wage_bracket");

    return (
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Method</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Period</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Allow.</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Min</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Max</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Rate %</th>
                {isWageBracket && <th className="text-right px-4 py-3 font-medium text-muted-foreground">W/H Amt</th>}
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Year</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={isWageBracket ? 11 : 10} className="px-6 py-8 text-center text-muted-foreground">No settings. Add brackets manually or import from IRS/state tables.</td></tr>
              ) : filtered.map((s: any) => (
                <tr key={s.id} className="table-row-hover border-b border-border/50">
                  <td className="px-4 py-3 text-card-foreground">{s.description}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{s.method === "wage_bracket" ? "Wage Bracket" : "Percentage"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs capitalize">{s.pay_period}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{s.filing_status}</td>
                  <td className="px-4 py-3 text-center font-mono text-card-foreground">{s.allowances}</td>
                  <td className="px-4 py-3 text-right font-mono text-card-foreground">${(s.bracket_min || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono text-card-foreground">{s.bracket_max ? `$${s.bracket_max.toLocaleString()}` : "∞"}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium text-primary">{(s.rate * 100).toFixed(2)}%</td>
                  {isWageBracket && <td className="px-4 py-3 text-right font-mono text-card-foreground">${(s.withholding_amount || 0).toFixed(2)}</td>}
                  <td className="px-4 py-3 text-center text-muted-foreground">{s.effective_year}</td>
                  <td className="px-4 py-3 text-center">
                    <Button variant="ghost" size="sm" onClick={() => deleteSetting.mutate(s.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="p-8">
      <PageHeader
        title="Tax Settings"
        description="Configure federal, state tax tables and FICA rates for payroll. Supports percentage and wage bracket methods with withholding allowances."
        actions={
          <div className="flex gap-2 flex-wrap">
            {/* Fetch Latest Buttons */}
            <Button
              variant="outline"
              disabled={fetchingSource !== null}
              onClick={() => fetchAndParse("federal")}
            >
              {fetchingSource === "federal" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Fetch IRS 15-T
            </Button>
            <Button
              variant="outline"
              disabled={fetchingSource !== null}
              onClick={() => fetchAndParse("california")}
            >
              {fetchingSource === "california" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Fetch CA DE 44
            </Button>
            {/* Import Dialog */}
            <Dialog open={importOpen} onOpenChange={(o) => { setImportOpen(o); if (!o) { setImportPreview(null); setImportSummary(""); setPdfFileName(""); } }}>
              <DialogTrigger asChild>
                <Button variant="outline"><Upload className="w-4 h-4 mr-2" />Import Tax Tables</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Import Tax Tables via AI</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">
                  Paste the text from IRS Publication 15-T or your state withholding guide below. AI will extract the brackets automatically.
                </p>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Tax Type</Label>
                      <Select value={importForm.tax_type} onValueChange={(v) => setImportForm({ ...importForm, tax_type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TAX_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Year</Label>
                      <Input type="number" value={importForm.effective_year} onChange={(e) => setImportForm({ ...importForm, effective_year: e.target.value })} />
                    </div>
                    <div>
                      <Label>State (if applicable)</Label>
                      <Input placeholder="e.g. California" value={importForm.state_name} onChange={(e) => setImportForm({ ...importForm, state_name: e.target.value })} />
                    </div>
                  </div>

                  {/* PDF Drop Zone */}
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                      isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileSelect} />
                    {pdfLoading ? (
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Extracting text from PDF…</span>
                      </div>
                    ) : pdfFileName ? (
                      <div className="flex items-center justify-center gap-2 text-primary">
                        <FileText className="w-5 h-5" />
                        <span className="font-medium">{pdfFileName}</span>
                        <span className="text-muted-foreground text-xs">— text extracted, click Parse below</span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                        <p className="text-sm font-medium text-card-foreground">Drop IRS or state PDF here</p>
                        <p className="text-xs text-muted-foreground">or click to browse • PDF text will be extracted automatically</p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">or paste text manually</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>

                  <div>
                    <Label>Paste Tax Table Content</Label>
                    <Textarea
                      rows={8}
                      placeholder="Paste the tax withholding table text here (from IRS Pub 15-T, state withholding PDF, etc.)..."
                      value={importForm.content}
                      onChange={(e) => setImportForm({ ...importForm, content: e.target.value })}
                    />
                  </div>

                  <Button onClick={() => parseMutation.mutate()} disabled={parseMutation.isPending || parsePolling || !importForm.content.trim()}>
                    {parseMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</>
                    ) : parsePolling ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />AI is parsing… this may take a minute</>
                    ) : (
                      "Parse with AI"
                    )}
                  </Button>

                  {/* Preview */}
                  {importSummary && (
                    <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
                      <strong>AI Summary:</strong> {importSummary}
                    </div>
                  )}

                  {importPreview && importPreview.length > 0 && (
                    <>
                      <div className="text-sm font-medium">Preview: {importPreview.length} brackets extracted</div>
                      <div className="max-h-60 overflow-y-auto border rounded-lg">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-muted">
                            <tr>
                              <th className="px-2 py-1 text-left">Description</th>
                              <th className="px-2 py-1 text-left">Method</th>
                              <th className="px-2 py-1 text-left">Period</th>
                              <th className="px-2 py-1 text-left">Status</th>
                              <th className="px-2 py-1 text-center">Allow.</th>
                              <th className="px-2 py-1 text-right">Min</th>
                              <th className="px-2 py-1 text-right">Max</th>
                              <th className="px-2 py-1 text-right">Rate</th>
                              <th className="px-2 py-1 text-right">W/H Amt</th>
                            </tr>
                          </thead>
                          <tbody>
                            {importPreview.map((b: any, i: number) => (
                              <tr key={i} className="border-t border-border/50">
                                <td className="px-2 py-1">{b.description}</td>
                                <td className="px-2 py-1">{b.method}</td>
                                <td className="px-2 py-1">{b.pay_period}</td>
                                <td className="px-2 py-1">{b.filing_status}</td>
                                <td className="px-2 py-1 text-center">{b.allowances || 0}</td>
                                <td className="px-2 py-1 text-right font-mono">${(b.bracket_min || 0).toLocaleString()}</td>
                                <td className="px-2 py-1 text-right font-mono">{b.bracket_max ? `$${b.bracket_max.toLocaleString()}` : "∞"}</td>
                                <td className="px-2 py-1 text-right font-mono">{((b.rate || 0) * 100).toFixed(2)}%</td>
                                <td className="px-2 py-1 text-right font-mono">${(b.withholding_amount || 0).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Button onClick={() => bulkInsertMutation.mutate()} disabled={bulkInsertMutation.isPending}>
                        {bulkInsertMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Importing…</> : `Import ${importPreview.length} Brackets`}
                      </Button>
                    </>
                  )}
                </div>
              </DialogContent>
            </Dialog>

            {/* Manual Add Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4 mr-2" />Add Tax Bracket</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Tax Setting</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Tax Type</Label>
                      <Select value={form.tax_type} onValueChange={(v) => setForm({ ...form, tax_type: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {TAX_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Method</Label>
                      <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div><Label>Description</Label><Input placeholder="e.g. 10% bracket" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Bracket Min ($)</Label><Input type="number" value={form.bracket_min} onChange={(e) => setForm({ ...form, bracket_min: e.target.value })} /></div>
                    <div><Label>Bracket Max ($)</Label><Input type="number" placeholder="∞" value={form.bracket_max} onChange={(e) => setForm({ ...form, bracket_max: e.target.value })} /></div>
                    <div><Label>Rate (decimal)</Label><Input type="number" step="0.0001" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Filing Status</Label>
                      <Select value={form.filing_status} onValueChange={(v) => setForm({ ...form, filing_status: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="single">Single</SelectItem>
                          <SelectItem value="married">Married</SelectItem>
                          <SelectItem value="all">All</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Pay Period</Label>
                      <Select value={form.pay_period} onValueChange={(v) => setForm({ ...form, pay_period: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PAY_PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Allowances</Label><Input type="number" min="0" value={form.allowances} onChange={(e) => setForm({ ...form, allowances: e.target.value })} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>W/H Amount ($)</Label><Input type="number" step="0.01" placeholder="For wage bracket" value={form.withholding_amount} onChange={(e) => setForm({ ...form, withholding_amount: e.target.value })} /></div>
                    <div><Label>Year</Label><Input type="number" value={form.effective_year} onChange={(e) => setForm({ ...form, effective_year: e.target.value })} /></div>
                  </div>
                  <Button onClick={() => createSetting.mutate()} disabled={createSetting.isPending}>Save Setting</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Tabs defaultValue="federal">
        <TabsList className="mb-6 flex-wrap">
          {TAX_TYPES.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {TAX_TYPES.map((t) => (
          <TabsContent key={t.value} value={t.value}>{renderTable(t.value)}</TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
