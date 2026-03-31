import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { fetchAll } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import {
  DollarSign, TrendingUp, TrendingDown, Briefcase,
  FileText, Users, Landmark, ArrowUpRight, ArrowDownRight,
  CheckCircle2, AlertTriangle,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { format, subMonths, startOfMonth, endOfMonth, parseISO } from "date-fns";

const fmt = (n: number) => `$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtK = (n: number) => {
  if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
};

function KpiCard({ title, value, subtitle, icon: Icon, trend, trendLabel, color = "primary" }: {
  title: string; value: string; subtitle?: string;
  icon: typeof DollarSign; trend?: "up" | "down" | "neutral";
  trendLabel?: string; color?: "primary" | "success" | "destructive" | "warning";
}) {
  const colorMap = {
    primary: "bg-primary/10 text-primary",
    success: "bg-success/10 text-success",
    destructive: "bg-destructive/10 text-destructive",
    warning: "bg-warning/10 text-warning",
  };
  return (
    <div className="glass-card rounded-xl p-5 flex flex-col gap-3 animate-fade-in">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-display font-bold text-card-foreground">{value}</p>
        </div>
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", colorMap[color])}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {(subtitle || trendLabel) && (
        <div className="flex items-center gap-2 text-xs">
          {trend && trend !== "neutral" && (
            <span className={cn("flex items-center gap-0.5 font-medium",
              trend === "up" ? "text-success" : "text-destructive"
            )}>
              {trend === "up" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {trendLabel}
            </span>
          )}
          {subtitle && <span className="text-muted-foreground">{subtitle}</span>}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();

  // Tax table freshness — the payroll engine uses hardcoded 2026 brackets,
  // so the dashboard alert is based on the engine year, not the DB table.
  const PAYROLL_ENGINE_TAX_YEAR = 2026;
  const currentYear = new Date().getFullYear();
  const taxTablesOutdated = PAYROLL_ENGINE_TAX_YEAR < currentYear;
  // ===== Data queries =====
  const { data: allTransactions = [] } = useQuery({
    queryKey: ["dashboard-transactions"],
    queryFn: async () => {
      let allTxns: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase.from("transactions").select("*, jobs(job_number, name)").order("date", { ascending: false }).range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allTxns = allTxns.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return allTxns;
    },
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: arInvoices = [] } = useQuery({
    queryKey: ["dashboard-ar"],
    queryFn: async () => fetchAll((sb) => sb.from("job_invoices").select("*")),
  });

  const { data: apInvoices = [] } = useQuery({
    queryKey: ["dashboard-ap"],
    queryFn: async () => fetchAll((sb) => sb.from("vendor_invoices").select("*")),
  });

  const { data: payrollEntries = [] } = useQuery({
    queryKey: ["dashboard-payroll"],
    queryFn: async () => fetchAll((sb) => sb.from("payroll_entries").select("*, payroll_runs(period_end)")),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["dashboard-employees"],
    queryFn: async () => fetchAll((sb) => sb.from("employees").select("*").eq("active", true)),
  });

  const { data: timesheets = [] } = useQuery({
    queryKey: ["dashboard-timesheets"],
    queryFn: async () => fetchAll((sb) => sb.from("timesheets").select("*, employees(rate, pay_type)")),
  });

  const { data: vendorInvoicesAll = [] } = useQuery({
    queryKey: ["dashboard-vendor-invoices-all"],
    queryFn: async () => fetchAll((sb) => sb.from("vendor_invoices").select("*")),
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("bank_accounts").select("*").eq("active", true);
      if (error) throw error;
      return data;
    },
  });

  // ===== GL-based balances from posted journal entries =====
  const { data: glBalances } = useQuery({
    queryKey: ["dashboard-gl-balances"],
    queryFn: async () => {
      // Step 1: Get all posted journal entry IDs
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
      if (postedIds.length === 0) return {};

      // Step 2: Get all lines for those entries with GL account info
      let allLines: any[] = [];
      from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("journal_entry_lines")
          .select("debit, credit, journal_entry_id, gl_accounts(account_number, account_type)")
          .in("journal_entry_id", postedIds.slice(from, from + pageSize))
          .range(0, pageSize - 1);
        if (error) throw error;
        if (data) allLines = allLines.concat(data);
        from += pageSize;
        if (from >= postedIds.length) break;
      }

      // Build balance by account number
      const byAcct: Record<string, number> = {};
      allLines.forEach((l: any) => {
        const acct = l.gl_accounts?.account_number || "";
        if (!byAcct[acct]) byAcct[acct] = 0;
        byAcct[acct] += (l.debit || 0) - (l.credit || 0);
      });
      return byAcct;
    },
  });

  // ===== KPI calculations =====
  const cashPosition = useMemo(() => {
    if (glBalances) {
      // Sum all 1000-series accounts (cash)
      return Object.entries(glBalances)
        .filter(([acct]) => acct.startsWith("10"))
        .reduce((s, [, bal]) => s + bal, 0);
    }
    const openingBalances = bankAccounts.reduce((s, a) => s + (a.opening_balance || 0), 0);
    const deposits = allTransactions.reduce((s, t) => s + (t.deposit || 0), 0);
    const payments = allTransactions.reduce((s, t) => s + (t.payment || 0), 0);
    return openingBalances + deposits - payments;
  }, [allTransactions, bankAccounts, glBalances]);

  // GL-based AR (account 1100) — debit balance = amount owed to us
  const openAR = useMemo(() => {
    if (glBalances) {
      return Object.entries(glBalances)
        .filter(([acct]) => acct === "1100")
        .reduce((s, [, bal]) => s + bal, 0);
    }
    return arInvoices
      .filter((i) => i.status !== "paid")
      .reduce((s, i) => s + ((i.amount || 0) - (i.paid || 0)), 0);
  }, [arInvoices, glBalances]);

  // GL-based AP (account 2000) — credit balance = amount we owe (flip sign for display)
  const openAP = useMemo(() => {
    if (glBalances) {
      // AP has credit normal balance, so debit-credit will be negative when we owe money
      return Math.abs(Object.entries(glBalances)
        .filter(([acct]) => acct === "2000")
        .reduce((s, [, bal]) => s + bal, 0));
    }
    return apInvoices
      .filter((i) => i.status !== "paid")
      .reduce((s, i) => s + ((i.amount || 0) - (i.paid || 0)), 0);
  }, [apInvoices, glBalances]);

  const overdueAR = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return arInvoices
      .filter((i) => i.status !== "paid" && i.due_date && i.due_date < today)
      .reduce((s, i) => s + ((i.amount || 0) - (i.paid || 0)), 0);
  }, [arInvoices]);

  const overdueAP = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return apInvoices
      .filter((i) => i.status !== "paid" && i.due_date && i.due_date < today)
      .reduce((s, i) => s + ((i.amount || 0) - (i.paid || 0)), 0);
  }, [apInvoices]);

  const activeJobs = jobs.filter((j) => j.status === "active").length;

  // GL-based payroll expense (account 6100)
  const totalPayroll = useMemo(() => {
    if (glBalances) {
      return Object.entries(glBalances)
        .filter(([acct]) => acct === "6100")
        .reduce((s, [, bal]) => s + bal, 0);
    }
    return payrollEntries.reduce((s, e) => s + (e.gross_pay || 0), 0);
  }, [payrollEntries, glBalances]);

  // ===== Cash flow trend (last 6 months) =====
  const cashFlowData = useMemo(() => {
    const now = new Date();
    const months: { month: string; deposits: number; payments: number; net: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = subMonths(now, i);
      const start = format(startOfMonth(m), "yyyy-MM-dd");
      const end = format(endOfMonth(m), "yyyy-MM-dd");
      const mTxns = allTransactions.filter((t) => t.date >= start && t.date <= end);
      const deposits = mTxns.reduce((s, t) => s + (t.deposit || 0), 0);
      const payments = mTxns.reduce((s, t) => s + (t.payment || 0), 0);
      months.push({ month: format(m, "MMM"), deposits, payments, net: deposits - payments });
    }
    return months;
  }, [allTransactions]);

  // ===== Payroll cost trend (last 6 months) =====
  const payrollTrend = useMemo(() => {
    const now = new Date();
    const months: { month: string; gross: number; taxes: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = subMonths(now, i);
      const start = format(startOfMonth(m), "yyyy-MM-dd");
      const end = format(endOfMonth(m), "yyyy-MM-dd");
      const mEntries = payrollEntries.filter((e) => {
        const runEnd = (e as any).payroll_runs?.period_end;
        return runEnd && runEnd >= start && runEnd <= end;
      });
      const gross = mEntries.reduce((s, e) => s + (e.gross_pay || 0), 0);
      const taxes = mEntries.reduce((s, e) => s + (e.fed_tax || 0) + (e.state_tax || 0) + (e.fica || 0), 0);
      months.push({ month: format(m, "MMM"), gross, taxes });
    }
    return months;
  }, [payrollEntries]);

  // ===== Job profitability top 5 =====
  const jobProfitability = useMemo(() => {
    return jobs
      .filter((j) => j.status === "active")
      .map((job) => {
        const jobInvoices = arInvoices.filter((i) => i.job_id === job.id && i.status !== "void");
        const revenue = jobInvoices.reduce((s, i) => s + (i.amount || 0), 0);

        const jobTS = timesheets.filter((t) => t.job_id === job.id);
        const laborCost = jobTS.reduce((s, t) => {
          const rate = (t as any).employees?.rate || 0;
          const payType = (t as any).employees?.pay_type;
          return s + (t.hours || 0) * (payType === "salary" ? rate / 2080 : rate);
        }, 0);

        const apCost = vendorInvoicesAll
          .filter((i) => i.job_id === job.id && i.status !== "void")
          .reduce((s, i) => s + (i.amount || 0), 0);

        const totalCost = laborCost + apCost;
        const profit = revenue - totalCost;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

        return {
          name: `${job.job_number}`,
          revenue,
          laborCost,
          apCost,
          totalCost,
          profit,
          margin,
        };
      })
      .filter((job) => job.revenue > 0 || job.totalCost > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }, [jobs, arInvoices, timesheets, vendorInvoicesAll]);

  const recentTxns = allTransactions.slice(0, 8);

  return (
    <div className="p-8 space-y-6">
      <PageHeader title="Dashboard" description="Financial overview at a glance" />

      {/* Tax Table Outdated Alert */}
      {taxTablesOutdated && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-warning/10 border border-warning/30">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-card-foreground">
              Tax tables may be outdated — engine year is <strong>{PAYROLL_ENGINE_TAX_YEAR}</strong>, current year is <strong>{currentYear}</strong>.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Update federal and state withholding tables to ensure payroll accuracy.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate("/tax-settings")}>
            Update Tax Tables
          </Button>
        </div>
      )}

      {/* KPI Cards Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Cash Position"
          value={fmt(cashPosition)}
          icon={DollarSign}
          color={cashPosition >= 0 ? "success" : "destructive"}
          subtitle="All-time net"
        />
        <KpiCard
          title="Accounts Receivable"
          value={fmt(openAR)}
          icon={TrendingUp}
          color="primary"
          subtitle={overdueAR > 0 ? `${fmt(overdueAR)} overdue` : "None overdue"}
          trend={overdueAR > 0 ? "down" : "neutral"}
          trendLabel={overdueAR > 0 ? "Overdue" : undefined}
        />
        <KpiCard
          title="Accounts Payable"
          value={fmt(openAP)}
          icon={TrendingDown}
          color="warning"
          subtitle={overdueAP > 0 ? `${fmt(overdueAP)} overdue` : "None overdue"}
          trend={overdueAP > 0 ? "down" : "neutral"}
          trendLabel={overdueAP > 0 ? "Overdue" : undefined}
        />
        <KpiCard
          title="Active Jobs"
          value={String(activeJobs)}
          icon={Briefcase}
          color="primary"
          subtitle={`${jobs.length} total · ${employees.length} employees`}
        />
      </div>

      {/* KPI Cards Row 2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="YTD Payroll"
          value={fmt(totalPayroll)}
          icon={Users}
          color="primary"
          subtitle={`${employees.length} active employees`}
        />
        <KpiCard
          title="Net Working Capital"
          value={fmt(cashPosition + openAR - openAP)}
          icon={Landmark}
          color={cashPosition + openAR - openAP >= 0 ? "success" : "destructive"}
          subtitle="Cash + AR − AP"
        />
        <KpiCard
          title="Open AR Invoices"
          value={String(arInvoices.filter((i) => i.status !== "paid").length)}
          icon={FileText}
          color="primary"
          subtitle={overdueAR > 0 ? `${arInvoices.filter((i) => i.status !== "paid" && i.due_date && i.due_date < new Date().toISOString().split("T")[0]).length} overdue` : "All current"}
        />
        <KpiCard
          title="Open AP Invoices"
          value={String(apInvoices.filter((i) => i.status !== "paid").length)}
          icon={FileText}
          color="warning"
          subtitle={overdueAP > 0 ? `${apInvoices.filter((i) => i.status !== "paid" && i.due_date && i.due_date < new Date().toISOString().split("T")[0]).length} overdue` : "All current"}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Cash Flow Trend */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="font-display font-semibold text-card-foreground mb-4">Cash Flow — Last 6 Months</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={cashFlowData}>
              <defs>
                <linearGradient id="gradDeposit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradPayment" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmtK} width={50} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [fmt(v), name === "deposits" ? "Deposits" : name === "payments" ? "Payments" : "Net"]}
              />
              <Area type="monotone" dataKey="deposits" stroke="hsl(var(--success))" fill="url(#gradDeposit)" strokeWidth={2} />
              <Area type="monotone" dataKey="payments" stroke="hsl(var(--destructive))" fill="url(#gradPayment)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Payroll Cost Trend */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="font-display font-semibold text-card-foreground mb-4">Payroll Cost — Last 6 Months</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={payrollTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={fmtK} width={50} />
              <Tooltip
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: number, name: string) => [fmt(v), name === "gross" ? "Gross Pay" : "Taxes & FICA"]}
              />
              <Bar dataKey="gross" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="taxes" fill="hsl(var(--primary) / 0.4)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom Row: Job Profitability + Recent Transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Job Profitability */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="font-display font-semibold text-card-foreground mb-4">Top Jobs by Revenue</h3>
          {jobProfitability.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No active jobs with data yet.</p>
          ) : (
            <div className="space-y-3">
              {jobProfitability.map((j) => (
                <div key={j.name} className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="flex items-center gap-3">
                    <span className="w-14 font-mono text-xs font-medium text-primary">{j.name}</span>
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-card-foreground font-medium">{fmt(j.revenue)} rev</span>
                        <span className={cn("font-medium", j.profit >= 0 ? "text-success" : "text-destructive")}>
                          {j.margin.toFixed(0)}% margin
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full transition-all", j.profit >= 0 ? "bg-success" : "bg-destructive")}
                          style={{ width: `${Math.min(Math.max(j.margin, 0), 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
                    <span>AP Cost: <span className="font-mono text-card-foreground">{fmt(j.apCost)}</span></span>
                    <span>Labor: <span className="font-mono text-card-foreground">{fmt(j.laborCost)}</span></span>
                    <span>Total Cost: <span className="font-mono text-card-foreground">{fmt(j.totalCost)}</span></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Transactions */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-display font-semibold text-card-foreground">Recent Transactions</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-5 py-2 font-medium text-muted-foreground text-xs">Date</th>
                  <th className="text-left px-5 py-2 font-medium text-muted-foreground text-xs">Payee</th>
                  <th className="text-left px-5 py-2 font-medium text-muted-foreground text-xs">Job</th>
                  <th className="text-right px-5 py-2 font-medium text-muted-foreground text-xs">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentTxns.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-muted-foreground text-xs">No transactions yet.</td></tr>
                ) : recentTxns.map((tx) => {
                  const amount = (tx.deposit || 0) > 0 ? tx.deposit! : -(tx.payment || 0);
                  return (
                    <tr key={tx.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-5 py-2 text-xs text-muted-foreground">{tx.date}</td>
                      <td className="px-5 py-2 text-xs font-medium text-card-foreground truncate max-w-[140px]">{tx.payee}</td>
                      <td className="px-5 py-2 font-mono text-xs text-primary">{(tx as any).jobs?.job_number || "—"}</td>
                      <td className={cn("px-5 py-2 text-right font-mono text-xs font-medium", amount >= 0 ? "text-success" : "text-destructive")}>
                        {amount >= 0 ? "+" : ""}{fmt(amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
