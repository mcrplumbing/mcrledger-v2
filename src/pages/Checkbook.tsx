import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TransactionWithJob } from "@/integrations/supabase/helpers";
import PageHeader from "@/components/PageHeader";
import { parseMoney } from "@/lib/utils";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";

import CheckPrintDialog from "@/components/CheckPrintDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import JobSelect from "@/components/JobSelect";
import { Plus, Search, Pencil, Printer, AlertTriangle, Ban, Trash2 } from "lucide-react";
import { toast } from "sonner";

const defaultForm = () => ({
  date: new Date().toISOString().split("T")[0],
  check_no: "ACH",
  payee: "",
  memo: "",
  category: "",
  type: "payment" as "payment" | "deposit",
  amount: "",
  job_id: "",
  bank_account_id: "",
  gl_account_id: "",
});

export default function Checkbook() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  const [form, setForm] = useState(defaultForm());
  const [selectedAccount, setSelectedAccount] = useState("all");
  const [selectedForPrint, setSelectedForPrint] = useState<Set<string>>(new Set());
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [dupCheckWarning, setDupCheckWarning] = useState("");
  const [voidId, setVoidId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_accounts").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  // Auto-select if only one bank account
  useEffect(() => {
    if (bankAccounts.length === 1 && selectedAccount === "all") {
      setSelectedAccount(bankAccounts[0].id);
    }
  }, [bankAccounts, selectedAccount]);

  const { data: glAccounts = [] } = useQuery({
    queryKey: ["gl-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts").select("*").eq("active", true).order("account_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["transactions-checkbook"],
    queryFn: async () => {
      let allTxns: TransactionWithJob[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("transactions")
          .select("*, jobs(job_number, name), vendor_invoice_id")
          .order("date", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allTxns = allTxns.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return allTxns;
    },
  });

  const resolveLinkedVendorInvoiceIds = async (tx: TransactionWithJob) => {
    if (tx.vendor_invoice_id) return [tx.vendor_invoice_id];

    const singleInvoiceMatch = tx.memo?.match(/^Pay invoice\s+(.+)$/i);
    const multiInvoiceMatch = tx.memo?.match(/^Pay invoices:\s+(.+)$/i);
    const invoiceNos = singleInvoiceMatch
      ? [singleInvoiceMatch[1].trim()]
      : multiInvoiceMatch
        ? multiInvoiceMatch[1].split(",").map((value: string) => value.trim()).filter(Boolean)
        : [];

    if (invoiceNos.length === 0) return [];

    const { data, error } = await supabase.from("vendor_invoices")
      .select("id")
      .in("invoice_no", invoiceNos);
    if (error) throw error;

    return (data || []).map((invoice) => invoice.id);
  };

  const NON_CHECK_LABELS = new Set(["ACH", "EFT", "WIRE", "DEP", "DD", "XFER"]);

  const checkDuplicate = (checkNo: string, bankId: string) => {
    if (!checkNo || NON_CHECK_LABELS.has(checkNo.toUpperCase())) { setDupCheckWarning(""); return; }
    const dup = transactions.find(t =>
      t.check_no === checkNo &&
      t.bank_account_id === bankId &&
      t.id !== editingId
    );
    setDupCheckWarning(dup ? `Warning: Check #${checkNo} already exists for this account (${dup.payee}, ${dup.date})` : "");
  };

  const openEdit = (tx: TransactionWithJob) => {
    setEditingId(tx.id);
    setForm({
      date: tx.date,
      check_no: tx.check_no,
      payee: tx.payee,
      memo: tx.memo,
      category: tx.category,
      type: tx.payment > 0 ? "payment" : "deposit",
      amount: String(tx.payment > 0 ? tx.payment : tx.deposit),
      job_id: tx.job_id || "",
      bank_account_id: tx.bank_account_id || "",
      gl_account_id: tx.gl_account_id || "",
    });
    setDupCheckWarning("");
    setDialogOpen(true);
  };

  const openNew = () => {
    setEditingId(null);
    setForm(defaultForm());
    setDupCheckWarning("");
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const amount = parseMoney(form.amount);
      const bankId = form.bank_account_id || null;

      let checkNo = form.check_no;
      if (!checkNo && form.type === "payment" && bankId) {
        const acct = bankAccounts.find(a => a.id === bankId);
        if (acct) {
          checkNo = String(acct.next_check_number);
          await supabase.from("bank_accounts").update({ next_check_number: acct.next_check_number + 1 }).eq("id", bankId);
        }
      }
      if (!checkNo) checkNo = form.type === "deposit" ? "DEP" : "";

      const row: any = {
        date: form.date,
        check_no: checkNo,
        payee: form.payee,
        memo: form.memo,
        category: form.category,
        job_id: form.job_id || null,
        bank_account_id: bankId,
        deposit: form.type === "deposit" ? amount : 0,
        payment: form.type === "payment" ? amount : 0,
        gl_account_id: form.gl_account_id || null,
      };
      if (editingId) {
        const { error } = await supabase.from("transactions").update(row).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("transactions").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions-checkbook"] });
      queryClient.invalidateQueries({ queryKey: ["job-financials"] });
      setDialogOpen(false);
      toast.success(editingId ? "Transaction updated" : "Transaction saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });


  // Void Check: creates a reversing entry instead of deleting
  const voidMutation = useMutation({
    mutationFn: async (id: string) => {
      const tx = transactions.find(t => t.id === id);
      if (!tx) throw new Error("Transaction not found");

      // Insert a reversing transaction
      const { error } = await supabase.from("transactions").insert({
        date: new Date().toISOString().split("T")[0],
        check_no: `VOID-${tx.check_no || ""}`,
        payee: tx.payee,
        memo: `VOID: ${tx.memo || tx.payee}`,
        category: tx.category,
        job_id: tx.job_id || null,
        bank_account_id: tx.bank_account_id,
        gl_account_id: tx.gl_account_id || null,
        // Reverse: if original was payment, reversal is deposit and vice versa
        deposit: tx.payment || 0,
        payment: tx.deposit || 0,
      });
      if (error) throw error;

      const linkedInvoiceIds = await resolveLinkedVendorInvoiceIds(tx);
      if (linkedInvoiceIds.length > 0) {
        const { error: reopenError } = await supabase.from("vendor_invoices")
          .update({ paid: 0, status: "open" })
          .in("id", linkedInvoiceIds);
        if (reopenError) throw reopenError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions-checkbook"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
      setVoidId(null);
      toast.success("Check voided — reversing entry created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Delete unreconciled check (hard delete — only allowed for unreconciled transactions)
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const tx = transactions.find(t => t.id === id);
      if (!tx) throw new Error("Transaction not found");
      if (tx.reconciled) throw new Error("Cannot delete a reconciled transaction — void it instead");

      const linkedInvoiceIds = await resolveLinkedVendorInvoiceIds(tx);
      if (linkedInvoiceIds.length > 0) {
        const { error: reopenError } = await supabase.from("vendor_invoices")
          .update({ paid: 0, status: "open" })
          .in("id", linkedInvoiceIds);
        if (reopenError) throw reopenError;
      }

      // Delete associated auto-posted journal entry
      const checkNo = tx.check_no || "";
      const entryNumber = `CHK-${checkNo || tx.id.substring(0, 8)}`;
      const { data: je } = await supabase.from("journal_entries")
        .select("id").eq("entry_number", entryNumber).maybeSingle();
      if (je) {
        await supabase.from("journal_entry_lines").delete().eq("journal_entry_id", je.id);
        await supabase.from("journal_entries").delete().eq("id", je.id);
      }

      // Delete the transaction
      const { error } = await supabase.from("transactions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions-checkbook"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
      setDeleteId(null);
      toast.success("Transaction deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = transactions.filter((t) => {
    const matchesSearch = t.payee.toLowerCase().includes(search.toLowerCase()) ||
      t.memo.toLowerCase().includes(search.toLowerCase());
    const matchesAccount = selectedAccount === "all" || t.bank_account_id === selectedAccount;
    return matchesSearch && matchesAccount;
  });

  // Running balance — only meaningful for single-account view
  const showBalance = selectedAccount !== "all";
  const balanceMap = useMemo(() => {
    const map = new Map<string, number>();
    if (selectedAccount === "all") return map; // no running balance for mixed accounts
    const sortedForBalance = [...filtered].sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
    const acct = bankAccounts.find(a => a.id === selectedAccount);
    let running = acct?.opening_balance || 0;
    for (const tx of sortedForBalance) {
      running += (tx.deposit || 0) - (tx.payment || 0);
      map.set(tx.id, running);
    }
    return map;
  }, [filtered, bankAccounts, selectedAccount]);

  const togglePrintSelect = (id: string) => {
    setSelectedForPrint(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const printChecks = () => {
    if (selectedForPrint.size === 0) { toast.error("Select at least one payment to print"); return; }
    setPrintDialogOpen(true);
  };

  const checksForPrint = transactions
    .filter(t => selectedForPrint.has(t.id) && t.payment > 0)
    .map(t => {
      const acct = bankAccounts.find(a => a.id === t.bank_account_id);
      return {
        date: t.date, payee: t.payee, amount: t.payment, memo: t.memo, checkNo: t.check_no,
        bankName: acct?.bank_name || "N/A", accountName: acct?.name || "Default",
        routingNumber: acct?.routing_number || "", accountNumber: acct?.account_number || "",
      };
    });

  // GL account options filtered by type
  const glOptions = form.type === "payment"
    ? glAccounts.filter(a => ["expense", "asset", "liability"].includes(a.account_type))
    : glAccounts.filter(a => ["revenue", "asset", "liability"].includes(a.account_type));

  return (
    <div className="p-8">
      <PageHeader
        title="Checkbook Register"
        description="Record checks, deposits, and reconcile your bank balance"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={printChecks} disabled={selectedForPrint.size === 0}>
              <Printer className="w-4 h-4 mr-2" />Print Checks ({selectedForPrint.size})
            </Button>
            <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />New Entry</Button>
          </div>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "Edit Transaction" : "New Transaction"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            {bankAccounts.length > 0 && (
              <div>
                <Label>Bank Account</Label>
                <Select value={form.bank_account_id || "__none__"} onValueChange={(v) => { const val = v === "__none__" ? "" : v; setForm({ ...form, bank_account_id: val }); checkDuplicate(form.check_no, val); }}>
                  <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No account —</SelectItem>
                    {bankAccounts.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({a.account_type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div>
                <Label>Check # (auto if blank)</Label>
                <Input placeholder="Auto from account" value={form.check_no} onChange={(e) => {
                  setForm({ ...form, check_no: e.target.value });
                  checkDuplicate(e.target.value, form.bank_account_id);
                }} />
              </div>
            </div>
            {dupCheckWarning && (
              <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {dupCheckWarning}
              </div>
            )}
            <div><Label>Payee</Label><Input placeholder="Who is this payment to?" value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} /></div>
            <div><Label>Memo</Label><Input placeholder="Description" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "payment" | "deposit", gl_account_id: "" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="payment">Payment</SelectItem>
                    <SelectItem value="deposit">Deposit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Amount</Label><Input type="number" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div>
              <Label>GL Account (optional — overrides default)</Label>
              <Select value={form.gl_account_id || "__auto__"} onValueChange={(v) => setForm({ ...form, gl_account_id: v === "__auto__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Auto from category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__">Auto (default)</SelectItem>
                  {glOptions.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.account_number} - {a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Job Number</Label>
              <JobSelect value={form.job_id} onValueChange={(v) => setForm({ ...form, job_id: v })} />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category || "__none__"} onValueChange={(v) => setForm({ ...form, category: v === "__none__" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  <SelectItem value="Materials">Materials</SelectItem>
                  <SelectItem value="Labor">Labor</SelectItem>
                  <SelectItem value="Equipment">Equipment</SelectItem>
                  <SelectItem value="Subcontractor">Subcontractor</SelectItem>
                  <SelectItem value="Revenue">Revenue</SelectItem>
                  <SelectItem value="Payroll">Payroll</SelectItem>
                  <SelectItem value="Overhead">Overhead</SelectItem>
                  <SelectItem value="Accounts Payable">Accounts Payable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {editingId ? "Update Transaction" : "Save Transaction"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>


      <DeleteConfirmDialog
        open={!!voidId}
        onOpenChange={() => setVoidId(null)}
        onConfirm={() => voidId && voidMutation.mutate(voidId)}
        title="Void this check?"
        description="This creates a reversing entry that zeroes out the original amount. Both entries remain in the register for audit trail."
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Delete this transaction?"
        description="This will permanently remove the transaction and its journal entry. Any linked vendor invoice will be re-opened. This is only allowed for unreconciled transactions."
      />

      <div className="flex items-center gap-4 mb-6">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search transactions..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {bankAccounts.length > 0 && (
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Accounts</SelectItem>
              {bankAccounts.map(a => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 w-8"><Checkbox checked={selectedForPrint.size > 0 && selectedForPrint.size === filtered.filter(t => t.payment > 0).length} onCheckedChange={(checked) => {
                  if (checked) setSelectedForPrint(new Set(filtered.filter(t => t.payment > 0).map(t => t.id)));
                  else setSelectedForPrint(new Set());
                }} /></th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground w-8">✓</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Check #</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Payee</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Memo</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Job</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Category</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Payment</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Deposit</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Balance</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-muted-foreground">No transactions found.</td></tr>
              ) : (
                filtered.map((tx) => (
                  <tr key={tx.id} className="table-row-hover border-b border-border/50">
                    <td className="px-4 py-3">
                      {tx.payment > 0 && <Checkbox checked={selectedForPrint.has(tx.id)} onCheckedChange={() => togglePrintSelect(tx.id)} />}
                    </td>
                    <td className="px-4 py-3">
                      <div className={`w-4 h-4 rounded-full border-2 ${tx.reconciled ? "bg-success border-success" : "border-border"}`} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{tx.date}</td>
                    <td className="px-4 py-3 font-mono text-xs text-card-foreground">{tx.check_no}</td>
                    <td className="px-4 py-3 font-medium text-card-foreground">{tx.payee}</td>
                    <td className="px-4 py-3 text-muted-foreground">{tx.memo}</td>
                    <td className="px-4 py-3 font-mono text-xs text-primary">
                      {tx.jobs?.job_number || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">{tx.category}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">
                      {tx.payment > 0 ? `$${tx.payment.toLocaleString()}` : ""}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-success">
                      {tx.deposit > 0 ? `$${tx.deposit.toLocaleString()}` : ""}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-card-foreground">
                      {showBalance && balanceMap.has(tx.id) ? `$${(balanceMap.get(tx.id) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(tx)} title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {!tx.check_no.startsWith("VOID-") && !tx.reconciled && (
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteId(tx.id)} title="Delete (unreconciled)">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {!tx.check_no.startsWith("VOID-") && tx.reconciled && (
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-warning hover:text-warning" onClick={() => setVoidId(tx.id)} title="Void (reversing entry)">
                            <Ban className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CheckPrintDialog open={printDialogOpen} onOpenChange={setPrintDialogOpen} checks={checksForPrint} />
    </div>
  );
}
