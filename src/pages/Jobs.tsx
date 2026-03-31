import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import JobDetailDialog from "@/components/JobDetailDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ClientSelect from "@/components/ClientSelect";
import { Plus, Briefcase, DollarSign, TrendingUp, Pencil, Trash2, Eye } from "lucide-react";
import { cn, fmt, parseMoney } from "@/lib/utils";
import { fetchAll } from "@/lib/fetchAll";
import { toast } from "sonner";

const defaultForm = () => ({ job_number: "", name: "", client: "", budget: "", status: "active" });

export default function Jobs() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm());
  const [detailJob, setDetailJob] = useState<any>(null);

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => { const { data, error } = await supabase.from("jobs").select("*").order("created_at", { ascending: false }); if (error) throw error; return data; },
  });

  const { data: jobFinancials = [] } = useQuery({
    queryKey: ["job-financials"],
    queryFn: async () => fetchAll((sb) => sb.from("transactions").select("job_id, deposit, payment").not("job_id", "is", null)),
  });

  // Pull vendor invoice expenses by job (AP bills with job_id)
  const { data: jobVendorExpenses = [] } = useQuery({
    queryKey: ["job-vendor-expenses"],
    queryFn: async () => fetchAll((sb) => sb.from("vendor_invoices").select("job_id, amount").not("job_id", "is", null).neq("status", "void")),
  });

  // Pull AR invoice revenue by job
  const { data: jobInvoiceRevenue = [] } = useQuery({
    queryKey: ["job-invoice-revenue"],
    queryFn: async () => fetchAll((sb) => sb.from("job_invoices").select("job_id, amount").not("job_id", "is", null).neq("status", "void")),
  });

  // Pull timesheet labor costs by job — fully burdened (gross + employer SS 6.2% + Medicare 1.45%)
  const EMPLOYER_SS_RATE = 0.062;
  const EMPLOYER_MEDICARE_RATE = 0.0145;
  const BURDEN_RATE = 1 + EMPLOYER_SS_RATE + EMPLOYER_MEDICARE_RATE; // 1.0765

  const { data: timesheetCosts = [] } = useQuery({
    queryKey: ["job-timesheet-costs"],
    queryFn: async () => {
      const timesheets = await fetchAll((sb) =>
        sb.from("timesheets").select("job_id, hours, employee_id, pay_class, employees(rate)")
      );
      return timesheets.map((t: any) => {
        const rate = t.employees?.rate || 0;
        const multiplier = t.pay_class === "double" ? 2 : t.pay_class === "overtime" ? 1.5 : 1;
        const gross = (t.hours || 0) * rate * multiplier;
        return { job_id: t.job_id, labor_cost: gross * BURDEN_RATE };
      });
    },
  });

  const openNew = () => { setEditingId(null); setForm(defaultForm()); setDialogOpen(true); };
  const openEdit = (job: any) => { setEditingId(job.id); setForm({ job_number: job.job_number, name: job.name, client: job.client, budget: String(job.budget), status: job.status }); setDialogOpen(true); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const row = { job_number: form.job_number, name: form.name, client: form.client, budget: parseMoney(form.budget), status: form.status };
      if (editingId) {
        const { error } = await supabase.from("jobs").update(row).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("jobs").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["jobs"] }); setDialogOpen(false); toast.success(editingId ? "Job updated" : "Job created"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("jobs").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["jobs"] }); setDeleteId(null); toast.success("Job deleted"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const getJobFinancials = (jobId: string) => {
    const txns = jobFinancials.filter((t) => t.job_id === jobId);
    const labor = timesheetCosts.filter((t: any) => t.job_id === jobId).reduce((s: number, t: any) => s + (t.labor_cost || 0), 0);
    const revenue = jobInvoiceRevenue.filter((i: any) => i.job_id === jobId).reduce((s: number, i: any) => s + (i.amount || 0), 0);
    const vendorExp = jobVendorExpenses.filter((i: any) => i.job_id === jobId).reduce((s: number, i: any) => s + (i.amount || 0), 0);
    return {
      revenue,
      expenses: vendorExp + labor,
      labor,
    };
  };

  const jobRows = jobs
    .map((job) => {
      const { revenue, expenses, labor } = getJobFinancials(job.id);
      const otherExp = expenses - labor;
      const profit = revenue - expenses;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
      const activity = Math.abs(revenue) + Math.abs(expenses);

      return {
        ...job,
        revenue,
        expenses,
        labor,
        otherExp,
        profit,
        margin,
        activity,
      };
    })
    .sort((a, b) => b.activity - a.activity || a.job_number.localeCompare(b.job_number));

  const totalBudget = jobs.reduce((s, j) => s + (j.budget || 0), 0);
  const totalRevenue = jobInvoiceRevenue.reduce((s: number, i: any) => s + (i.amount || 0), 0);
  const totalLabor = timesheetCosts.reduce((s: number, t: any) => s + (t.labor_cost || 0), 0);
  const totalVendorExp = jobVendorExpenses.reduce((s: number, i: any) => s + (i.amount || 0), 0);
  const totalExpenses = totalVendorExp + totalLabor;
  const totalProfit = totalRevenue - totalExpenses;

  return (
    <div className="p-8">
      <PageHeader title="Job Cost Accounting" description="Track expenses and revenue by job"
        actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />New Job</Button>} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit Job" : "Create New Job"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label>Job Number</Label><Input placeholder="J-001" value={form.job_number} onChange={(e) => setForm({ ...form, job_number: e.target.value })} /></div>
            <div><Label>Job Name</Label><Input placeholder="Project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Client</Label><ClientSelect value={form.client} onValueChange={(v) => setForm({ ...form, client: v })} /></div>
            <div><Label>Budget</Label><Input type="number" placeholder="0.00" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on-hold">On Hold</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{editingId ? "Update Job" : "Create Job"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} title="Delete job?"
        description="This will delete the job. Linked transactions and invoices will keep their data but lose the job reference." />

      <JobDetailDialog open={!!detailJob} onOpenChange={(open) => { if (!open) setDetailJob(null); }} job={detailJob} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard title="Total Budget" value={`$${totalBudget.toLocaleString()}`} icon={Briefcase} />
        <StatCard title="Total Revenue" value={`$${totalRevenue.toLocaleString()}`} icon={DollarSign} />
        <StatCard title="Total Profit" value={`$${totalProfit.toLocaleString()}`} changeType="positive" change={totalRevenue > 0 ? `${((totalProfit / totalRevenue) * 100).toFixed(1)}% margin` : ""} icon={TrendingUp} />
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Job #</th>
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Client</th>
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Budget</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Revenue</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Labor</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Other Exp</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Total Cost</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Profit</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Margin</th>
                <th className="text-center px-6 py-3 font-medium text-muted-foreground w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={12} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : jobs.length === 0 ? (
                <tr><td colSpan={12} className="px-6 py-8 text-center text-muted-foreground">No jobs yet.</td></tr>
              ) : jobRows.map((job) => {
                return (
                  <tr key={job.id} className="table-row-hover border-b border-border/50">
                    <td className="px-6 py-3 font-mono text-xs text-card-foreground">{job.job_number}</td>
                    <td className="px-6 py-3 font-medium text-card-foreground">{job.name}</td>
                    <td className="px-6 py-3 text-muted-foreground">{job.client}</td>
                    <td className="px-6 py-3">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium",
                        job.status === "active" && "bg-success/10 text-success",
                        job.status === "completed" && "bg-primary/10 text-primary",
                        job.status === "on-hold" && "bg-warning/10 text-warning"
                      )}>{job.status}</span>
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(job.budget || 0)}</td>
                    <td className="px-6 py-3 text-right font-mono text-success">{fmt(job.revenue)}</td>
                    <td className="px-6 py-3 text-right font-mono text-warning">{fmt(job.labor)}</td>
                    <td className="px-6 py-3 text-right font-mono text-destructive">{fmt(job.otherExp)}</td>
                    <td className="px-6 py-3 text-right font-mono font-medium text-destructive">{fmt(job.expenses)}</td>
                    <td className={cn("px-6 py-3 text-right font-mono font-medium", job.profit >= 0 ? "text-success" : "text-destructive")}>{fmt(job.profit)}</td>
                    <td className="px-6 py-3 text-right font-mono text-muted-foreground">{job.margin.toFixed(1)}%</td>
                    <td className="px-6 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setDetailJob(job)} title="View linked transactions"><Eye className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(job)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteId(job.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
