import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, Landmark } from "lucide-react";
import { toast } from "sonner";

export default function MakeDeposit() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [depositDate, setDepositDate] = useState(new Date().toISOString().split("T")[0]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [memo, setMemo] = useState("");

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["undeposited-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("received_payments")
        .select("*, job_invoices(invoice_number, job_id)")
        .eq("deposited", false)
        .order("payment_date", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_accounts").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  // Auto-select first bank account
  const effectiveBankId = bankAccountId || (bankAccounts.length > 0 ? bankAccounts[0].id : "");

  const selectedTotal = useMemo(() => {
    return payments
      .filter((p) => selectedIds.has(p.id))
      .reduce((sum, p) => sum + (p.amount || 0), 0);
  }, [payments, selectedIds]);

  const togglePayment = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === payments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(payments.map((p) => p.id)));
    }
  };

  const depositMutation = useMutation({
    mutationFn: async () => {
      if (selectedIds.size === 0) throw new Error("Select at least one payment");
      if (!effectiveBankId) throw new Error("Select a bank account");

      const selected = payments.filter((p) => selectedIds.has(p.id));
      const total = selected.reduce((s, p) => s + (p.amount || 0), 0);
      const clients = [...new Set(selected.map((p) => p.client))].join(", ");
      const refs = selected.map((p) => p.reference_no).filter(Boolean).join(", ");

      // Find the Undeposited Funds GL account (1200) so the auto-post trigger
      // creates DR Cash / CR Undeposited Funds (not Revenue)
      const { data: ufAcct } = await supabase.from("gl_accounts")
        .select("id").eq("account_number", "1200").eq("active", true).maybeSingle();

      if (!ufAcct) {
        throw new Error("Missing GL account 1200 (Undeposited Funds). Please add it in Chart of Accounts before making deposits.");
      }

      // Create one deposit transaction in the checkbook
      const { data: txData, error: txError } = await supabase.from("transactions").insert({
        date: depositDate,
        check_no: "DEP",
        payee: clients.length > 60 ? clients.slice(0, 57) + "..." : clients,
        memo: memo || `Deposit: ${refs || `${selected.length} payments`}`,
        category: "Revenue",
        deposit: total,
        payment: 0,
        bank_account_id: effectiveBankId,
        gl_account_id: ufAcct.id,
      }).select("id").single();
      if (txError) throw txError;

      // Mark all selected payments as deposited
      const { error: upError } = await supabase
        .from("received_payments")
        .update({ deposited: true, deposit_transaction_id: txData.id })
        .in("id", [...selectedIds]);
      if (upError) throw upError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["undeposited-payments"] });
      queryClient.invalidateQueries({ queryKey: ["undeposited-count"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-checkbook"] });
      setSelectedIds(new Set());
      setMemo("");
      toast.success("Deposit created in checkbook");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="p-8">
      <PageHeader
        title="Make Deposit"
        description="Select received payments to deposit into your bank account"
        actions={
          <Button variant="outline" onClick={() => window.location.href = "/invoices"}>
            ← Back to Invoices
          </Button>
        }
      />

      {/* Deposit controls */}
      <div className="glass-card rounded-xl p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <Label>Deposit To</Label>
            <Select value={effectiveBankId} onValueChange={setBankAccountId}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {bankAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Deposit Date</Label>
            <Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
          </div>
          <div>
            <Label>Memo</Label>
            <Input placeholder="Optional memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <div>
            <Button
              className="w-full"
              onClick={() => depositMutation.mutate()}
              disabled={depositMutation.isPending || selectedIds.size === 0}
            >
              <Landmark className="w-4 h-4 mr-2" />
              Deposit ${selectedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Button>
          </div>
        </div>
      </div>

      {/* Undeposited payments list */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-4 py-3 w-10">
                  <Checkbox
                    checked={payments.length > 0 && selectedIds.size === payments.length}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Client</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Invoice</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Method</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Ref #</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No undeposited payments. Receive payments from Invoices first.
                  </td>
                </tr>
              ) : payments.map((p) => (
                <tr
                  key={p.id}
                  className={`border-b border-border/50 cursor-pointer transition-colors ${
                    selectedIds.has(p.id) ? "bg-primary/5" : "hover:bg-muted/30"
                  }`}
                  onClick={() => togglePayment(p.id)}
                >
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selectedIds.has(p.id)}
                      onCheckedChange={() => togglePayment(p.id)}
                    />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{p.payment_date}</td>
                  <td className="px-4 py-3 font-medium text-card-foreground">{p.client}</td>
                  <td className="px-4 py-3 font-mono text-xs text-primary">
                    {(p as any).job_invoices?.invoice_number || "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{p.payment_method}</td>
                  <td className="px-4 py-3 font-mono text-xs text-card-foreground">{p.reference_no || "—"}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium text-card-foreground">
                    ${(p.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
            {payments.length > 0 && (
              <tfoot>
                <tr className="bg-muted/30 border-t border-border">
                  <td colSpan={6} className="px-4 py-3 text-right font-medium text-card-foreground">
                    Selected ({selectedIds.size} of {payments.length}):
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-primary text-base">
                    ${selectedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
