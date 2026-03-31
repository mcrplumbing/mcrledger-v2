import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import JobSelect from "@/components/JobSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, Save, Trash2, Clock, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { format, startOfWeek, addDays, subWeeks, addWeeks } from "date-fns";

const PAY_CLASSES = ["Regular", "Double Time", "Vacation", "Sick", "Bonus"] as const;
type PayClass = (typeof PAY_CLASSES)[number];
const PAY_CLASS_DB: Record<PayClass, string> = { Regular: "regular", "Double Time": "double", Vacation: "vacation", Sick: "sick", Bonus: "bonus" };
const PAY_CLASS_LABEL: Record<string, PayClass> = { regular: "Regular", double: "Double Time", vacation: "Vacation", sick: "Sick", bonus: "Bonus" };
const PAY_MULTIPLIER: Record<string, number> = { regular: 1, double: 2, vacation: 1, sick: 1, bonus: 0 };
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface GridRow {
  id?: string; // existing DB id (one per row — we'll store one entry per row with total hours)
  job_id: string;
  pay_class: string;
  description: string;
  hours: number[]; // 7 days
  dirty: boolean;
  isNew: boolean;
}

function getWeekStart(d: Date) {
  return startOfWeek(d, { weekStartsOn: 1 }); // Monday
}

function weekDates(weekStart: Date) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export default function Timesheets() {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [rows, setRows] = useState<GridRow[]>([]);
  const [hasDeleted, setHasDeleted] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const dates = useMemo(() => weekDates(weekStart), [weekStart]);
  const weekKey = format(weekStart, "yyyy-MM-dd");

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id, name, employee_number, rate, pay_type").eq("active", true).order("name");
      if (error) throw error;
      return data;
    },
  });

  const employee = employees.find((e) => e.id === selectedEmployee);

  // Fetch timesheets for selected employee + week
  const { data: rawEntries = [], isLoading } = useQuery({
    queryKey: ["timesheets-grid", selectedEmployee, weekKey],
    queryFn: async () => {
      if (!selectedEmployee) return [];
      const weekEnd = format(addDays(weekStart, 6), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("timesheets")
        .select("*, jobs(job_number, name)")
        .eq("employee_id", selectedEmployee)
        .gte("date", weekKey)
        .lte("date", weekEnd)
        .order("date");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedEmployee,
  });

  // Build grid rows from raw entries when data changes
  useEffect(() => {
    if (!selectedEmployee) { setRows([]); setLoaded(false); return; }
    // Group entries by (job_id, pay_class)
    const map = new Map<string, GridRow>();
    for (const e of rawEntries) {
      const key = `${e.job_id}::${e.pay_class || "regular"}`;
      if (!map.has(key)) {
        map.set(key, {
          id: e.id,
          job_id: e.job_id,
          pay_class: e.pay_class || "regular",
          description: e.description || "",
          hours: [0, 0, 0, 0, 0, 0, 0],
          dirty: false,
          isNew: false,
        });
      }
      const row = map.get(key)!;
      const dayIdx = dates.findIndex((d) => format(d, "yyyy-MM-dd") === e.date);
      if (dayIdx >= 0) row.hours[dayIdx] = e.hours || 0;
    }
    setRows(Array.from(map.values()));
    setLoaded(true);
  }, [rawEntries, selectedEmployee, weekKey]);

  const addRow = () => {
    setRows((prev) => [...prev, {
      job_id: "",
      pay_class: "regular",
      description: "",
      hours: [0, 0, 0, 0, 0, 0, 0],
      dirty: true,
      isNew: true,
    }]);
  };

  const updateRow = (idx: number, field: string, value: any) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value, dirty: true } : r));
  };

  const updateHour = (rowIdx: number, dayIdx: number, val: string) => {
    setRows((prev) => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const hours = [...r.hours];
      hours[dayIdx] = parseFloat(val) || 0;
      return { ...r, hours, dirty: true };
    }));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setHasDeleted(true);
  };

  const rowTotal = (row: GridRow) => row.hours.reduce((a, b) => a + b, 0);

  const rowGross = (row: GridRow) => {
    if (!employee) return 0;
    const total = rowTotal(row);
    const mult = PAY_MULTIPLIER[row.pay_class] ?? 1;
    if (row.pay_class === "bonus") return total; // bonus hours = flat dollar amount
    return total * employee.rate * mult;
  };

  const grandTotalHours = rows.reduce((s, r) => s + rowTotal(r), 0);
  const grandTotalGross = rows.reduce((s, r) => s + rowGross(r), 0);

  // Column totals per day
  const dayTotals = useMemo(() => {
    const totals = [0, 0, 0, 0, 0, 0, 0];
    for (const row of rows) {
      for (let d = 0; d < 7; d++) totals[d] += row.hours[d];
    }
    return totals;
  }, [rows]);

  // Save all dirty rows
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEmployee) throw new Error("Select an employee first");
      const dirtyRows = rows.filter((r) => r.dirty && r.job_id);
      if (dirtyRows.length === 0 && !hasDeleted) throw new Error("No changes to save");

      // Delete existing entries for this employee/week and re-insert
      const weekEnd = format(addDays(weekStart, 6), "yyyy-MM-dd");
      await supabase.from("timesheets").delete()
        .eq("employee_id", selectedEmployee)
        .gte("date", weekKey)
        .lte("date", weekEnd);

      // Insert individual day entries for each row
      const inserts: any[] = [];
      for (const row of rows) {
        if (!row.job_id) continue;
        for (let d = 0; d < 7; d++) {
          if (row.hours[d] > 0) {
            inserts.push({
              employee_id: selectedEmployee,
              job_id: row.job_id,
              date: format(dates[d], "yyyy-MM-dd"),
              hours: row.hours[d],
              pay_class: row.pay_class,
              description: row.description,
            });
          }
        }
      }
      if (inserts.length > 0) {
        const { error } = await supabase.from("timesheets").insert(inserts);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["timesheets-grid"] });
      setHasDeleted(false);
      toast.success("Timesheet saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const hasDirty = rows.some((r) => r.dirty) || hasDeleted;

  return (
    <div className="p-8">
      <PageHeader title="Timesheets" description="Weekly time entry grid by employee" />

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <div className="w-64">
          <Select value={selectedEmployee} onValueChange={(v) => { setSelectedEmployee(v); setLoaded(false); }}>
            <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>
              {employees.map((e) => (
                <SelectItem key={e.id} value={e.id}>{e.employee_number} – {e.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart(subWeeks(weekStart, 1))}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-sm font-medium min-w-[220px] text-center">
            Week of {format(weekStart, "MMM d")} – {format(addDays(weekStart, 6), "MMM d, yyyy")}
          </span>
          <Button variant="outline" size="icon" onClick={() => setWeekStart(addWeeks(weekStart, 1))}><ChevronRight className="w-4 h-4" /></Button>
        </div>

        {employee && (
          <span className="text-sm text-muted-foreground ml-auto">
            Rate: ${employee.rate.toFixed(2)}/{employee.pay_type === "salary" ? "yr" : "hr"}
          </span>
        )}
      </div>

      {/* Summary Cards */}
      {selectedEmployee && (
        <div className="grid grid-cols-2 gap-4 mb-6 max-w-md">
          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Hours</p>
                <p className="text-2xl font-display font-bold mt-1 text-card-foreground">{grandTotalHours.toFixed(1)}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><Clock className="w-5 h-5 text-primary" /></div>
            </div>
          </div>
          <div className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Gross Pay</p>
                <p className="text-2xl font-display font-bold mt-1 text-card-foreground">${grandTotalGross.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center"><DollarSign className="w-5 h-5 text-success" /></div>
            </div>
          </div>
        </div>
      )}

      {!selectedEmployee ? (
        <div className="glass-card rounded-xl p-12 text-center text-muted-foreground">Select an employee to begin entering time.</div>
      ) : isLoading ? (
        <div className="glass-card rounded-xl p-12 text-center text-muted-foreground">Loading…</div>
      ) : (
        <>
          {/* Spreadsheet Grid */}
          <div className="glass-card rounded-xl overflow-hidden mb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[200px]">Job</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[130px]">Pay Class</th>
                    {dates.map((d, i) => (
                      <th key={i} className="text-center px-2 py-2 font-medium text-muted-foreground min-w-[70px]">
                        <div>{DAY_LABELS[i]}</div>
                        <div className="text-[10px] font-normal">{format(d, "M/d")}</div>
                      </th>
                    ))}
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground min-w-[70px]">Total</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground min-w-[90px]">Gross $</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-1 py-1">
                        <JobSelect value={row.job_id} onValueChange={(v) => updateRow(ri, "job_id", v)} placeholder="Job…" />
                      </td>
                      <td className="px-1 py-1">
                        <Select value={row.pay_class} onValueChange={(v) => updateRow(ri, "pay_class", v)}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PAY_CLASSES.map((pc) => (
                              <SelectItem key={pc} value={PAY_CLASS_DB[pc]}>{pc}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      {row.hours.map((h, di) => (
                        <td key={di} className="px-1 py-1">
                          <Input
                            type="number"
                            step="0.25"
                            min="0"
                            className="h-9 w-16 text-center text-xs font-mono px-1"
                            value={h || ""}
                            onChange={(e) => updateHour(ri, di, e.target.value)}
                            placeholder="—"
                          />
                        </td>
                      ))}
                      <td className="px-3 py-1 text-right font-mono font-semibold text-card-foreground">{rowTotal(row).toFixed(1)}</td>
                      <td className="px-3 py-1 text-right font-mono font-semibold text-success">${rowGross(row).toFixed(2)}</td>
                      <td className="px-1 py-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => removeRow(ri)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {/* Day Totals Row */}
                  <tr className="bg-muted/30 border-t border-border">
                    <td className="px-3 py-2 font-medium text-muted-foreground" colSpan={2}>Daily Totals</td>
                    {dayTotals.map((t, i) => (
                      <td key={i} className="px-2 py-2 text-center font-mono font-semibold text-card-foreground">{t > 0 ? t.toFixed(1) : "—"}</td>
                    ))}
                    <td className="px-3 py-2 text-right font-mono font-bold text-card-foreground">{grandTotalHours.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-success">${grandTotalGross.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={addRow}><Plus className="w-4 h-4 mr-2" />Add Row</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !hasDirty}>
              <Save className="w-4 h-4 mr-2" />{saveMutation.isPending ? "Saving…" : "Save Timesheet"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
