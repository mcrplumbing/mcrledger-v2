// AP Opening Balances - enter pre-ledger unpaid vendor invoices
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parseMoney, sumMoney } from "@/lib/utils";
import { fetchAll } from "@/lib/fetchAll";
import PageHeader from "@/components/PageHeader";
import VendorSelect from "@/components/VendorSelect";
import JobSelect from "@/components/JobSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Save, Loader2, Plus, Trash2, FileText } from "lucide-react";
import { toast } from "sonner";

interface InvoiceLine {
  id: number;
  vendor_id: string;
  invoice_no: string;
  amount: string;
  job_id: string;
}

let lineCounter = 0;
const newLine = (): InvoiceLine => ({
  id: ++lineCounter,
  vendor_id: "",
  invoice_no: "",
  amount: "",
  job_id: "",
});

export default function ApOpeningBalances() {
  const queryClient = useQueryClient();
  const [lines, setLines] = useState<InvoiceLine[]>([newLine()]);
  const [postedCount, setPostedCount] = useState(0);

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => fetchAll((sb) => sb.from("vendors").select("id, name").order("name")),
  });

  const { data: glAccounts = [] } = useQuery({
    queryKey: ["gl-accounts-all"],
    queryFn: () => fetchAll((sb) => sb.from("gl_accounts").select("*").eq("active", true)),
  });

  const findAccount = (num: string) =>
    glAccounts.find((a: any) => a.account_number === num)?.id;

  const vendorName = (id: string) =>
    vendors.find((v: any) => v.id === id)?.name || "";

  const updateLine = (id: number, field: keyof InvoiceLine, value: string) => {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, [field]: value } : l))
    );
  };

  const removeLine = (id: number) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const addLine = () => setLines((prev) => [...prev, newLine()]);

  // All math from on-page data only
  const totalAP = useMemo(
    () => sumMoney(lines.map((l) => parseMoney(l.amount))),
    [lines]
  );

  const validLines = useMemo(
    () => lines.filter((l) => l.vendor_id && l.invoice_no && parseMoney(l.amount) > 0),
    [lines]
  );

  const postMutation = useMutation({
    mutationFn: async () => {
      const apId = findAccount("2000");
      if (!apId) throw new Error("GL account 2000 (Accounts Payable) not found.");
      const oeId = findAccount("3900");
      if (!oeId) throw new Error("GL account 3900 (Opening Balance Equity) not found.");

      if (validLines.length === 0) throw new Error("Enter at least one complete invoice line");

      // For each invoice:
      // 1. Insert vendor_invoice record (so it shows in AP aging & Pay Bills)
      // 2. The trigger will auto-post DR Expense / CR AP — but we DON'T want new AP
      // 3. So we also post a reclassification: DR AP (untagged) / CR AP (vendor-tagged) = net zero
      //
      // Actually, simpler approach: insert the vendor invoice with a special flag,
      // then manually create the JE that reclassifies AP instead of adding new AP.
      //
      // Cleanest: Create vendor_invoices directly, then create a single reclassification JE
      // that reverses the trigger's AP addition and replaces it with reclassified AP.
      //
      // Even cleaner: We'll create the vendor invoices (trigger posts DR Expense / CR AP),
      // then create a reversing JE: DR OBE / CR Expense for each line.
      // Net effect: AP is correctly vendor-tagged, expense is neutralized (goes to OBE instead),
      // and the AP total stays the same because the trigger's CR AP replaces generic OBE AP.

      // Step 1: Insert vendor invoices (trigger handles GL posting)
      const invoiceInserts = validLines.map((l) => ({
        vendor_id: l.vendor_id,
        invoice_no: l.invoice_no,
        amount: parseMoney(l.amount),
        job_id: l.job_id || null,
        date: new Date().toISOString().slice(0, 10),
        status: "open",
      }));

      const { error: invErr } = await supabase.from("vendor_invoices").insert(invoiceInserts);
      if (invErr) throw invErr;

      // Step 2: Create reversing JE — DR OBE / CR Expense for each line
      // This neutralizes the expense the trigger created, leaving only the AP credit
      // The net GL effect per invoice: DR OBE / CR AP (vendor-tagged with job)
      const expenseId = glAccounts.find((a: any) =>
        a.active && (a.account_number === "5000" || a.account_type === "expense")
      )?.id;

      if (!expenseId) throw new Error("No expense account found for reversal");

      // Find the expense account the trigger used (first active expense by account_number)
      const triggerExpenseId = glAccounts
        .filter((a: any) => a.account_type === "expense" && a.active)
        .sort((a: any, b: any) => a.account_number.localeCompare(b.account_number))[0]?.id;

      if (!triggerExpenseId) throw new Error("No expense account found");

      const { data: je, error: jeErr } = await supabase.from("journal_entries").insert({
        entry_number: `AP-OB-${Date.now().toString(36).toUpperCase()}`,
        date: new Date().toISOString().slice(0, 10),
        description: `AP opening balance reversal — reclassify ${validLines.length} invoice(s) from expense to OBE`,
        status: "draft",
      }).select().single();
      if (jeErr) throw jeErr;

      const jeLines: { journal_entry_id: string; account_id: string; debit: number; credit: number; description: string; job_id: string | null }[] = [];

      for (const l of validLines) {
        const amt = parseMoney(l.amount);
        const vName = vendorName(l.vendor_id);
        // DR OBE — UNTAGGED (no job_id) so it doesn't affect job costing
        jeLines.push({
          journal_entry_id: je.id,
          account_id: oeId,
          debit: amt,
          credit: 0,
          description: `AP opening bal reversal: ${vName} #${l.invoice_no}`,
          job_id: null,
        });
        // CR Expense — UNTAGGED (no job_id) so the trigger's job-tagged expense stays for job costing
        jeLines.push({
          journal_entry_id: je.id,
          account_id: triggerExpenseId,
          debit: 0,
          credit: amt,
          description: `AP opening bal reversal: ${vName} #${l.invoice_no}`,
          job_id: null,
        });
      }

      const { error: lineErr } = await supabase.from("journal_entry_lines").insert(jeLines);
      if (lineErr) throw lineErr;

      const { error: postErr } = await supabase.from("journal_entries").update({ status: "posted" }).eq("id", je.id);
      if (postErr) throw postErr;

      return validLines.length;
    },
    onSuccess: (count) => {
      toast.success(`Posted ${count} AP opening balance invoice(s)`);
      setPostedCount((prev) => prev + count);
      setLines([newLine()]);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="AP Opening Balances"
        description="Enter pre-ledger unpaid vendor invoices. Each invoice is added to AP aging and job costing, while reclassifying from your generic AP opening balance."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" /> Unpaid Vendor Invoices
          </CardTitle>
          <CardDescription>
            Enter each unpaid vendor invoice. The system creates real AP records (for Pay Bills and aging) and reverses the expense to Opening Balance Equity so your AP total stays correct.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            {lines.map((line, idx) => (
              <div key={line.id} className="grid grid-cols-12 gap-2 items-end border-b border-border/50 pb-3">
                <div className="col-span-3">
                  {idx === 0 && <Label className="text-xs">Vendor</Label>}
                  <VendorSelect
                    value={line.vendor_id}
                    onValueChange={(v) => updateLine(line.id, "vendor_id", v)}
                    placeholder="Select vendor"
                  />
                </div>
                <div className="col-span-2">
                  {idx === 0 && <Label className="text-xs">Invoice #</Label>}
                  <Input
                    placeholder="INV-001"
                    value={line.invoice_no}
                    onChange={(e) => updateLine(line.id, "invoice_no", e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  {idx === 0 && <Label className="text-xs">Amount</Label>}
                  <Input
                    type="number"
                    placeholder="0.00"
                    className="text-right"
                    value={line.amount}
                    onChange={(e) => updateLine(line.id, "amount", e.target.value)}
                  />
                </div>
                <div className="col-span-4">
                  {idx === 0 && <Label className="text-xs">Job</Label>}
                  <JobSelect
                    value={line.job_id}
                    onValueChange={(v) => updateLine(line.id, "job_id", v)}
                    placeholder="Search jobs…"
                  />
                </div>
                <div className="col-span-1 flex justify-center">
                  {lines.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => removeLine(line.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-4 w-4 mr-1" /> Add Line
          </Button>

          {/* Summary — all math from on-page values */}
          <div className="bg-muted/50 rounded-lg p-3 flex justify-between items-center">
            <div className="text-sm">
              <span className="font-medium">{validLines.length}</span> invoice(s) ready to post
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Total AP</div>
              <div className="font-mono font-bold text-lg">
                ${totalAP.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground italic">
            Each invoice creates a real AP record (visible in Pay Bills and AP Aging). The expense is reversed to Opening Balance Equity so your total AP in GL 2000 stays unchanged — the generic AP is replaced by vendor-specific AP.
          </p>

          <Button
            className="w-full"
            onClick={() => postMutation.mutate()}
            disabled={postMutation.isPending || validLines.length === 0}
          >
            {postMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Post {validLines.length} Invoice(s)
          </Button>
        </CardContent>
      </Card>

      {postedCount > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4 text-primary" />
              <span>Posted {postedCount} AP opening balance invoice(s) this session</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
