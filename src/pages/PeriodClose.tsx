import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Lock, Unlock, Plus, ShieldCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function PeriodClose() {
  const queryClient = useQueryClient();
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [reopenId, setReopenId] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");

  // Audit log filters
  const [auditTable, setAuditTable] = useState("");
  const [auditSearch, setAuditSearch] = useState("");

  const { data: closedPeriods = [] } = useQuery({
    queryKey: ["closed-periods"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("closed_periods")
        .select("*")
        .order("period_end", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: auditLogs = [], isLoading: auditLoading } = useQuery({
    queryKey: ["audit-logs", auditTable, auditSearch],
    queryFn: async () => {
      let query = supabase
        .from("audit_log")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(200);
      if (auditTable) query = query.eq("table_name", auditTable);
      if (auditSearch) query = query.ilike("record_id", `%${auditSearch}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!periodStart || !periodEnd) throw new Error("Select both dates");
      const { error } = await supabase.from("closed_periods").insert({
        period_start: periodStart,
        period_end: periodEnd,
        notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["closed-periods"] });
      setCloseDialogOpen(false);
      setPeriodStart("");
      setPeriodEnd("");
      setNotes("");
      toast.success("Period closed successfully");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reopenMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("closed_periods").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["closed-periods"] });
      setReopenId(null);
      toast.success("Period reopened");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const coreTableNames = [
    "transactions", "journal_entries", "journal_entry_lines", "job_invoices",
    "vendor_invoices", "payroll_runs", "payroll_entries", "employees",
    "gl_accounts", "jobs", "vendors", "loans", "assets", "timesheets",
  ];

  const formatTs = (ts: string) => {
    try { return format(new Date(ts), "MMM d, yyyy h:mm a"); } catch { return ts; }
  };

  const summarizeChange = (log: any) => {
    if (log.action === "INSERT") return "Created";
    if (log.action === "DELETE") return "Deleted";
    if (!log.old_data || !log.new_data) return "Updated";
    const changes: string[] = [];
    for (const key of Object.keys(log.new_data)) {
      if (key === "created_at" || key === "updated_at") continue;
      if (JSON.stringify(log.old_data[key]) !== JSON.stringify(log.new_data[key])) {
        changes.push(key);
      }
    }
    return changes.length > 0 ? `Changed: ${changes.join(", ")}` : "No visible changes";
  };

  return (
    <div className="p-8">
      <PageHeader
        title="Period Close & Audit Trail"
        description="Lock accounting periods and review all data changes"
        actions={
          <Button onClick={() => setCloseDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />Close Period
          </Button>
        }
      />

      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close Accounting Period</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Period Start</Label><Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
              <div><Label>Period End</Label><Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
            </div>
            <div><Label>Notes (optional)</Label><Textarea placeholder="e.g., Q1 2026 close" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <p className="text-sm text-muted-foreground">Once closed, no transactions can be created or modified within this date range.</p>
            <Button onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending}>
              <Lock className="w-4 h-4 mr-2" />Close Period
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!reopenId}
        onOpenChange={() => setReopenId(null)}
        onConfirm={() => reopenId && reopenMutation.mutate(reopenId)}
        title="Reopen this period?"
        description="Reopening will allow transactions to be created or modified within this date range. This should only be done to correct errors."
      />

      <Tabs defaultValue="periods">
        <TabsList className="mb-4">
          <TabsTrigger value="periods"><Lock className="w-4 h-4 mr-2" />Closed Periods</TabsTrigger>
          <TabsTrigger value="audit"><ShieldCheck className="w-4 h-4 mr-2" />Audit Trail</TabsTrigger>
        </TabsList>

        <TabsContent value="periods">
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-display font-semibold text-card-foreground">Closed Periods</h2>
            </div>
            {closedPeriods.length === 0 ? (
              <div className="px-6 py-12 text-center text-muted-foreground">No periods have been closed yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Period</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Closed At</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Notes</th>
                      <th className="text-center px-4 py-3 font-medium text-muted-foreground w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedPeriods.map((p: any) => (
                      <tr key={p.id} className="border-b border-border/50">
                        <td className="px-4 py-3 font-medium text-card-foreground">{p.period_start} — {p.period_end}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatTs(p.closed_at)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{p.notes || "—"}</td>
                        <td className="px-4 py-3 text-center">
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setReopenId(p.id)}>
                            <Unlock className="w-3.5 h-3.5 mr-1" />Reopen
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="audit">
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <h2 className="font-display font-semibold text-card-foreground">Audit Log</h2>
              <div className="flex gap-2">
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={auditTable}
                  onChange={(e) => setAuditTable(e.target.value)}
                >
                  <option value="">All Tables</option>
                  {coreTableNames.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search record ID…"
                    className="pl-8 w-48"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {auditLoading ? (
              <div className="px-6 py-12 text-center text-muted-foreground">Loading…</div>
            ) : auditLogs.length === 0 ? (
              <div className="px-6 py-12 text-center text-muted-foreground">No audit records found.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Timestamp</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Table</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Summary</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Record ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log: any) => (
                      <tr key={log.id} className="border-b border-border/50">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatTs(log.changed_at)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-card-foreground">{log.table_name}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${
                            log.action === "INSERT" ? "bg-secondary text-secondary-foreground" :
                            log.action === "DELETE" ? "bg-destructive/15 text-destructive" :
                            "bg-accent text-accent-foreground"
                          }`}>{log.action}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">{summarizeChange(log)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{log.record_id?.substring(0, 8)}…</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
