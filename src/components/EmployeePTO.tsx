import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Clock, Pencil } from "lucide-react";
import { toast } from "sonner";

interface EmployeePTOProps {
  employees: any[];
}

export default function EmployeePTO({ employees }: EmployeePTOProps) {
  const queryClient = useQueryClient();
  const [adjustDialog, setAdjustDialog] = useState(false);
  const [adjustEmpId, setAdjustEmpId] = useState("");
  const [adjustType, setAdjustType] = useState("sick");
  const [adjustHours, setAdjustHours] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const [rateDialog, setRateDialog] = useState(false);
  const [rateEmpId, setRateEmpId] = useState("");
  const [rateValue, setRateValue] = useState("");

  const { data: ptoBalances = [] } = useQuery({
    queryKey: ["pto-balances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_pto")
        .select("*");
      if (error) throw error;
      return data || [];
    },
  });

  const getBalance = (empId: string, type: string) => {
    const rec = ptoBalances.find((p: any) => p.employee_id === empId && p.pto_type === type);
    return rec?.balance || 0;
  };

  const getAccrualRate = (empId: string) => {
    const rec = ptoBalances.find((p: any) => p.employee_id === empId && p.pto_type === "vacation");
    return rec?.accrual_rate || 0;
  };

  // Manual adjustment (mainly for sick pay)
  const adjustMutation = useMutation({
    mutationFn: async () => {
      const hours = parseFloat(adjustHours) || 0;
      if (hours === 0) throw new Error("Hours must not be zero");

      // Upsert PTO balance
      const current = getBalance(adjustEmpId, adjustType);
      const newBalance = current + hours;

      const { error: upsertErr } = await supabase
        .from("employee_pto")
        .upsert({
          employee_id: adjustEmpId,
          pto_type: adjustType,
          balance: newBalance,
          accrual_rate: adjustType === "vacation" ? getAccrualRate(adjustEmpId) : 0,
        }, { onConflict: "employee_id,pto_type" });
      if (upsertErr) throw upsertErr;

      // Log to ledger
      const { error: ledgerErr } = await supabase
        .from("pto_ledger")
        .insert({
          employee_id: adjustEmpId,
          pto_type: adjustType,
          hours,
          reason: adjustReason || (hours > 0 ? "Manual credit" : "Manual deduction"),
        });
      if (ledgerErr) throw ledgerErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pto-balances"] });
      setAdjustDialog(false);
      toast.success("PTO balance adjusted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Set vacation accrual rate
  const rateMutation = useMutation({
    mutationFn: async () => {
      const rate = parseFloat(rateValue) || 0;
      const { error } = await supabase
        .from("employee_pto")
        .upsert({
          employee_id: rateEmpId,
          pto_type: "vacation",
          balance: getBalance(rateEmpId, "vacation"),
          accrual_rate: rate,
        }, { onConflict: "employee_id,pto_type" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pto-balances"] });
      setRateDialog(false);
      toast.success("Vacation accrual rate updated");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openAdjust = (empId: string, type: string = "sick") => {
    setAdjustEmpId(empId);
    setAdjustType(type);
    setAdjustHours("");
    setAdjustReason(type === "sick" ? "Annual sick pay credit" : "");
    setAdjustDialog(true);
  };

  const openRate = (empId: string) => {
    setRateEmpId(empId);
    setRateValue(String(getAccrualRate(empId)));
    setRateDialog(true);
  };

  const fmt = (n: number) => n.toFixed(1);

  return (
    <>
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-display font-semibold text-card-foreground">PTO Balances</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Employee</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Vacation (hrs)</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Accrual/wk</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Sick (hrs)</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground w-48">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No employees.</td></tr>
              ) : employees.map((emp: any) => (
                <tr key={emp.id} className="table-row-hover border-b border-border/50">
                  <td className="px-4 py-3 font-medium text-card-foreground">{emp.name}</td>
                  <td className="px-4 py-3 text-right font-mono text-card-foreground">{fmt(getBalance(emp.id, "vacation"))}</td>
                  <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                    {getAccrualRate(emp.id) > 0 ? `${fmt(getAccrualRate(emp.id))} hrs` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-card-foreground">{fmt(getBalance(emp.id, "sick"))}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openRate(emp.id)} title="Set vacation accrual rate">
                        <Pencil className="w-3 h-3 mr-1" />Accrual
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openAdjust(emp.id, "sick")} title="Adjust sick balance">
                        <Plus className="w-3 h-3 mr-1" />Sick
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openAdjust(emp.id, "vacation")} title="Adjust vacation balance">
                        <Plus className="w-3 h-3 mr-1" />Vacation
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual Adjustment Dialog */}
      <Dialog open={adjustDialog} onOpenChange={setAdjustDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust {adjustType === "sick" ? "Sick" : "Vacation"} Pay Balance</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="text-sm text-muted-foreground">
              Employee: <strong className="text-card-foreground">{employees.find(e => e.id === adjustEmpId)?.name}</strong>
            </div>
            <div className="text-sm text-muted-foreground">
              Current balance: <strong className="font-mono text-card-foreground">{fmt(getBalance(adjustEmpId, adjustType))} hrs</strong>
            </div>
            <div>
              <Label>Hours to Add/Subtract</Label>
              <Input type="number" step="0.5" placeholder="e.g. 48 or -8" value={adjustHours}
                onChange={(e) => setAdjustHours(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Use negative to deduct hours</p>
            </div>
            <div>
              <Label>Reason</Label>
              <Input placeholder="e.g. Annual sick credit, manual correction" value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)} />
            </div>
            <Button onClick={() => adjustMutation.mutate()} disabled={adjustMutation.isPending || !adjustHours}>
              {adjustMutation.isPending ? "Saving..." : "Apply Adjustment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vacation Accrual Rate Dialog */}
      <Dialog open={rateDialog} onOpenChange={setRateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set Vacation Accrual Rate</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="text-sm text-muted-foreground">
              Employee: <strong className="text-card-foreground">{employees.find(e => e.id === rateEmpId)?.name}</strong>
            </div>
            <div>
              <Label>Hours Accrued Per Week</Label>
              <Input type="number" step="0.01" placeholder="e.g. 1.54" value={rateValue}
                onChange={(e) => setRateValue(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">
                Examples: 1 week/yr = 0.77 hrs/wk · 2 weeks/yr = 1.54 hrs/wk · 3 weeks/yr = 2.31 hrs/wk
              </p>
            </div>
            <Button onClick={() => rateMutation.mutate()} disabled={rateMutation.isPending}>
              {rateMutation.isPending ? "Saving..." : "Save Accrual Rate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
