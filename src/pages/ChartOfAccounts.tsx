import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { cn, fmt } from "@/lib/utils";

const accountTypes = ["asset", "liability", "equity", "revenue", "expense"];

export default function ChartOfAccounts() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    account_number: "",
    name: "",
    account_type: "expense",
    normal_balance: "debit",
  });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["gl-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts").select("*").order("account_number");
      if (error) throw error;
      return data;
    },
  });

  // Fetch GL balances from posted journal entry lines
  const { data: jeLines = [] } = useQuery({
    queryKey: ["gl-account-balances"],
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
      if (postedIds.length === 0) return [];

      // Step 2: Fetch lines for posted entries
      let allLines: any[] = [];
      from = 0;
      while (true) {
        const batch = postedIds.slice(from, from + pageSize);
        if (batch.length === 0) break;
        const { data, error } = await supabase
          .from("journal_entry_lines")
          .select("account_id, debit, credit")
          .in("journal_entry_id", batch);
        if (error) throw error;
        if (data) allLines = allLines.concat(data);
        from += pageSize;
      }
      return allLines;
    },
  });

  const accountBalances = useMemo(() => {
    const map: Record<string, number> = {};
    jeLines.forEach((l: any) => {
      if (!map[l.account_id]) map[l.account_id] = 0;
      map[l.account_id] += (l.debit || 0) - (l.credit || 0);
    });
    return map;
  }, [jeLines]);

  const createAccount = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("gl_accounts").insert(form);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gl-accounts"] });
      setDialogOpen(false);
      setForm({ account_number: "", name: "", account_type: "expense", normal_balance: "debit" });
      toast.success("Account created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = accounts.filter(
    (a) =>
      a.account_number.toLowerCase().includes(search.toLowerCase()) ||
      a.name.toLowerCase().includes(search.toLowerCase())
  );

  const typeColors: Record<string, string> = {
    asset: "bg-info/10 text-info",
    liability: "bg-destructive/10 text-destructive",
    equity: "bg-accent/10 text-accent",
    revenue: "bg-success/10 text-success",
    expense: "bg-warning/10 text-warning",
  };

  return (
    <div className="p-8">
      <PageHeader
        title="Chart of Accounts"
        description="Define your general ledger account structure"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="w-4 h-4 mr-2" />New Account</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New GL Account</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Account #</Label><Input placeholder="1000" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} /></div>
                  <div><Label>Name</Label><Input placeholder="Cash" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Type</Label>
                    <Select value={form.account_type} onValueChange={(v) => {
                      const normalBal = ["asset", "expense"].includes(v) ? "debit" : "credit";
                      setForm({ ...form, account_type: v, normal_balance: normalBal });
                    }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {accountTypes.map((t) => <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Normal Balance</Label>
                    <Select value={form.normal_balance} onValueChange={(v) => setForm({ ...form, normal_balance: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="debit">Debit</SelectItem>
                        <SelectItem value="credit">Credit</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button onClick={() => createAccount.mutate()} disabled={createAccount.isPending || !form.account_number || !form.name}>Save Account</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-10" placeholder="Search accounts..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Account #</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Normal Balance</th>
              <th className="text-right px-6 py-3 font-medium text-muted-foreground">Balance</th>
              <th className="text-center px-6 py-3 font-medium text-muted-foreground">Active</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No accounts found.</td></tr>
            ) : filtered.map((a) => {
              const rawBal = accountBalances[a.id] || 0;
              // For credit-normal accounts, flip sign for display
              const displayBal = a.normal_balance === "credit" ? -rawBal : rawBal;
              return (
                <tr key={a.id} className="table-row-hover border-b border-border/50">
                  <td className="px-6 py-3 font-mono text-sm font-medium text-card-foreground">{a.account_number}</td>
                  <td className="px-6 py-3 font-medium text-card-foreground">{a.name}</td>
                  <td className="px-6 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", typeColors[a.account_type] || "")}>
                      {a.account_type}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-muted-foreground capitalize">{a.normal_balance}</td>
                  <td className={cn("px-6 py-3 text-right font-mono text-sm",
                    displayBal === 0 ? "text-muted-foreground" : displayBal > 0 ? "text-card-foreground" : "text-destructive"
                  )}>
                    {displayBal < 0 ? `(${fmt(displayBal)})` : fmt(displayBal)}
                  </td>
                  <td className="px-6 py-3 text-center">{a.active ? "✓" : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
