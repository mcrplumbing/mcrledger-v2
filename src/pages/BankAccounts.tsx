import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { Plus, Pencil, Trash2, Building2 } from "lucide-react";
import { parseMoney, fmt } from "@/lib/utils";
import { toast } from "sonner";

const defaultForm = () => ({
  name: "",
  bank_name: "",
  account_number: "",
  routing_number: "",
  account_type: "checking",
  opening_balance: "",
  next_check_number: "1001",
});

export default function BankAccounts() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm());

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_accounts").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Calculate current balance from GL (posted journal entries on cash accounts)
  const { data: glCashBalance } = useQuery({
    queryKey: ["bank-gl-cash-balance"],
    queryFn: async () => {
      // Step 1: Get posted JE IDs
      const postedIds: string[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("journal_entries")
          .select("id")
          .eq("status", "posted")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        postedIds.push(...data.map((d) => d.id));
        if (data.length < pageSize) break;
        from += pageSize;
      }
      if (postedIds.length === 0) return 0;

      // Step 2: Get lines with GL account info
      let allLines: any[] = [];
      from = 0;
      while (true) {
        const batch = postedIds.slice(from, from + pageSize);
        if (batch.length === 0) break;
        const { data, error } = await supabase
          .from("journal_entry_lines")
          .select("debit, credit, gl_accounts(account_number)")
          .in("journal_entry_id", batch);
        if (error) throw error;
        if (data) allLines = allLines.concat(data);
        from += pageSize;
      }

      const cashLines = allLines.filter((l: any) =>
        l.gl_accounts?.account_number?.startsWith("10")
      );
      return cashLines.reduce((s: number, l: any) => s + (l.debit || 0) - (l.credit || 0), 0);
    },
  });

  const openNew = () => { setEditingId(null); setForm(defaultForm()); setDialogOpen(true); };
  const openEdit = (a: any) => {
    setEditingId(a.id);
    setForm({
      name: a.name, bank_name: a.bank_name, account_number: a.account_number,
      routing_number: a.routing_number, account_type: a.account_type,
      opening_balance: String(a.opening_balance), next_check_number: String(a.next_check_number),
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const row = {
        name: form.name,
        bank_name: form.bank_name,
        account_number: form.account_number,
        routing_number: form.routing_number,
        account_type: form.account_type,
        opening_balance: parseMoney(form.opening_balance),
        next_check_number: parseInt(form.next_check_number) || 1001,
      };
      if (editingId) {
        const { error } = await supabase.from("bank_accounts").update(row).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("bank_accounts").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setDialogOpen(false);
      toast.success(editingId ? "Account updated" : "Account created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bank_accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      setDeleteId(null);
      toast.success("Account deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });


  return (
    <div className="p-8">
      <PageHeader
        title="Bank Accounts"
        description="Manage checking, savings, and credit card accounts"
        actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Add Account</Button>}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId ? "Edit Account" : "New Bank Account"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label>Account Name</Label><Input placeholder="e.g. Operating Checking" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Bank Name</Label><Input placeholder="e.g. Chase" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></div>
              <div>
                <Label>Account Type</Label>
                <Select value={form.account_type} onValueChange={(v) => setForm({ ...form, account_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checking">Checking</SelectItem>
                    <SelectItem value="savings">Savings</SelectItem>
                    <SelectItem value="credit_card">Credit Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Account Number</Label><Input placeholder="****1234" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} /></div>
              <div><Label>Routing Number</Label><Input placeholder="021000021" value={form.routing_number} onChange={(e) => setForm({ ...form, routing_number: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Opening Balance</Label><Input type="number" placeholder="0.00" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></div>
              <div><Label>Next Check #</Label><Input type="number" value={form.next_check_number} onChange={(e) => setForm({ ...form, next_check_number: e.target.value })} /></div>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name}>
              {editingId ? "Update Account" : "Create Account"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Delete bank account?"
        description="This will permanently remove this account. Transactions linked to it will become unassigned."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading ? (
          <p className="text-muted-foreground col-span-full text-center py-8">Loading...</p>
        ) : accounts.length === 0 ? (
          <div className="col-span-full glass-card rounded-xl p-8 text-center">
            <Building2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">No bank accounts yet. Add your first account to get started.</p>
            <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Add Account</Button>
          </div>
        ) : accounts.map((a) => {
          const currentBal = glCashBalance ?? ((a.opening_balance || 0));
          return (
            <div key={a.id} className="glass-card rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-display font-semibold text-card-foreground">{a.name}</p>
                  <p className="text-xs text-muted-foreground">{a.bank_name} · {a.account_type}</p>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(a)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteId(a.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground">Current Balance</p>
                <p className={`text-xl font-mono font-bold ${currentBal >= 0 ? "text-success" : "text-destructive"}`}>
                  {fmt(currentBal)}
                </p>
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Acct: ****{a.account_number.slice(-4)}</span>
                <span>Next Check: #{a.next_check_number}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
