import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fetchAll } from "@/lib/fetchAll";

const EMPLOYER_SS_RATE = 0.062;
const EMPLOYER_MEDICARE_RATE = 0.0145;
const BURDEN_RATE = 1 + EMPLOYER_SS_RATE + EMPLOYER_MEDICARE_RATE;

export default function CustomerProfitability() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("*").order("client");
      if (error) throw error;
      return data;
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["job-invoices-cust-profit"],
    queryFn: async () => fetchAll((sb) => sb.from("job_invoices").select("job_id, amount, date, status").neq("status", "void")),
  });

  const { data: vendorInvoices = [] } = useQuery({
    queryKey: ["vendor-invoices-cust-profit"],
    queryFn: async () => fetchAll((sb) => sb.from("vendor_invoices").select("job_id, amount, date")),
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions-cust-profit"],
    queryFn: async () => fetchAll((sb) => sb.from("transactions").select("job_id, payment, date").not("job_id", "is", null)),
  });

  const { data: timesheetRows = [] } = useQuery({
    queryKey: ["timesheets-cust-profit"],
    queryFn: async () => fetchAll((sb) => sb.from("timesheets").select("job_id, hours, pay_class, date, employees(rate)")),
  });

  const { data: jeLinesRaw = [] } = useQuery({
    queryKey: ["je-lines-cust-profit"],
    queryFn: async () => fetchAll((sb) =>
      sb.from("journal_entry_lines")
        .select("job_id, debit, credit, journal_entries(date, status), gl_accounts(account_type)")
        .not("job_id", "is", null)
    ),
  });

  const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const inRange = (d: string | undefined) => {
    if (!d) return true;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  };

  const customerData = useMemo(() => {
    // Build a map: client -> aggregated financials
    const map = new Map<string, { client: string; jobCount: number; revenue: number; labor: number; otherExp: number; budget: number }>();

    for (const job of jobs) {
      const client = (job.client || "Unassigned").trim();
      if (!map.has(client)) {
        map.set(client, { client, jobCount: 0, revenue: 0, labor: 0, otherExp: 0, budget: 0 });
      }
      const entry = map.get(client)!;
      entry.jobCount += 1;
      entry.budget += job.budget || 0;

      // Revenue from AR invoices for this job
      const jobRevenue = invoices
        .filter((i: any) => i.job_id === job.id && inRange(i.date))
        .reduce((s: number, i: any) => s + (i.amount || 0), 0);
      entry.revenue += jobRevenue;

      // Labor from timesheets
      const jobLabor = timesheetRows
        .filter((t: any) => t.job_id === job.id && inRange(t.date))
        .reduce((s: number, t: any) => {
          const rate = t.employees?.rate || 0;
          const multiplier = t.pay_class === "double" ? 2 : t.pay_class === "overtime" ? 1.5 : 1;
          return s + (t.hours || 0) * rate * multiplier * BURDEN_RATE;
        }, 0);
      entry.labor += jobLabor;

      // Other expenses from transactions
      const jobTxnExp = transactions
        .filter((t: any) => t.job_id === job.id && inRange(t.date))
        .reduce((s: number, t: any) => s + (t.payment || 0), 0);

      // Vendor invoice expenses
      const jobViExp = vendorInvoices
        .filter((v: any) => v.job_id === job.id && inRange(v.date))
        .reduce((s: number, v: any) => s + (v.amount || 0), 0);

      // GL expense lines tagged to job (for opening balances etc.)
      const jobGlExp = jeLinesRaw
        .filter((l: any) =>
          l.job_id === job.id &&
          l.journal_entries?.status === "posted" &&
          l.gl_accounts?.account_type === "expense" &&
          inRange(l.journal_entries?.date)
        )
        .reduce((s: number, l: any) => s + ((l.debit || 0) - (l.credit || 0)), 0);

      // Use the greater of direct sources vs GL to avoid double-counting
      entry.otherExp += Math.max(jobTxnExp + jobViExp, jobGlExp);
    }

    return Array.from(map.values()).sort((a, b) => a.client.localeCompare(b.client));
  }, [jobs, invoices, vendorInvoices, transactions, timesheetRows, jeLinesRaw, dateFrom, dateTo]);

  const totals = useMemo(() => {
    return customerData.reduce(
      (acc, c) => ({
        jobCount: acc.jobCount + c.jobCount,
        budget: acc.budget + c.budget,
        revenue: acc.revenue + c.revenue,
        labor: acc.labor + c.labor,
        otherExp: acc.otherExp + c.otherExp,
      }),
      { jobCount: 0, budget: 0, revenue: 0, labor: 0, otherExp: 0 }
    );
  }, [customerData]);

  const totalProfit = totals.revenue - totals.labor - totals.otherExp;

  return (
    <div className="p-8">
      <PageHeader title="Customer Profitability" description="Revenue, expenses, and margin grouped by client across all jobs" />

      <div className="flex gap-4 items-end mb-6">
        <div>
          <Label className="text-xs">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Customer</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Jobs</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Budget</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Revenue</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Labor</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Other Exp</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Total Cost</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Profit</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Margin</th>
              </tr>
            </thead>
            <tbody>
              {customerData.length === 0 ? (
                <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">No job data yet.</td></tr>
              ) : (
                <>
                  {customerData.map((c) => {
                    const totalCost = c.labor + c.otherExp;
                    const profit = c.revenue - totalCost;
                    const margin = c.revenue > 0 ? (profit / c.revenue) * 100 : 0;
                    return (
                      <tr key={c.client} className="table-row-hover border-b border-border/50">
                        <td className="px-6 py-3 font-medium text-card-foreground">{c.client}</td>
                        <td className="px-4 py-3 text-center text-muted-foreground">{c.jobCount}</td>
                        <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(c.budget)}</td>
                        <td className="px-6 py-3 text-right font-mono text-success">{fmt(c.revenue)}</td>
                        <td className="px-6 py-3 text-right font-mono text-warning">{fmt(c.labor)}</td>
                        <td className="px-6 py-3 text-right font-mono text-destructive">{fmt(c.otherExp)}</td>
                        <td className="px-6 py-3 text-right font-mono font-medium text-destructive">{fmt(totalCost)}</td>
                        <td className={cn("px-6 py-3 text-right font-mono font-medium", profit >= 0 ? "text-success" : "text-destructive")}>{fmt(profit)}</td>
                        <td className="px-6 py-3 text-right font-mono text-muted-foreground">{margin.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/30 font-semibold border-t-2 border-border">
                    <td className="px-6 py-3 text-card-foreground">Totals</td>
                    <td className="px-4 py-3 text-center text-card-foreground">{totals.jobCount}</td>
                    <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(totals.budget)}</td>
                    <td className="px-6 py-3 text-right font-mono text-success">{fmt(totals.revenue)}</td>
                    <td className="px-6 py-3 text-right font-mono text-warning">{fmt(totals.labor)}</td>
                    <td className="px-6 py-3 text-right font-mono text-destructive">{fmt(totals.otherExp)}</td>
                    <td className="px-6 py-3 text-right font-mono font-medium text-destructive">{fmt(totals.labor + totals.otherExp)}</td>
                    <td className={cn("px-6 py-3 text-right font-mono font-medium", totalProfit >= 0 ? "text-success" : "text-destructive")}>{fmt(totalProfit)}</td>
                    <td className="px-6 py-3 text-right font-mono text-muted-foreground">
                      {totals.revenue > 0 ? ((totalProfit / totals.revenue) * 100).toFixed(1) : "0.0"}%
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
