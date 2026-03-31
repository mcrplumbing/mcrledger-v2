import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";

const FUTA_RATE = 0.006; // 0.6% after credit
const FUTA_WAGE_BASE = 7000;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const QUARTERS = [
  { label: "Q1 (Jan–Mar)", start: "01-01", end: "03-31" },
  { label: "Q2 (Apr–Jun)", start: "04-01", end: "06-30" },
  { label: "Q3 (Jul–Sep)", start: "07-01", end: "09-30" },
  { label: "Q4 (Oct–Dec)", start: "10-01", end: "12-31" },
];

const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PayrollCompliance() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [quarter, setQuarter] = useState("0");

  const { data: payrollRuns = [] } = useQuery({
    queryKey: ["payroll-runs-compliance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("payroll_runs").select("*").order("period_start");
      if (error) throw error;
      return data;
    },
  });

  const { data: payrollEntries = [] } = useQuery({
    queryKey: ["payroll-entries-compliance"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payroll_entries")
        .select("*, employees(name, employee_number)");
      if (error) throw error;
      return data;
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-compliance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("*").order("employee_number");
      if (error) throw error;
      return data;
    },
  });

  // Map runs by ID for quick lookup
  const runsById = useMemo(() => {
    const map: Record<string, typeof payrollRuns[0]> = {};
    payrollRuns.forEach((r) => (map[r.id] = r));
    return map;
  }, [payrollRuns]);

  // Filter entries by year and optionally quarter
  const filterEntries = (q?: number) => {
    const y = Number(year);
    const qData = q !== undefined ? QUARTERS[q] : null;
    return payrollEntries.filter((e) => {
      const run = runsById[e.payroll_run_id];
      if (!run) return false;
      const runDate = run.period_end;
      if (!qData) {
        return runDate >= `${y}-01-01` && runDate <= `${y}-12-31`;
      }
      return runDate >= `${y}-${qData.start}` && runDate <= `${y}-${qData.end}`;
    });
  };

  // ===================== 941 =====================
  const q941Entries = filterEntries(Number(quarter));
  const totalWages941 = q941Entries.reduce((s, e) => s + (e.gross_pay || 0), 0);
  const totalFedWithheld = q941Entries.reduce((s, e) => s + (e.fed_tax || 0), 0);
  const totalFica = q941Entries.reduce((s, e) => s + (e.fica || 0), 0);
  // Employer match for SS + Medicare
  const totalSSWages = totalWages941; // simplified — no wage base cap here for 941
  const employerSS = totalSSWages * SS_RATE;
  const employerMedicare = totalWages941 * MEDICARE_RATE;
  const totalSSTax = totalFica + employerSS + employerMedicare; // employee + employer portions
  const totalTaxLiability941 = totalFedWithheld + totalSSTax;

  // ===================== 940 =====================
  const yearEntries = filterEntries();
  const futaByEmployee = useMemo(() => {
    const map: Record<string, { name: string; empNo: string; totalWages: number; futaWages: number }> = {};
    yearEntries.forEach((e) => {
      const empName = (e as any).employees?.name || "Unknown";
      const empNo = (e as any).employees?.employee_number || "";
      if (!map[e.employee_id]) {
        map[e.employee_id] = { name: empName, empNo, totalWages: 0, futaWages: 0 };
      }
      map[e.employee_id].totalWages += e.gross_pay || 0;
    });
    Object.values(map).forEach((emp) => {
      emp.futaWages = Math.min(emp.totalWages, FUTA_WAGE_BASE);
    });
    return Object.values(map);
  }, [yearEntries]);

  const totalFutaWages = futaByEmployee.reduce((s, e) => s + e.futaWages, 0);
  const totalFutaTax = totalFutaWages * FUTA_RATE;

  // ===================== W-2 =====================
  const w2Data = useMemo(() => {
    const map: Record<string, {
      name: string; empNo: string; grossWages: number; fedWithheld: number;
      ssWages: number; ssTax: number; medicareWages: number; medicareTax: number;
      stateWages: number; stateWithheld: number;
    }> = {};
    yearEntries.forEach((e) => {
      const empName = (e as any).employees?.name || "Unknown";
      const empNo = (e as any).employees?.employee_number || "";
      if (!map[e.employee_id]) {
        map[e.employee_id] = {
          name: empName, empNo, grossWages: 0, fedWithheld: 0,
          ssWages: 0, ssTax: 0, medicareWages: 0, medicareTax: 0,
          stateWages: 0, stateWithheld: 0,
        };
      }
      const m = map[e.employee_id];
      m.grossWages += e.gross_pay || 0;
      m.fedWithheld += e.fed_tax || 0;
      m.ssTax += (e.fica || 0) * (SS_RATE / (SS_RATE + MEDICARE_RATE)); // approximate split
      m.medicareTax += (e.fica || 0) * (MEDICARE_RATE / (SS_RATE + MEDICARE_RATE));
      m.ssWages += e.gross_pay || 0;
      m.medicareWages += e.gross_pay || 0;
      m.stateWages += e.gross_pay || 0;
      m.stateWithheld += e.state_tax || 0;
    });
    return Object.values(map);
  }, [yearEntries]);

  const exportW2CSV = () => {
    const headers = ["Employee #", "Name", "Gross Wages", "Fed Withheld", "SS Wages", "SS Tax", "Medicare Wages", "Medicare Tax", "State Wages", "State Withheld"];
    const rows = w2Data.map((w) => [
      w.empNo, w.name, w.grossWages.toFixed(2), w.fedWithheld.toFixed(2),
      w.ssWages.toFixed(2), w.ssTax.toFixed(2), w.medicareWages.toFixed(2), w.medicareTax.toFixed(2),
      w.stateWages.toFixed(2), w.stateWithheld.toFixed(2),
    ]);
    downloadCSV(`w2-data-${year}.csv`, headers, rows);
    toast.success("W-2 data exported");
  };

  const export941CSV = () => {
    const headers = ["Line", "Description", "Amount"];
    const rows = [
      ["2", "Total wages, tips, other compensation", totalWages941.toFixed(2)],
      ["3", "Federal income tax withheld", totalFedWithheld.toFixed(2)],
      ["5a", "Taxable social security wages", totalSSWages.toFixed(2)],
      ["5c", "Taxable Medicare wages", totalWages941.toFixed(2)],
      ["5e", "Total social security and Medicare taxes", totalSSTax.toFixed(2)],
      ["10", "Total taxes after adjustments", totalTaxLiability941.toFixed(2)],
    ];
    downloadCSV(`941-q${Number(quarter) + 1}-${year}.csv`, headers, rows);
    toast.success("941 data exported");
  };

  const LineItem = ({ line, label, amount, bold }: { line: string; label: string; amount: number; bold?: boolean }) => (
    <div className={cn("flex items-center gap-4 py-2 border-b border-border/50", bold && "font-bold border-b-2 border-border")}>
      <span className="w-12 text-xs font-mono text-muted-foreground">{line}</span>
      <span className="flex-1 text-card-foreground">{label}</span>
      <span className="font-mono text-card-foreground">{fmt(amount)}</span>
    </div>
  );

  return (
    <div className="p-8">
      <PageHeader title="Payroll Compliance" description="941 quarterly, 940 annual FUTA, and W-2/1099 preparation" />

      <div className="flex items-center gap-4 mb-6">
        <div>
          <Label className="text-xs text-muted-foreground">Tax Year</Label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="941">
        <TabsList className="mb-6">
          <TabsTrigger value="941">Form 941</TabsTrigger>
          <TabsTrigger value="940">Form 940</TabsTrigger>
          <TabsTrigger value="w2">W-2 / 1099</TabsTrigger>
        </TabsList>

        {/* =================== FORM 941 =================== */}
        <TabsContent value="941">
          <div className="flex items-center gap-4 mb-4">
            <div>
              <Label className="text-xs text-muted-foreground">Quarter</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUARTERS.map((q, i) => (
                    <SelectItem key={i} value={String(i)}>{q.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" className="mt-5" onClick={export941CSV}>
              <Download className="w-4 h-4 mr-2" /> Export CSV
            </Button>
          </div>

          <div className="glass-card rounded-xl p-6">
            <h3 className="font-display font-semibold text-lg text-card-foreground mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Form 941 — Employer's Quarterly Federal Tax Return
            </h3>
            <div className="max-w-2xl space-y-0">
              <LineItem line="1" label="Number of employees who received wages" amount={new Set(q941Entries.map((e) => e.employee_id)).size} />
              <LineItem line="2" label="Wages, tips, and other compensation" amount={totalWages941} />
              <LineItem line="3" label="Federal income tax withheld" amount={totalFedWithheld} />
              <div className="py-2 mt-2"><span className="text-xs font-medium text-muted-foreground">SOCIAL SECURITY & MEDICARE</span></div>
              <LineItem line="5a" label="Taxable social security wages" amount={totalSSWages} />
              <LineItem line="5a×" label="Social security tax (employee + employer)" amount={totalSSWages * SS_RATE * 2} />
              <LineItem line="5c" label="Taxable Medicare wages & tips" amount={totalWages941} />
              <LineItem line="5c×" label="Medicare tax (employee + employer)" amount={totalWages941 * MEDICARE_RATE * 2} />
              <LineItem line="5e" label="Total social security and Medicare taxes" amount={totalSSTax} bold />
              <LineItem line="6" label="Total taxes before adjustments (line 3 + 5e)" amount={totalTaxLiability941} bold />
              <div className="py-2 mt-2"><span className="text-xs font-medium text-muted-foreground">DEPOSITS</span></div>
              <LineItem line="10" label="Total taxes after adjustments" amount={totalTaxLiability941} bold />
            </div>
            {q941Entries.length === 0 && (
              <p className="text-sm text-muted-foreground mt-4">No payroll runs found for {QUARTERS[Number(quarter)].label} {year}.</p>
            )}
          </div>
        </TabsContent>

        {/* =================== FORM 940 =================== */}
        <TabsContent value="940">
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-display font-semibold text-lg text-card-foreground mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Form 940 — Employer's Annual Federal Unemployment (FUTA) Tax Return — {year}
            </h3>
            <div className="max-w-2xl space-y-0 mb-6">
              <LineItem line="3" label="Total payments to all employees" amount={yearEntries.reduce((s, e) => s + (e.gross_pay || 0), 0)} />
              <LineItem line="7" label="Total taxable FUTA wages" amount={totalFutaWages} />
              <LineItem line="8" label={`FUTA tax before adjustments (${(FUTA_RATE * 100).toFixed(1)}%)`} amount={totalFutaTax} bold />
              <LineItem line="14" label="Total FUTA tax after adjustments" amount={totalFutaTax} bold />
            </div>

            <h4 className="font-medium text-muted-foreground mb-2 text-sm">Per-Employee FUTA Breakdown</h4>
            <div className="glass-card rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-6 py-3 font-medium text-muted-foreground">Employee</th>
                    <th className="text-right px-6 py-3 font-medium text-muted-foreground">Total Wages</th>
                    <th className="text-right px-6 py-3 font-medium text-muted-foreground">FUTA Wages (≤{fmt(FUTA_WAGE_BASE)})</th>
                    <th className="text-right px-6 py-3 font-medium text-muted-foreground">FUTA Tax</th>
                  </tr>
                </thead>
                <tbody>
                  {futaByEmployee.length === 0 ? (
                    <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No payroll data for {year}.</td></tr>
                  ) : futaByEmployee.map((emp, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-6 py-3 font-medium text-card-foreground">{emp.empNo} — {emp.name}</td>
                      <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(emp.totalWages)}</td>
                      <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(emp.futaWages)}</td>
                      <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(emp.futaWages * FUTA_RATE)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20 font-bold">
                    <td className="px-6 py-3 text-card-foreground">Totals</td>
                    <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(futaByEmployee.reduce((s, e) => s + e.totalWages, 0))}</td>
                    <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(totalFutaWages)}</td>
                    <td className="px-6 py-3 text-right font-mono font-bold text-card-foreground">{fmt(totalFutaTax)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* =================== W-2 / 1099 =================== */}
        <TabsContent value="w2">
          <div className="flex items-center gap-4 mb-4">
            <Button variant="outline" size="sm" onClick={exportW2CSV}>
              <Download className="w-4 h-4 mr-2" /> Export W-2 Data CSV
            </Button>
          </div>

          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Emp #</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Gross Wages</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Fed W/H</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">SS Tax</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Medicare</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">State W/H</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Net Pay</th>
                </tr>
              </thead>
              <tbody>
                {w2Data.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No payroll data for {year}.</td></tr>
                ) : w2Data.map((w, i) => {
                  const netPay = w.grossWages - w.fedWithheld - w.ssTax - w.medicareTax - w.stateWithheld;
                  return (
                    <tr key={i} className="border-b border-border/50">
                      <td className="px-4 py-3 font-mono text-xs text-card-foreground">{w.empNo}</td>
                      <td className="px-4 py-3 font-medium text-card-foreground">{w.name}</td>
                      <td className="px-4 py-3 text-right font-mono text-card-foreground">{fmt(w.grossWages)}</td>
                      <td className="px-4 py-3 text-right font-mono text-destructive">{fmt(w.fedWithheld)}</td>
                      <td className="px-4 py-3 text-right font-mono text-destructive">{fmt(w.ssTax)}</td>
                      <td className="px-4 py-3 text-right font-mono text-destructive">{fmt(w.medicareTax)}</td>
                      <td className="px-4 py-3 text-right font-mono text-destructive">{fmt(w.stateWithheld)}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-success">{fmt(netPay)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {w2Data.length > 0 && (
                <tfoot>
                  <tr className="bg-muted/20 font-bold">
                    <td colSpan={2} className="px-4 py-3 text-card-foreground">Totals</td>
                    <td className="px-4 py-3 text-right font-mono text-card-foreground">{fmt(w2Data.reduce((s, w) => s + w.grossWages, 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">{fmt(w2Data.reduce((s, w) => s + w.fedWithheld, 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">{fmt(w2Data.reduce((s, w) => s + w.ssTax, 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">{fmt(w2Data.reduce((s, w) => s + w.medicareTax, 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-destructive">{fmt(w2Data.reduce((s, w) => s + w.stateWithheld, 0))}</td>
                    <td className="px-4 py-3 text-right font-mono text-success">
                      {fmt(w2Data.reduce((s, w) => s + w.grossWages - w.fedWithheld - w.ssTax - w.medicareTax - w.stateWithheld, 0))}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
