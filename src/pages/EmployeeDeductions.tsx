import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, DollarSign, Percent } from "lucide-react";
import { parseMoney } from "@/lib/utils";
import { toast } from "sonner";

const DEDUCTION_TYPES = [
  { value: "401k", label: "401(k) / Retirement" },
  { value: "garnishment", label: "Court Order / Garnishment" },
  { value: "health_insurance", label: "Health Insurance" },
  { value: "dental_insurance", label: "Dental Insurance" },
  { value: "vision_insurance", label: "Vision Insurance" },
  { value: "union_dues", label: "Union Dues" },
  { value: "hsa", label: "HSA" },
  { value: "other", label: "Other" },
];

const DEDUCTION_LABEL: Record<string, string> = Object.fromEntries(DEDUCTION_TYPES.map((d) => [d.value, d.label]));

export default function EmployeeDeductions() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [form, setForm] = useState({
    deduction_type: "401k",
    description: "",
    calc_method: "flat",
    amount: "",
    percentage: "",
    pre_tax: true,
    reduces_fica: false,
    priority: "100",
    max_annual: "",
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id, name, employee_number").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: deductions = [], isLoading } = useQuery({
    queryKey: ["employee-deductions", selectedEmployee],
    queryFn: async () => {
      if (!selectedEmployee) return [];
      const { data, error } = await supabase
        .from("employee_deductions")
        .select("*")
        .eq("employee_id", selectedEmployee)
        .order("priority")
        .order("deduction_type");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedEmployee,
  });

  const createDeduction = useMutation({
    mutationFn: async () => {
      if (!selectedEmployee) throw new Error("Select an employee first");
      const { error } = await supabase.from("employee_deductions").insert({
        employee_id: selectedEmployee,
        deduction_type: form.deduction_type,
        description: form.description,
        calc_method: form.calc_method,
        amount: parseMoney(form.amount),
        percentage: parseFloat(form.percentage) || 0,
        pre_tax: form.pre_tax,
        reduces_fica: form.pre_tax && form.reduces_fica,
        priority: parseInt(form.priority) || 100,
        max_annual: form.max_annual ? parseMoney(form.max_annual) : null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-deductions"] });
      setDialogOpen(false);
      setForm({ deduction_type: "401k", description: "", calc_method: "flat", amount: "", percentage: "", pre_tax: true, reduces_fica: false, priority: "100", max_annual: "" });
      toast.success("Deduction added");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("employee_deductions").update({ active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-deductions"] }),
  });

  const deleteDeduction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employee_deductions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-deductions"] });
      toast.success("Deleted");
    },
  });

  return (
    <div className="p-8">
      <PageHeader
        title="Employee Deductions"
        description="Manage per-employee deductions: 401(k), garnishments, insurance premiums, union dues, and more"
        actions={
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={!selectedEmployee}><Plus className="w-4 h-4 mr-2" />Add Deduction</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Deduction</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-4">
                <div>
                  <Label>Deduction Type</Label>
                  <Select value={form.deduction_type} onValueChange={(v) => setForm({ ...form, deduction_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DEDUCTION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Description</Label>
                  <Input placeholder="e.g. Child support order #12345" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Calculation Method</Label>
                    <Select value={form.calc_method} onValueChange={(v) => setForm({ ...form, calc_method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flat">Flat Amount ($)</SelectItem>
                        <SelectItem value="percentage">Percentage of Gross (%)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.calc_method === "flat" ? (
                    <div><Label>Amount ($)</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
                  ) : (
                    <div><Label>Percentage (%)</Label><Input type="number" step="0.01" placeholder="e.g. 6" value={form.percentage} onChange={(e) => setForm({ ...form, percentage: e.target.value })} /></div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Priority (lower = first)</Label><Input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></div>
                  <div><Label>Annual Cap ($)</Label><Input type="number" step="0.01" placeholder="Optional" value={form.max_annual} onChange={(e) => setForm({ ...form, max_annual: e.target.value })} /></div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={form.pre_tax} onCheckedChange={(v) => setForm({ ...form, pre_tax: v })} />
                  <Label>Pre-tax deduction</Label>
                </div>
                {form.pre_tax && (
                  <div className="flex items-center gap-3 ml-6">
                    <Switch checked={form.reduces_fica} onCheckedChange={(v) => setForm({ ...form, reduces_fica: v })} />
                    <Label className="text-xs text-muted-foreground">Also reduces FICA wages (Section 125 — health/dental/vision premiums)</Label>
                  </div>
                )}
                <Button onClick={() => createDeduction.mutate()} disabled={createDeduction.isPending}>Save Deduction</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-6 w-72">
        <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
          <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
          <SelectContent>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.employee_number} – {e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!selectedEmployee ? (
        <div className="glass-card rounded-xl p-12 text-center text-muted-foreground">Select an employee to view and manage deductions.</div>
      ) : isLoading ? (
        <div className="glass-card rounded-xl p-12 text-center text-muted-foreground">Loading…</div>
      ) : (
        <div className="glass-card rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Type</th>
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Description</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Amount</th>
                <th className="text-center px-6 py-3 font-medium text-muted-foreground">Pre-Tax</th>
                <th className="text-center px-6 py-3 font-medium text-muted-foreground">Priority</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Annual Cap</th>
                <th className="text-center px-6 py-3 font-medium text-muted-foreground">Active</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {deductions.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">No deductions. Click "Add Deduction" to set one up.</td></tr>
              ) : deductions.map((d: any) => (
                <tr key={d.id} className="table-row-hover border-b border-border/50">
                  <td className="px-6 py-3">
                    <Badge variant={d.deduction_type === "garnishment" ? "destructive" : "secondary"} className="text-xs">
                      {DEDUCTION_LABEL[d.deduction_type] || d.deduction_type}
                    </Badge>
                  </td>
                  <td className="px-6 py-3 text-card-foreground">{d.description}</td>
                  <td className="px-6 py-3 text-right font-mono text-card-foreground">
                    {d.calc_method === "percentage" ? (
                      <span className="flex items-center justify-end gap-1"><Percent className="w-3 h-3 text-muted-foreground" />{d.percentage}%</span>
                    ) : (
                      <span className="flex items-center justify-end gap-1"><DollarSign className="w-3 h-3 text-muted-foreground" />{d.amount.toFixed(2)}</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-center">{d.pre_tax ? "Yes" : "No"}</td>
                  <td className="px-6 py-3 text-center font-mono text-muted-foreground">{d.priority}</td>
                  <td className="px-6 py-3 text-right font-mono text-card-foreground">{d.max_annual ? `$${d.max_annual.toLocaleString()}` : "—"}</td>
                  <td className="px-6 py-3 text-center">
                    <Switch checked={d.active} onCheckedChange={(v) => toggleActive.mutate({ id: d.id, active: v })} />
                  </td>
                  <td className="px-6 py-3 text-center">
                    <Button variant="ghost" size="sm" onClick={() => deleteDeduction.mutate(d.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
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
