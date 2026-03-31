import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { calculatePayroll } from "@/lib/payrollCalc";
import { parseMoney, roundMoney, fmt } from "@/lib/utils";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Users, DollarSign, Calculator, Pencil, Trash2, Play, Loader2, Printer, ChevronDown, ChevronUp, History, RotateCcw, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { format, startOfWeek, addDays, subWeeks, addWeeks } from "date-fns";
import PayStubsDialog, { type YtdTotals } from "@/components/PayStubsDialog";
import EmployeePTO from "@/components/EmployeePTO";

const defaultForm = () => ({
  employee_number: "", name: "", role: "", pay_type: "hourly", rate: "",
  filing_status: "single", pay_period: "weekly", withholding_allowances: "0", state: "CA",
  ssn: "", address: "", email: "",
});

interface RunPreviewEntry {
  employee_id: string;
  employee_name: string;
  hours: number;
  gross_pay: number;
  health_insurance: number;
  retirement_401k: number;
  other_pretax: number;
  deductions_pretax: number;
  deductions_posttax: number;
  fed_tax: number;
  state_tax: number;
  ss_tax: number;
  medicare_tax: number;
  sdi_tax: number;
  fica: number;
  net_pay: number;
}

export default function Payroll() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm());

  // Run Payroll state
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [payWeekStart, setPayWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [runPreview, setRunPreview] = useState<RunPreviewEntry[] | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [payrollBankAccountId, setPayrollBankAccountId] = useState<string>("");

  // History drill-down state
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [historyStubsRun, setHistoryStubsRun] = useState<any | null>(null);
  const [voidRunId, setVoidRunId] = useState<string | null>(null);
  const [deleteDraftId, setDeleteDraftId] = useState<string | null>(null);

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_accounts").select("*").eq("active", true).order("name");
      if (error) throw error;
      // Auto-select if only one account
      if (data && data.length === 1 && !payrollBankAccountId) setPayrollBankAccountId(data[0].id);
      return data;
    },
  });

  const { data: allRuns = [] } = useQuery({
    queryKey: ["all-payroll-runs"],
    queryFn: () => fetchAll((sb) =>
      sb.from("payroll_runs")
        .select("*, payroll_entries(*, employees(name, role, employee_number))")
        .order("period_end", { ascending: false })
    ),
  });

  const latestRun = allRuns.find((run: any) => !["reversal", "voided"].includes(run.status)) ?? null;

  const { data: ytdByEmployee } = useQuery({
    queryKey: ["ytd-totals"],
    queryFn: async () => {
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const runs = await fetchAll((sb) =>
        sb.from("payroll_runs")
          .select("id, payroll_entries(employee_id, hours_worked, gross_pay, fed_tax, state_tax, ss_tax, medicare_tax, sdi_tax, fica, net_pay)")
          .gte("period_start", yearStart)
      );
      const ytd: Record<string, YtdTotals> = {};
      for (const run of runs || []) {
        for (const e of (run as any).payroll_entries || []) {
          if (!ytd[e.employee_id]) ytd[e.employee_id] = { gross: 0, fed_tax: 0, state_tax: 0, ss_tax: 0, medicare_tax: 0, sdi_tax: 0, fica: 0, net: 0, hours: 0 };
          ytd[e.employee_id].gross += e.gross_pay || 0;
          ytd[e.employee_id].fed_tax += e.fed_tax || 0;
          ytd[e.employee_id].state_tax += e.state_tax || 0;
          ytd[e.employee_id].ss_tax += e.ss_tax || 0;
          ytd[e.employee_id].medicare_tax += e.medicare_tax || 0;
          ytd[e.employee_id].sdi_tax += e.sdi_tax || 0;
          ytd[e.employee_id].fica += e.fica || 0;
          ytd[e.employee_id].net += e.net_pay || 0;
          ytd[e.employee_id].hours += e.hours_worked || 0;
        }
      }
      return ytd;
    },
  });

  const openNew = () => { setEditingId(null); setForm(defaultForm()); setDialogOpen(true); };
  const openEdit = (emp: any) => {
    setEditingId(emp.id);
    setForm({
      employee_number: emp.employee_number, name: emp.name, role: emp.role,
      pay_type: emp.pay_type, rate: String(emp.rate),
      filing_status: emp.filing_status || "single",
      pay_period: emp.pay_period || "weekly",
      withholding_allowances: String(emp.withholding_allowances || 0),
      state: emp.state || "CA",
      ssn: emp.ssn || "", address: emp.address || "", email: emp.email || "",
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const row = {
        employee_number: form.employee_number, name: form.name, role: form.role,
        pay_type: form.pay_type, rate: parseMoney(form.rate),
        filing_status: form.filing_status, pay_period: form.pay_period,
        withholding_allowances: parseInt(form.withholding_allowances) || 0,
        state: form.state,
        ssn: form.ssn, address: form.address, email: form.email,
      };
      if (editingId) {
        const { error } = await supabase.from("employees").update(row).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("employees").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["employees"] }); setDialogOpen(false); toast.success(editingId ? "Employee updated" : "Employee added"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employees").update({ active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["employees"] }); setDeleteId(null); toast.success("Employee deactivated"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const periodStart = format(payWeekStart, "yyyy-MM-dd");
  const periodEnd = format(addDays(payWeekStart, 6), "yyyy-MM-dd");

  const handlePreviewPayroll = async () => {
    setCalculating(true);
    try {
      const { data: timesheets, error: tsErr } = await supabase
        .from("timesheets")
        .select("employee_id, hours, pay_class")
        .gte("date", periodStart)
        .lte("date", periodEnd);
      if (tsErr) throw tsErr;

      const hoursByEmployee: Record<string, number> = {};
      for (const ts of timesheets || []) {
        const multiplier = ts.pay_class === "double" ? 2 : ts.pay_class === "bonus" ? 0 : 1;
        hoursByEmployee[ts.employee_id] = (hoursByEmployee[ts.employee_id] || 0) + (ts.hours * multiplier);
      }

      const previews: RunPreviewEntry[] = [];
      for (const emp of employees) {
        const hours = hoursByEmployee[emp.id] || 0;
        if (hours === 0 && emp.pay_type === "hourly") continue;

        let grossPay: number;
        if (emp.pay_type === "salary") {
          const periodsPerYear = emp.pay_period === "weekly" ? 52 : emp.pay_period === "biweekly" ? 26 : emp.pay_period === "semimonthly" ? 24 : 12;
          grossPay = roundMoney(emp.rate / periodsPerYear);
        } else {
          grossPay = roundMoney(hours * emp.rate);
        }

        if (grossPay <= 0) continue;

        const result = await calculatePayroll(emp.id, grossPay, {
          filing_status: emp.filing_status || "single",
          pay_period: emp.pay_period || "weekly",
          withholding_allowances: emp.withholding_allowances || 0,
          state: emp.state || "CA",
        });

        const healthIns = result.deduction_details
          .filter(d => d.pre_tax && d.type === 'health_insurance').reduce((s, d) => s + d.amount, 0);
        const ret401k = result.deduction_details
          .filter(d => d.pre_tax && (d.type === '401k' || d.type === 'retirement')).reduce((s, d) => s + d.amount, 0);
        const otherPretax = result.deductions_pretax - healthIns - ret401k;

        previews.push({
          employee_id: emp.id, employee_name: emp.name, hours,
          gross_pay: result.gross_pay,
          health_insurance: healthIns,
          retirement_401k: ret401k,
          other_pretax: otherPretax,
          deductions_pretax: result.deductions_pretax,
          deductions_posttax: result.deductions_posttax,
          fed_tax: result.fed_tax,
          state_tax: result.state_tax, ss_tax: result.ss_tax,
          medicare_tax: result.medicare_tax, sdi_tax: result.sdi_tax,
          fica: result.fica, net_pay: result.net_pay,
        });
      }

      if (previews.length === 0) {
        toast.error("No employees with hours or salary found for this period");
        setCalculating(false);
        return;
      }
      setRunPreview(previews);
    } catch (err: any) {
      toast.error(err.message || "Calculation failed");
    }
    setCalculating(false);
  };

  const commitPayroll = useMutation({
    mutationFn: async () => {
      if (!runPreview) throw new Error("No preview to commit");
      if (!payrollBankAccountId) throw new Error("Please select a bank account for payroll checks");

      const { data: run, error: runErr } = await supabase
        .from("payroll_runs")
        .insert({ period_start: periodStart, period_end: periodEnd, status: "draft" })
        .select("id")
        .single();
      if (runErr) throw runErr;

      const entries = runPreview.map((p) => ({
        payroll_run_id: run.id, employee_id: p.employee_id, hours_worked: p.hours,
        gross_pay: p.gross_pay, fed_tax: p.fed_tax, state_tax: p.state_tax,
        ss_tax: p.ss_tax, medicare_tax: p.medicare_tax, sdi_tax: p.sdi_tax,
        fica: p.fica, net_pay: p.net_pay,
        deductions_pretax: p.deductions_pretax, deductions_posttax: p.deductions_posttax,
      }));
      const { error: entryErr } = await supabase.from("payroll_entries").insert(entries);
      if (entryErr) throw entryErr;

      // Find the payroll expense GL account for the checks
      const { data: payrollGl } = await supabase
        .from("gl_accounts")
        .select("id")
        .eq("active", true)
        .or("account_number.eq.6100,name.ilike.%payroll%")
        .order("account_number")
        .limit(1)
        .single();

      // Create a checkbook transaction for each employee's net pay (ACH by default)
      const checkTransactions = runPreview.map((p) => ({
        date: format(new Date(), "yyyy-MM-dd"),
        check_no: "ACH",
        payee: p.employee_name,
        memo: `Payroll ${periodStart} to ${periodEnd}`,
        category: "Payroll",
        payment: p.net_pay,
        deposit: 0,
        bank_account_id: payrollBankAccountId,
        gl_account_id: payrollGl?.id || null,
      }));

      const { error: txErr } = await supabase.from("transactions").insert(checkTransactions);
      if (txErr) throw txErr;

      // ── PTO: Accrue vacation + deduct vacation/sick usage ──
      // 1. Get timesheet vacation/sick hours for this period
      const { data: ptoTimesheets } = await supabase
        .from("timesheets")
        .select("employee_id, hours, pay_class")
        .gte("date", periodStart)
        .lte("date", periodEnd)
        .in("pay_class", ["vacation", "sick"]);

      const ptoUsage: Record<string, { vacation: number; sick: number }> = {};
      for (const ts of ptoTimesheets || []) {
        if (!ptoUsage[ts.employee_id]) ptoUsage[ts.employee_id] = { vacation: 0, sick: 0 };
        if (ts.pay_class === "vacation") ptoUsage[ts.employee_id].vacation += ts.hours || 0;
        if (ts.pay_class === "sick") ptoUsage[ts.employee_id].sick += ts.hours || 0;
      }

      // 2. Get current PTO balances and accrual rates
      const { data: currentPto } = await supabase.from("employee_pto").select("*");
      const ptoMap: Record<string, any> = {};
      for (const p of currentPto || []) {
        ptoMap[`${p.employee_id}_${p.pto_type}`] = p;
      }

      const ptoUpserts: any[] = [];
      const ledgerEntries: any[] = [];

      for (const p of runPreview) {
        // Vacation accrual
        const vacRec = ptoMap[`${p.employee_id}_vacation`];
        const accrualRate = vacRec?.accrual_rate || 0;
        let vacBalance = vacRec?.balance || 0;

        if (accrualRate > 0) {
          vacBalance += accrualRate;
          ledgerEntries.push({
            employee_id: p.employee_id, pto_type: "vacation",
            hours: accrualRate, reason: `Weekly accrual (${periodStart} to ${periodEnd})`,
            payroll_run_id: run.id,
          });
        }

        // Vacation usage deduction
        const vacUsed = ptoUsage[p.employee_id]?.vacation || 0;
        if (vacUsed > 0) {
          vacBalance -= vacUsed;
          ledgerEntries.push({
            employee_id: p.employee_id, pto_type: "vacation",
            hours: -vacUsed, reason: `Used on timesheet (${periodStart} to ${periodEnd})`,
            payroll_run_id: run.id,
          });
        }

        if (accrualRate > 0 || vacUsed > 0) {
          ptoUpserts.push({
            employee_id: p.employee_id, pto_type: "vacation",
            balance: vacBalance, accrual_rate: accrualRate,
          });
        }

        // Sick usage deduction
        const sickUsed = ptoUsage[p.employee_id]?.sick || 0;
        if (sickUsed > 0) {
          const sickRec = ptoMap[`${p.employee_id}_sick`];
          const sickBalance = (sickRec?.balance || 0) - sickUsed;
          ptoUpserts.push({
            employee_id: p.employee_id, pto_type: "sick",
            balance: sickBalance, accrual_rate: 0,
          });
          ledgerEntries.push({
            employee_id: p.employee_id, pto_type: "sick",
            hours: -sickUsed, reason: `Used on timesheet (${periodStart} to ${periodEnd})`,
            payroll_run_id: run.id,
          });
        }
      }

      if (ptoUpserts.length > 0) {
        await supabase.from("employee_pto").upsert(ptoUpserts, { onConflict: "employee_id,pto_type" });
      }
      if (ledgerEntries.length > 0) {
        await supabase.from("pto_ledger").insert(ledgerEntries);
      }

      // Update status to paid (triggers GL auto-posting)
      const { error: updErr } = await supabase.from("payroll_runs").update({ status: "paid" }).eq("id", run.id);
      if (updErr) throw updErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-payroll-runs"] });
      queryClient.invalidateQueries({ queryKey: ["ytd-totals"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["pto-balances"] });
      setRunDialogOpen(false);
      setRunPreview(null);
      toast.success("Payroll posted — checks created!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const voidMutation = useMutation({
    mutationFn: async (runId: string) => {
      // Get the original run's entries
      const originalRun = allRuns.find((r: any) => r.id === runId);
      if (!originalRun) throw new Error("Run not found");
      const origEntries = (originalRun as any).payroll_entries || [];
      if (origEntries.length === 0) throw new Error("No entries to void");

      // Create a reversing payroll run with negative amounts
      const { data: reversal, error: revErr } = await supabase
        .from("payroll_runs")
        .insert({
          period_start: originalRun.period_start,
          period_end: originalRun.period_end,
          status: "reversal",
        })
        .select("id")
        .single();
      if (revErr) throw revErr;

      const reversalEntries = origEntries.map((e: any) => ({
        payroll_run_id: reversal.id,
        employee_id: e.employee_id,
        hours_worked: -(e.hours_worked || 0),
        gross_pay: -(e.gross_pay || 0),
        fed_tax: -(e.fed_tax || 0),
        state_tax: -(e.state_tax || 0),
        ss_tax: -(e.ss_tax || 0),
        medicare_tax: -(e.medicare_tax || 0),
        sdi_tax: -(e.sdi_tax || 0),
        fica: -(e.fica || 0),
        net_pay: -(e.net_pay || 0),
      }));
      const { error: entryErr } = await supabase.from("payroll_entries").insert(reversalEntries);
      if (entryErr) throw entryErr;

      // Mark original run as voided
      const { error: updErr } = await supabase
        .from("payroll_runs")
        .update({ status: "voided" })
        .eq("id", runId);
      if (updErr) throw updErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-payroll-runs"] });
      queryClient.invalidateQueries({ queryKey: ["ytd-totals"] });
      setVoidRunId(null);
      toast.success("Payroll run voided — reversing entries created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteDraftMutation = useMutation({
    mutationFn: async (runId: string) => {
      // Delete entries first, then the run
      await supabase.from("payroll_entries").delete().eq("payroll_run_id", runId);
      const { error } = await supabase.from("payroll_runs").delete().eq("id", runId).eq("status", "draft");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-payroll-runs"] });
      setDeleteDraftId(null);
      toast.success("Draft payroll run deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const entries = (latestRun as any)?.payroll_entries || [];

  const totalGross = entries.reduce((s: number, e: any) => s + (e.gross_pay || 0), 0);
  const totalNet = entries.reduce((s: number, e: any) => s + (e.net_pay || 0), 0);
  const totalTax = entries.reduce((s: number, e: any) => s + (e.fed_tax || 0) + (e.state_tax || 0) + (e.fica || 0), 0);



  const getRunTotals = (run: any) => {
    const re = (run as any)?.payroll_entries || [];
    return {
      employees: re.length,
      gross: re.reduce((s: number, e: any) => s + (e.gross_pay || 0), 0),
      net: re.reduce((s: number, e: any) => s + (e.net_pay || 0), 0),
      tax: re.reduce((s: number, e: any) => s + (e.fed_tax || 0) + (e.state_tax || 0) + (e.fica || 0), 0),
    };
  };

  return (
    <div className="p-8">
      <PageHeader title="Payroll" description="Employee payroll processing with tax withholding"
        actions={
          <div className="flex gap-2">
            <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Add Employee</Button>
            <Button variant="outline" onClick={() => { setRunPreview(null); setRunDialogOpen(true); }}>
              <Play className="w-4 h-4 mr-2" />Run Payroll
            </Button>
          </div>
        }
      />

      {/* Employee Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingId ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Employee #</Label><Input placeholder="E-001" value={form.employee_number} onChange={(e) => setForm({ ...form, employee_number: e.target.value })} /></div>
              <div><Label>SSN</Label><Input placeholder="XXX-XX-XXXX" value={form.ssn} onChange={(e) => setForm({ ...form, ssn: e.target.value })} /></div>
            </div>
            <div><Label>Full Name</Label><Input placeholder="Employee name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Role / Title</Label><Input placeholder="Job title" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></div>
            <div><Label>Email</Label><Input type="email" placeholder="employee@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Address</Label><Input placeholder="Street, City, State ZIP" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Pay Type</Label>
                <Select value={form.pay_type} onValueChange={(v) => setForm({ ...form, pay_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="salary">Salary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Rate</Label><Input type="number" placeholder="$/hr or annual" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Filing Status</Label>
                <Select value={form.filing_status} onValueChange={(v) => setForm({ ...form, filing_status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single</SelectItem>
                    <SelectItem value="married">Married</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Pay Period</Label>
                <Select value={form.pay_period} onValueChange={(v) => setForm({ ...form, pay_period: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                    <SelectItem value="semimonthly">Semimonthly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Allowances</Label><Input type="number" placeholder="0" value={form.withholding_allowances} onChange={(e) => setForm({ ...form, withholding_allowances: e.target.value })} /></div>
              <div>
                <Label>State</Label>
                <Select value={form.state} onValueChange={(v) => setForm({ ...form, state: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CA">California</SelectItem>
                    <SelectItem value="none">No State Tax</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{editingId ? "Update Employee" : "Save Employee"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Run Payroll Dialog */}
      <Dialog open={runDialogOpen} onOpenChange={(open) => { setRunDialogOpen(open); if (!open) setRunPreview(null); }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Run Payroll</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="icon" onClick={() => { setPayWeekStart(subWeeks(payWeekStart, 1)); setRunPreview(null); }}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium min-w-[260px] text-center">
                Week of {format(payWeekStart, "MMM d")} – {format(addDays(payWeekStart, 6), "MMM d, yyyy")}
              </span>
              <Button variant="outline" size="icon" onClick={() => { setPayWeekStart(addWeeks(payWeekStart, 1)); setRunPreview(null); }}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            <div>
              <Label>Bank Account for Checks</Label>
              <Select value={payrollBankAccountId} onValueChange={setPayrollBankAccountId}>
                <SelectTrigger><SelectValue placeholder="Select bank account..." /></SelectTrigger>
                <SelectContent>
                  {bankAccounts.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name} ({a.bank_name}) — Next Check #{a.next_check_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={() => { setRunPreview(null); handlePreviewPayroll(); }} disabled={calculating}>
              {calculating ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Calculating...</> : <><Calculator className="w-4 h-4 mr-2" />{runPreview ? "Recalculate" : "Calculate & Preview"}</>}
            </Button>

            {runPreview && (
              <>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/30 border-b border-border">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Employee</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Hours</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Gross</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Health Ins</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">401k</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Fed Tax</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">State</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">SS</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Medicare</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">SDI</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Post-Tax</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Net Pay</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runPreview.map((p) => (
                        <tr key={p.employee_id} className="border-b border-border/50">
                          <td className="px-3 py-2 font-medium text-card-foreground">{p.employee_name}</td>
                          <td className="px-3 py-2 text-right font-mono text-card-foreground">{p.hours.toFixed(1)}</td>
                          <td className="px-3 py-2 text-right font-mono text-card-foreground">{fmt(p.gross_pay)}</td>
                          <td className="px-3 py-2 text-right font-mono text-destructive">{p.health_insurance > 0 ? fmt(p.health_insurance) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono text-destructive">{p.retirement_401k > 0 ? fmt(p.retirement_401k) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(p.fed_tax)}</td>
                          <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(p.state_tax)}</td>
                          <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(p.ss_tax)}</td>
                          <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(p.medicare_tax)}</td>
                          <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(p.sdi_tax)}</td>
                          <td className="px-3 py-2 text-right font-mono text-destructive">{p.deductions_posttax > 0 ? fmt(p.deductions_posttax) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-card-foreground">{fmt(p.net_pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/30 font-semibold">
                        <td className="px-3 py-2 text-card-foreground">Totals</td>
                        <td className="px-3 py-2 text-right font-mono text-card-foreground">{runPreview.reduce((s, p) => s + p.hours, 0).toFixed(1)}</td>
                        <td className="px-3 py-2 text-right font-mono text-card-foreground">{fmt(runPreview.reduce((s, p) => s + p.gross_pay, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(runPreview.reduce((s, p) => s + p.health_insurance, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(runPreview.reduce((s, p) => s + p.retirement_401k, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(runPreview.reduce((s, p) => s + p.fed_tax, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(runPreview.reduce((s, p) => s + p.state_tax, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(runPreview.reduce((s, p) => s + p.ss_tax, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(runPreview.reduce((s, p) => s + p.medicare_tax, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(runPreview.reduce((s, p) => s + p.sdi_tax, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive">{fmt(runPreview.reduce((s, p) => s + p.deductions_posttax, 0))}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-card-foreground">{fmt(runPreview.reduce((s, p) => s + p.net_pay, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setRunPreview(null)}>Recalculate</Button>
                  <Button onClick={() => commitPayroll.mutate()} disabled={commitPayroll.isPending || !payrollBankAccountId}>
                    {commitPayroll.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Posting...</> : "Post Payroll"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} title="Deactivate employee?"
        description="The employee will be deactivated but their payroll history will be preserved." />

      <DeleteConfirmDialog open={!!voidRunId} onOpenChange={() => setVoidRunId(null)}
        onConfirm={() => voidRunId && voidMutation.mutate(voidRunId)} title="Void this payroll run?"
        description="This will create a reversing entry with negative amounts and mark the original run as voided. This cannot be undone." />

      <DeleteConfirmDialog open={!!deleteDraftId} onOpenChange={() => setDeleteDraftId(null)}
        onConfirm={() => deleteDraftId && deleteDraftMutation.mutate(deleteDraftId)} title="Delete draft payroll run?"
        description="This will permanently delete this draft payroll run and all its entries. This cannot be undone." />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatCard title="Gross Pay" value={fmt(totalGross)} icon={DollarSign} />
        <StatCard title="Total Withholding" value={fmt(totalTax)} icon={Calculator} />
        <StatCard title="Net Pay" value={fmt(totalNet)} icon={Users} />
      </div>

      <Tabs defaultValue="employees">
        <TabsList className="mb-4">
          <TabsTrigger value="employees"><Users className="w-4 h-4 mr-2" />Employees</TabsTrigger>
          <TabsTrigger value="pto"><Clock className="w-4 h-4 mr-2" />PTO Balances</TabsTrigger>
          <TabsTrigger value="history"><History className="w-4 h-4 mr-2" />Payroll History</TabsTrigger>
        </TabsList>

        {/* ── Employees Tab ── */}
        <TabsContent value="employees">
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border"><h2 className="font-display font-semibold text-card-foreground">Employees</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employee #</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Type</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Rate</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Filing</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground">Period</th>
                    <th className="text-center px-4 py-3 font-medium text-muted-foreground w-20">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
                  ) : employees.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No employees yet.</td></tr>
                  ) : employees.map((emp: any) => (
                    <tr key={emp.id} className="table-row-hover border-b border-border/50">
                      <td className="px-4 py-3 font-mono text-xs text-card-foreground">{emp.employee_number}</td>
                      <td className="px-4 py-3 font-medium text-card-foreground">{emp.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{emp.role}</td>
                      <td className="px-4 py-3 text-center"><span className="px-2 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">{emp.pay_type}</span></td>
                      <td className="px-4 py-3 text-right font-mono text-card-foreground">{emp.pay_type === "salary" ? `$${(emp.rate || 0).toLocaleString()}/yr` : `$${(emp.rate || 0).toFixed(2)}/hr`}</td>
                      <td className="px-4 py-3 text-center text-xs text-muted-foreground capitalize">{emp.filing_status || "single"}</td>
                      <td className="px-4 py-3 text-center text-xs text-muted-foreground capitalize">{emp.pay_period || "weekly"}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(emp)}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteId(emp.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* ── PTO Tab ── */}
        <TabsContent value="pto">
          <EmployeePTO employees={employees} />
        </TabsContent>

        {/* ── History Tab ── */}
        <TabsContent value="history">
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h2 className="font-display font-semibold text-card-foreground">Payroll History</h2>
            </div>

            {allRuns.length === 0 ? (
              <div className="px-6 py-12 text-center text-muted-foreground">No payroll runs yet.</div>
            ) : (
              <div className="divide-y divide-border">
                {allRuns.map((run: any) => {
                  const t = getRunTotals(run);
                  const isExpanded = expandedRunId === run.id;
                  const runEntries = (run as any).payroll_entries || [];

                  return (
                    <div key={run.id}>
                      {/* Summary row */}
                      <button
                        onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                        className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex-shrink-0">
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
                          <div>
                            <span className="text-xs text-muted-foreground block">Pay Period</span>
                            <span className="font-medium text-card-foreground">{run.period_start} — {run.period_end}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">Run Date</span>
                            <span className="text-card-foreground">{run.run_date}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">Employees</span>
                            <span className="text-card-foreground">{t.employees}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">Gross</span>
                            <span className="font-mono text-card-foreground">{fmt(t.gross)}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">Taxes</span>
                            <span className="font-mono text-destructive">{fmt(t.tax)}</span>
                          </div>
                          <div>
                            <span className="text-xs text-muted-foreground block">Net</span>
                            <span className="font-mono font-semibold text-card-foreground">{fmt(t.net)}</span>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs capitalize flex-shrink-0 ${
                          run.status === "voided" ? "bg-destructive/15 text-destructive" :
                          run.status === "reversal" ? "bg-accent text-accent-foreground" :
                          "bg-secondary text-secondary-foreground"
                        }`}>{run.status}</span>
                      </button>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="px-6 pb-4">
                          <div className="flex justify-end gap-2 mb-2">
                            {run.status === "draft" && (
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteDraftId(run.id)}>
                                <Trash2 className="w-4 h-4 mr-2" />Delete Draft
                              </Button>
                            )}
                            {(run.status === "posted" || run.status === "paid") && (
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setVoidRunId(run.id)}>
                                <RotateCcw className="w-4 h-4 mr-2" />Void Run
                              </Button>
                            )}
                            <Button size="sm" variant="outline" onClick={() => setHistoryStubsRun(run)}>
                              <Printer className="w-4 h-4 mr-2" />Pay Stubs
                            </Button>
                          </div>
                          <div className="overflow-x-auto rounded-lg border border-border">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-border bg-muted/30">
                                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Employee</th>
                                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Hours</th>
                                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Gross</th>
                                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Fed Tax</th>
                                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">State</th>
                                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">SS</th>
                                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Medicare</th>
                                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">SDI</th>
                                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Net Pay</th>
                                </tr>
                              </thead>
                              <tbody>
                                {runEntries.map((e: any) => (
                                  <tr key={e.id} className="border-b border-border/50">
                                    <td className="px-4 py-2 font-medium text-card-foreground">{e.employees?.name || "—"}</td>
                                    <td className="px-4 py-2 text-right font-mono text-card-foreground">{(e.hours_worked || 0).toFixed(1)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-card-foreground">{fmt(e.gross_pay)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-destructive">{fmt(e.fed_tax)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-destructive">{fmt(e.state_tax)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-destructive">{fmt(e.ss_tax || 0)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-destructive">{fmt(e.medicare_tax || 0)}</td>
                                    <td className="px-4 py-2 text-right font-mono text-destructive">{fmt(e.sdi_tax || 0)}</td>
                                    <td className="px-4 py-2 text-right font-mono font-semibold text-card-foreground">{fmt(e.net_pay)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Pay Stubs dialog for history drill-down */}
      {historyStubsRun && (
        <PayStubsDialog
          open={!!historyStubsRun}
          onOpenChange={(open) => { if (!open) setHistoryStubsRun(null); }}
          entries={(historyStubsRun as any).payroll_entries || []}
          periodStart={historyStubsRun.period_start || ""}
          periodEnd={historyStubsRun.period_end || ""}
          runDate={historyStubsRun.run_date || ""}
          ytdByEmployee={ytdByEmployee || {}}
        />
      )}
    </div>
  );
}
