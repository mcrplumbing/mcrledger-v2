import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import PageHeader from "@/components/PageHeader";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Line {
  account_id: string;
  debit: string;
  credit: string;
  description: string;
  job_id: string;
}

const emptyLine = (): Line => ({ account_id: "", debit: "", credit: "", description: "", job_id: "" });

export default function JournalEntries() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailEntry, setDetailEntry] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ entry_number: "", date: new Date().toISOString().split("T")[0], description: "" });
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["journal-entries"],
    queryFn: () => fetchAll((sb) =>
      sb.from("journal_entries")
        .select("*, journal_entry_lines(*, gl_accounts(account_number, name), jobs(job_number, name))")
        .order("date", { ascending: false })
    ),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["gl-accounts"],
    queryFn: async () => { const { data, error } = await supabase.from("gl_accounts").select("id, account_number, name").eq("active", true).order("account_number"); if (error) throw error; return data; },
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => { const { data, error } = await supabase.from("jobs").select("id, job_number, name").order("job_number"); if (error) throw error; return data; },
  });

  const totalDebits = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredits = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01 && totalDebits > 0;

  const createEntry = useMutation({
    mutationFn: async () => {
      if (!isBalanced) throw new Error("Debits must equal credits");
      const { data: entry, error: hErr } = await supabase.from("journal_entries").insert({
        entry_number: form.entry_number, date: form.date, description: form.description, status: "draft",
      }).select("id").single();
      if (hErr) throw hErr;

      const lineInserts = lines
        .filter((l) => l.account_id && (parseFloat(l.debit) || parseFloat(l.credit)))
        .map((l) => ({
          journal_entry_id: entry.id, account_id: l.account_id,
          debit: parseFloat(l.debit) || 0, credit: parseFloat(l.credit) || 0,
          description: l.description, job_id: l.job_id || null,
        }));

      const { error: lErr } = await supabase.from("journal_entry_lines").insert(lineInserts);
      if (lErr) throw lErr;

      // Now post — balance validation will pass
      const { error: postErr } = await supabase.from("journal_entries").update({ status: "posted" }).eq("id", entry.id);
      if (postErr) throw postErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
      setDialogOpen(false);
      setForm({ entry_number: "", date: new Date().toISOString().split("T")[0], description: "" });
      setLines([emptyLine(), emptyLine()]);
      toast.success("Journal entry posted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const voidMutation = useMutation({
    mutationFn: async (id: string) => {
      // Void instead of delete — preserves audit trail
      const { error } = await supabase.from("journal_entries").update({ status: "void" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
      setDeleteId(null);
      toast.success("Journal entry voided");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateLine = (idx: number, field: keyof Line, value: string) => {
    const updated = [...lines];
    updated[idx] = { ...updated[idx], [field]: value };
    setLines(updated);
  };

  return (
    <div className="p-8">
      <PageHeader title="Journal Entries" description="Create and review general ledger journal entries"
        actions={
          <Button onClick={() => { setForm({ entry_number: "", date: new Date().toISOString().split("T")[0], description: "" }); setLines([emptyLine(), emptyLine()]); setDialogOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" />New Entry
          </Button>
        }
      />

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Journal Entry</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Entry #</Label><Input placeholder="JE-001" value={form.entry_number} onChange={(e) => setForm({ ...form, entry_number: e.target.value })} /></div>
              <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div><Label>Description</Label><Input placeholder="Memo" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            </div>

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Account</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground w-20">Job</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground w-28">Debit</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground w-28">Credit</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Memo</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx} className="border-b border-border/50">
                      <td className="px-2 py-1">
                        <Select value={line.account_id} onValueChange={(v) => updateLine(idx, "account_id", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.account_number} - {a.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1">
                        <Select value={line.job_id} onValueChange={(v) => updateLine(idx, "job_id", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>{jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.job_number}</SelectItem>)}</SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1"><Input className="h-8 text-right text-xs" type="number" placeholder="0.00" value={line.debit} onChange={(e) => updateLine(idx, "debit", e.target.value)} /></td>
                      <td className="px-2 py-1"><Input className="h-8 text-right text-xs" type="number" placeholder="0.00" value={line.credit} onChange={(e) => updateLine(idx, "credit", e.target.value)} /></td>
                      <td className="px-2 py-1"><Input className="h-8 text-xs" placeholder="" value={line.description} onChange={(e) => updateLine(idx, "description", e.target.value)} /></td>
                      <td className="px-2 py-1">
                        {lines.length > 2 && (
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setLines(lines.filter((_, i) => i !== idx))}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20">
                    <td colSpan={2} className="px-3 py-2">
                      <Button variant="ghost" size="sm" onClick={() => setLines([...lines, emptyLine()])}>+ Add Line</Button>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-medium">${totalDebits.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono text-sm font-medium">${totalCredits.toFixed(2)}</td>
                    <td colSpan={2} className="px-3 py-2">
                      {isBalanced ? (
                        <span className="text-xs text-success font-medium">✓ Balanced</span>
                      ) : (
                        <span className="text-xs text-destructive font-medium">≠ Off by ${Math.abs(totalDebits - totalCredits).toFixed(2)}</span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <Button onClick={() => createEntry.mutate()} disabled={createEntry.isPending || !isBalanced}>Post Entry</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={!!detailEntry} onOpenChange={() => setDetailEntry(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Journal Entry Detail</DialogTitle></DialogHeader>
          {(() => {
            const entry = entries.find((e) => e.id === detailEntry);
            if (!entry) return null;
            const entryLines = (entry as any).journal_entry_lines || [];
            return (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Entry #:</span> <span className="font-medium text-card-foreground">{entry.entry_number}</span></div>
                  <div><span className="text-muted-foreground">Date:</span> <span className="font-medium text-card-foreground">{entry.date}</span></div>
                  <div><span className="text-muted-foreground">Status:</span> <span className="font-medium text-card-foreground capitalize">{entry.status}</span></div>
                </div>
                <p className="text-sm text-muted-foreground">{entry.description}</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Account</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Job</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Debit</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entryLines.map((l: any) => (
                      <tr key={l.id} className="border-b border-border/50">
                        <td className="px-4 py-2 font-medium text-card-foreground">{l.gl_accounts?.account_number} - {l.gl_accounts?.name}</td>
                        <td className="px-4 py-2 text-muted-foreground font-mono text-xs">{l.jobs?.job_number || "—"}</td>
                        <td className="px-4 py-2 text-right font-mono">{l.debit > 0 ? `$${l.debit.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ""}</td>
                        <td className="px-4 py-2 text-right font-mono">{l.credit > 0 ? `$${l.credit.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}
        onConfirm={() => deleteId && voidMutation.mutate(deleteId)} title="Void journal entry?"
        description="This will mark the journal entry as void. The entry and its lines will be preserved for audit purposes." />

      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Entry #</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Date</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Description</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-6 py-3 font-medium text-muted-foreground">Total</th>
              <th className="text-center px-6 py-3 font-medium text-muted-foreground w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No journal entries yet.</td></tr>
            ) : entries.map((e) => {
              const entryLines = (e as any).journal_entry_lines || [];
              const total = entryLines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
              return (
                <tr key={e.id} className="table-row-hover border-b border-border/50">
                  <td className="px-6 py-3 font-mono text-sm font-medium text-card-foreground">{e.entry_number}</td>
                  <td className="px-6 py-3 text-muted-foreground">{e.date}</td>
                  <td className="px-6 py-3 text-card-foreground">{e.description}</td>
                  <td className="px-6 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium",
                      e.status === "posted" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"
                    )}>{e.status}</span>
                  </td>
                  <td className="px-6 py-3 text-right font-mono text-card-foreground">${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="px-6 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setDetailEntry(e.id)}><Eye className="w-3.5 h-3.5" /></Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteId(e.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
