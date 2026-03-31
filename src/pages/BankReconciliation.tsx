import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { format } from "date-fns";
import { CheckCircle2, Plus } from "lucide-react";

export default function BankReconciliation() {
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [stmtDate, setStmtDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [stmtBalance, setStmtBalance] = useState("");
  const [stmtBankId, setStmtBankId] = useState("");
  const [activeRecId, setActiveRecId] = useState<string | null>(null);
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_accounts").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: reconciliations = [] } = useQuery({
    queryKey: ["bank-reconciliations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bank_reconciliations")
        .select("*")
        .order("statement_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions-recon"],
    queryFn: async () => {
      let allTxns: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("transactions")
          .select("*")
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

  const activeRec = reconciliations.find((r) => r.id === activeRecId);
  const activeBankId = (activeRec as any)?.bank_account_id;

  // Filter transactions to the active reconciliation's bank account
  const unreconciledTxns = useMemo(
    () => transactions.filter((t) => !t.reconciled && t.bank_account_id === activeBankId),
    [transactions, activeBankId]
  );

  const clearedTotal = useMemo(() => {
    const alreadyReconciled = transactions
      .filter((t) => t.reconciled && t.bank_account_id === activeBankId)
      .reduce((s, t) => s + (t.deposit || 0) - (t.payment || 0), 0);
    const acct = bankAccounts.find(a => a.id === activeBankId);
    const opening = acct?.opening_balance || 0;
    const newlyCleared = unreconciledTxns
      .filter((t) => clearedIds.has(t.id))
      .reduce((s, t) => s + (t.deposit || 0) - (t.payment || 0), 0);
    return opening + alreadyReconciled + newlyCleared;
  }, [transactions, unreconciledTxns, clearedIds, activeBankId, bankAccounts]);

  const difference = activeRec ? Number(activeRec.statement_balance) - clearedTotal : 0;

  const toggleCleared = (id: string) => {
    setClearedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!stmtBankId) throw new Error("Please select a bank account");
      const { data, error } = await supabase
        .from("bank_reconciliations")
        .insert({
          statement_date: stmtDate,
          statement_balance: Number(stmtBalance),
          bank_account_id: stmtBankId,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["bank-reconciliations"] });
      setActiveRecId(data.id);
      setClearedIds(new Set());
      setShowNew(false);
      toast.success("Reconciliation started");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      if (!activeRecId) throw new Error("No active reconciliation");
      const ids = Array.from(clearedIds);
      if (ids.length > 0) {
        const { error } = await supabase
          .from("transactions")
          .update({ reconciled: true })
          .in("id", ids);
        if (error) throw error;
      }
      const { error: recError } = await supabase
        .from("bank_reconciliations")
        .update({
          cleared_balance: clearedTotal,
          difference,
          status: Math.abs(difference) < 0.01 ? "completed" : "in_progress",
          completed_at: Math.abs(difference) < 0.01 ? new Date().toISOString() : null,
        })
        .eq("id", activeRecId);
      if (recError) throw recError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-reconciliations"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-recon"] });
      if (Math.abs(difference) < 0.01) {
        toast.success("Reconciliation complete — balanced!");
        setActiveRecId(null);
        setClearedIds(new Set());
      } else {
        toast.success("Progress saved");
      }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const fmt = (n: number) => `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  const getAccountName = (id: string | null) => {
    if (!id) return "—";
    return bankAccounts.find(a => a.id === id)?.name || "—";
  };

  return (
    <div className="p-8">
      <PageHeader title="Bank Reconciliation" description="Match transactions to your bank statement by account" />

      <div className="flex gap-4 mb-6">
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4 mr-2" /> New Reconciliation
        </Button>
      </div>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Start Bank Reconciliation</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Bank Account</Label>
              <Select value={stmtBankId} onValueChange={setStmtBankId}>
                <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {bankAccounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name} ({a.account_type})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Statement Date</Label>
              <Input type="date" value={stmtDate} onChange={(e) => setStmtDate(e.target.value)} />
            </div>
            <div>
              <Label>Statement Ending Balance</Label>
              <Input type="number" step="0.01" placeholder="0.00" value={stmtBalance} onChange={(e) => setStmtBalance(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => createMutation.mutate()} disabled={!stmtBalance || !stmtBankId || createMutation.isPending}>
              Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {activeRec && (
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground mb-2">
            Reconciling: <span className="font-medium text-card-foreground">{getAccountName(activeBankId)}</span> — Statement Date: {activeRec.statement_date}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="glass-card rounded-xl p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Statement Balance</div>
              <div className="font-mono font-bold text-lg text-card-foreground">{fmt(Number(activeRec.statement_balance))}</div>
            </div>
            <div className="glass-card rounded-xl p-4 text-center">
              <div className="text-xs text-muted-foreground mb-1">Cleared Balance</div>
              <div className="font-mono font-bold text-lg text-card-foreground">{fmt(clearedTotal)}</div>
            </div>
            <div className={cn("glass-card rounded-xl p-4 text-center", Math.abs(difference) < 0.01 ? "ring-2 ring-success" : "")}>
              <div className="text-xs text-muted-foreground mb-1">Difference</div>
              <div className={cn("font-mono font-bold text-lg", Math.abs(difference) < 0.01 ? "text-success" : "text-destructive")}>
                {difference >= 0 ? "" : "-"}{fmt(difference)}
              </div>
            </div>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <div className="px-6 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
              <span className="font-medium text-card-foreground">Unreconciled Transactions — {getAccountName(activeBankId)}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => { setActiveRecId(null); setClearedIds(new Set()); }}>Cancel</Button>
                <Button size="sm" onClick={() => finalizeMutation.mutate()} disabled={finalizeMutation.isPending}>
                  {Math.abs(difference) < 0.01 ? "Finalize" : "Save Progress"}
                </Button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="w-10 px-4 py-2"></th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Check #</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Payee</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Memo</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Payment</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Deposit</th>
                </tr>
              </thead>
              <tbody>
                {unreconciledTxns.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">All transactions for this account are reconciled.</td></tr>
                ) : unreconciledTxns.map((t) => (
                  <tr key={t.id} className={cn("border-b border-border/50 cursor-pointer hover:bg-muted/30", clearedIds.has(t.id) && "bg-success/10")} onClick={() => toggleCleared(t.id)}>
                    <td className="px-4 py-2 text-center">
                      <Checkbox checked={clearedIds.has(t.id)} onCheckedChange={() => toggleCleared(t.id)} />
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{t.date}</td>
                    <td className="px-4 py-2 font-mono text-xs text-card-foreground">{t.check_no || "—"}</td>
                    <td className="px-4 py-2 font-medium text-card-foreground">{t.payee}</td>
                    <td className="px-4 py-2 text-muted-foreground">{t.memo}</td>
                    <td className="px-4 py-2 text-right font-mono text-destructive">{t.payment > 0 ? fmt(t.payment) : ""}</td>
                    <td className="px-4 py-2 text-right font-mono text-success">{t.deposit > 0 ? fmt(t.deposit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!activeRec && (
        <div className="glass-card rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Account</th>
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Statement Date</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Statement Balance</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Cleared Balance</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Difference</th>
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {reconciliations.length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No reconciliations yet. Click "New Reconciliation" to start.</td></tr>
              ) : reconciliations.map((r) => (
                <tr key={r.id} className="table-row-hover border-b border-border/50">
                  <td className="px-6 py-3 font-medium text-card-foreground">{getAccountName((r as any).bank_account_id)}</td>
                  <td className="px-6 py-3 text-card-foreground">{r.statement_date}</td>
                  <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(Number(r.statement_balance))}</td>
                  <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(Number(r.cleared_balance))}</td>
                  <td className={cn("px-6 py-3 text-right font-mono", Math.abs(Number(r.difference)) < 0.01 ? "text-success" : "text-destructive")}>{fmt(Number(r.difference))}</td>
                  <td className="px-6 py-3">
                    {r.status === "completed" ? (
                      <span className="inline-flex items-center gap-1 text-success text-xs font-medium"><CheckCircle2 className="w-3 h-3" /> Complete</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">In Progress</span>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    {r.status !== "completed" && (
                      <Button size="sm" variant="outline" onClick={() => { setActiveRecId(r.id); setClearedIds(new Set()); }}>
                        Continue
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
