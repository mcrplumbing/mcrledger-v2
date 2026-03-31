import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fetchAll } from "@/lib/fetchAll";

type DrillItem = {
  date: string;
  entry_number: string;
  description: string;
  debit: number;
  credit: number;
  job?: string;
};

export default function Reports() {
  const [drillTitle, setDrillTitle] = useState("");
  const [drillItems, setDrillItems] = useState<DrillItem[]>([]);

  // Date range filter state
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: accounts = [] } = useQuery({
    queryKey: ["gl-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gl_accounts").select("*").order("account_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: lines = [] } = useQuery({
    queryKey: ["gl-lines-report"],
    queryFn: async () => {
      // Paginate to avoid 1000-row default limit
      let allLines: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("journal_entry_lines")
          .select("*, gl_accounts(account_number, name, account_type, normal_balance), journal_entries(entry_number, date, description, status), jobs(job_number, name)")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allLines = allLines.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return allLines.filter((l: any) => l.journal_entries?.status === "posted");
    },
  });

  // Filter lines by date range
  // For Balance Sheet: only apply dateTo (balance sheet is cumulative "as of" a date)
  const filteredLines = useMemo(() => {
    return lines.filter((l: any) => {
      const d = l.journal_entries?.date;
      if (!d) return true;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }, [lines, dateFrom, dateTo]);

  // Balance Sheet lines: ignore dateFrom (cumulative from beginning of time)
  const bsFilteredLines = useMemo(() => {
    return lines.filter((l: any) => {
      const d = l.journal_entries?.date;
      if (!d) return true;
      if (dateTo && d > dateTo) return false;
      return true;
    });
  }, [lines, dateTo]);

  const { data: arInvoices = [] } = useQuery({
    queryKey: ["job-invoices-report"],
    queryFn: async () => fetchAll((sb) => sb.from("job_invoices").select("*, jobs(job_number, name)")),
  });

  const { data: apInvoicesWithVendors = [] } = useQuery({
    queryKey: ["vendor-invoices-report-with-vendors"],
    queryFn: async () => fetchAll((sb) => sb.from("vendor_invoices").select("*, vendors(name, is_1099, tax_id), jobs(job_number, name)")),
  });

  // Use the full vendor join for 1099 and AP, alias for backward compat
  const apInvoices = apInvoicesWithVendors;

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("*").order("job_number");
      if (error) throw error;
      return data;
    },
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions-reports"],
    queryFn: async () => {
      let allTxns: any[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase.from("transactions").select("*").range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allTxns = allTxns.concat(data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return allTxns;
    },
  });

  const { data: timesheets = [] } = useQuery({
    queryKey: ["timesheets-report"],
    queryFn: async () => {
      const { data, error } = await supabase.from("timesheets").select("*, employees(rate, pay_type)");
      if (error) throw error;
      return data;
    },
  });

  const { data: vendorInvoices = [] } = useQuery({
    queryKey: ["vendor-invoices-profitability"],
    queryFn: async () => fetchAll((sb) => sb.from("vendor_invoices").select("*")),
  });

  // Build account balances from date-filtered lines (for P&L, Trial Balance)
  const accountBalances = useMemo(() => accounts.map((acct) => {
    const acctLines = filteredLines.filter((l: any) => l.account_id === acct.id);
    const totalDebit = acctLines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
    const totalCredit = acctLines.reduce((s: number, l: any) => s + (l.credit || 0), 0);
    const balance = acct.normal_balance === "debit" ? totalDebit - totalCredit : totalCredit - totalDebit;
    return { ...acct, totalDebit, totalCredit, balance, lines: acctLines };
  }), [accounts, filteredLines]);

  // Balance Sheet balances: cumulative (ignores dateFrom)
  const bsAccountBalances = useMemo(() => accounts.map((acct) => {
    const acctLines = bsFilteredLines.filter((l: any) => l.account_id === acct.id);
    const totalDebit = acctLines.reduce((s: number, l: any) => s + (l.debit || 0), 0);
    const totalCredit = acctLines.reduce((s: number, l: any) => s + (l.credit || 0), 0);
    const balance = acct.normal_balance === "debit" ? totalDebit - totalCredit : totalCredit - totalDebit;
    return { ...acct, totalDebit, totalCredit, balance, lines: acctLines };
  }), [accounts, bsFilteredLines]);

  const drillDown = (acctId: string, acctName: string) => {
    const acctLines = filteredLines.filter((l: any) => l.account_id === acctId);
    setDrillTitle(acctName);
    setDrillItems(acctLines.map((l: any) => ({
      date: l.journal_entries?.date || "",
      entry_number: l.journal_entries?.entry_number || "",
      description: l.description || l.journal_entries?.description || "",
      debit: l.debit || 0,
      credit: l.credit || 0,
      job: l.jobs?.job_number ? `${l.jobs.job_number} - ${l.jobs.name}` : "",
    })));
  };

  const closeDrill = () => { setDrillTitle(""); setDrillItems([]); };

  const today = new Date();
  const agingBuckets = (items: any[], dateField: string) => {
    const current: any[] = [];
    const over30: any[] = [];
    const over60: any[] = [];
    const over90: any[] = [];
    items.forEach((item) => {
      const due = item[dateField] ? new Date(item[dateField]) : new Date(item.date);
      const days = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 30) current.push(item);
      else if (days <= 60) over30.push(item);
      else if (days <= 90) over60.push(item);
      else over90.push(item);
    });
    return { current, over30, over60, over90 };
  };

  const openAR = arInvoices.filter((i) => i.status !== "paid");
  const arAging = agingBuckets(openAR, "due_date");
  const openAP = apInvoices.filter((i) => i.status !== "paid");
  const apAging = agingBuckets(openAP, "due_date");

  const byType = (type: string) => accountBalances.filter((a) => a.account_type === type && a.balance !== 0);
  const sumType = (type: string) => byType(type).reduce((s, a) => s + a.balance, 0);

  // Balance Sheet helpers (cumulative — ignores dateFrom)
  const bsByType = (type: string) => bsAccountBalances.filter((a) => a.account_type === type && a.balance !== 0);
  const bsSumType = (type: string) => bsByType(type).reduce((s, a) => s + a.balance, 0);

  const fmt = (n: number) => `$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  const AgingTable = ({ title, aging, items, nameField }: {
    title: string; aging: ReturnType<typeof agingBuckets>; items: any[]; nameField: string;
  }) => {
    const [drillBucket, setDrillBucket] = useState<{ label: string; items: any[] } | null>(null);
    const bucketSum = (arr: any[]) => arr.reduce((s, i) => s + ((i.amount || 0) - (i.paid || 0)), 0);
    const totalOutstanding = items.reduce((s, i) => s + ((i.amount || 0) - (i.paid || 0)), 0);

    return (
      <div className="space-y-4">
        <div className="glass-card rounded-xl p-6">
          <h3 className="font-display font-semibold text-lg text-card-foreground mb-4">{title} Aging Summary</h3>
          <div className="grid grid-cols-5 gap-4 text-center">
            {[
              { label: "Current", items: aging.current },
              { label: "31-60 Days", items: aging.over30 },
              { label: "61-90 Days", items: aging.over60 },
              { label: "90+ Days", items: aging.over90 },
              { label: "Total", items },
            ].map((b) => (
              <button
                key={b.label}
                onClick={() => b.items.length > 0 && setDrillBucket({ label: b.label, items: b.items })}
                className="stat-card cursor-pointer"
              >
                <div className="text-xs text-muted-foreground mb-1">{b.label}</div>
                <div className="font-mono font-bold text-card-foreground">
                  {fmt(b.label === "Total" ? totalOutstanding : bucketSum(b.items))}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{b.items.length} items</div>
              </button>
            ))}
          </div>
        </div>

        <Dialog open={!!drillBucket} onOpenChange={() => setDrillBucket(null)}>
          <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{title} — {drillBucket?.label}</DialogTitle></DialogHeader>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Invoice #</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">{nameField === "client" ? "Client" : "Vendor"}</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Job</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Due</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Amount</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Paid</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Balance</th>
                </tr>
              </thead>
              <tbody>
                {(drillBucket?.items || []).map((inv: any) => (
                  <tr key={inv.id} className="border-b border-border/50">
                    <td className="px-4 py-2 font-mono text-xs text-card-foreground">{inv.invoice_number || inv.invoice_no}</td>
                    <td className="px-4 py-2 font-medium text-card-foreground">{nameField === "client" ? inv.client : inv.vendors?.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-primary">{inv.jobs?.job_number || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{inv.date}</td>
                    <td className="px-4 py-2 text-muted-foreground">{inv.due_date || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono text-card-foreground">{fmt(inv.amount || 0)}</td>
                    <td className="px-4 py-2 text-right font-mono text-success">{fmt(inv.paid || 0)}</td>
                    <td className="px-4 py-2 text-right font-mono font-medium text-card-foreground">{fmt((inv.amount || 0) - (inv.paid || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  // Job profitability - filtered by date range
  const filteredTxns = useMemo(() => {
    return transactions.filter(t => {
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      return true;
    });
  }, [transactions, dateFrom, dateTo]);

  const filteredTimesheets = useMemo(() => {
    return timesheets.filter((t: any) => {
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      return true;
    });
  }, [timesheets, dateFrom, dateTo]);

  const filteredVI = useMemo(() => {
    return vendorInvoices.filter((i: any) => {
      if (dateFrom && i.date < dateFrom) return false;
      if (dateTo && i.date > dateTo) return false;
      return true;
    });
  }, [vendorInvoices, dateFrom, dateTo]);

  // Filtered AR invoices for job profitability
  const filteredAR = useMemo(() => {
    return arInvoices.filter((i: any) => {
      if (dateFrom && i.date < dateFrom) return false;
      if (dateTo && i.date > dateTo) return false;
      return true;
    });
  }, [arInvoices, dateFrom, dateTo]);

  const jobProfitability = jobs.map((job) => {
    // Revenue from AR invoices (not checkbook deposits — avoids double-counting)
    const jobAR = filteredAR.filter((i: any) => i.job_id === job.id);
    const revenue = jobAR.reduce((s: number, i: any) => s + (i.amount || 0), 0);
    // Labor from timesheets
    const jobTimesheets = filteredTimesheets.filter((t: any) => t.job_id === job.id);
    const laborCost = jobTimesheets.reduce((s: number, t: any) => {
      const rate = t.employees?.rate || 0;
      const payType = t.employees?.pay_type;
      const hourlyRate = payType === "salary" ? rate / 2080 : rate;
      return s + (t.hours || 0) * hourlyRate;
    }, 0);
    // Materials/subs from vendor invoices only
    const jobInvoices = filteredVI.filter((i: any) => i.job_id === job.id);
    const subExpenses = jobInvoices.reduce((s: number, i: any) => s + (i.amount || 0), 0);
    const totalExp = laborCost + subExpenses;
    const profit = revenue - totalExp;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    return { ...job, revenue, materialExpenses: 0, laborCost, subExpenses, totalExp, profit, margin };
  });

  // Date range filter bar
  const DateRangeBar = () => (
    <div className="flex items-end gap-4 mb-6 glass-card rounded-xl p-4">
      <div>
        <Label className="text-xs text-muted-foreground">From Date</Label>
        <Input type="date" className="w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">To Date</Label>
        <Input type="date" className="w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </div>
      <button
        className="text-xs text-primary hover:underline pb-2"
        onClick={() => { setDateFrom(""); setDateTo(""); }}
      >
        Clear
      </button>
      {(dateFrom || dateTo) && (
        <span className="text-xs text-muted-foreground pb-2">
          Showing: {dateFrom || "beginning"} → {dateTo || "today"}
        </span>
      )}
    </div>
  );

  return (
    <div className="p-8">
      <PageHeader title="Reports" description="Financial statements, job profitability, AR & AP aging" />
      
      <DateRangeBar />

      <Tabs defaultValue="profitability">
        <TabsList className="mb-6 flex-wrap">
          <TabsTrigger value="profitability">Job Profitability</TabsTrigger>
          <TabsTrigger value="trial-balance">Trial Balance</TabsTrigger>
          <TabsTrigger value="income">Income Statement</TabsTrigger>
          <TabsTrigger value="balance-sheet">Balance Sheet</TabsTrigger>
          <TabsTrigger value="ar-aging">AR Aging</TabsTrigger>
          <TabsTrigger value="ap-aging">AP Aging</TabsTrigger>
          <TabsTrigger value="1099">1099 Summary</TabsTrigger>
        </TabsList>

        {/* Job Profitability */}
        <TabsContent value="profitability">
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Job</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Labor</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Subs/Materials</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Profit</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Margin</th>
                </tr>
              </thead>
              <tbody>
                {jobProfitability.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No jobs yet.</td></tr>
                ) : jobProfitability.map((j) => (
                  <tr key={j.id} className="table-row-hover border-b border-border/50">
                    <td className="px-6 py-3 font-medium text-card-foreground">{j.job_number} - {j.name}</td>
                    <td className="px-6 py-3 text-right font-mono text-success">{fmt(j.revenue)}</td>
                    <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(Math.round(j.laborCost))}</td>
                    <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(j.subExpenses)}</td>
                    <td className={cn("px-6 py-3 text-right font-mono font-medium", j.profit >= 0 ? "text-success" : "text-destructive")}>{fmt(Math.round(j.profit))}</td>
                    <td className="px-6 py-3 text-right font-mono text-muted-foreground">{j.margin.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <Dialog open={!!drillTitle} onOpenChange={closeDrill}>
          <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Account Detail: {drillTitle}</DialogTitle></DialogHeader>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Entry #</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Description</th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Job</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Debit</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Credit</th>
                </tr>
              </thead>
              <tbody>
                {drillItems.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-4 text-center text-muted-foreground">No transactions</td></tr>
                ) : drillItems.map((item, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="px-4 py-2 text-muted-foreground">{item.date}</td>
                    <td className="px-4 py-2 font-mono text-xs text-card-foreground">{item.entry_number}</td>
                    <td className="px-4 py-2 text-card-foreground">{item.description}</td>
                    <td className="px-4 py-2 font-mono text-xs text-primary">{item.job || "—"}</td>
                    <td className="px-4 py-2 text-right font-mono">{item.debit > 0 ? fmt(item.debit) : ""}</td>
                    <td className="px-4 py-2 text-right font-mono">{item.credit > 0 ? fmt(item.credit) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DialogContent>
        </Dialog>

        {/* Trial Balance */}
        <TabsContent value="trial-balance">
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Account</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Type</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Debits</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Credits</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Balance</th>
                </tr>
              </thead>
              <tbody>
                {accountBalances.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No accounts or journal entries yet.</td></tr>
                ) : accountBalances.map((a) => (
                  <tr
                    key={a.id}
                    className="table-row-hover border-b border-border/50 cursor-pointer"
                    onClick={() => drillDown(a.id, `${a.account_number} - ${a.name}`)}
                  >
                    <td className="px-6 py-3 font-medium text-card-foreground">{a.account_number} - {a.name}</td>
                    <td className="px-6 py-3 text-muted-foreground capitalize">{a.account_type}</td>
                    <td className="px-6 py-3 text-right font-mono text-card-foreground">{a.totalDebit > 0 ? fmt(a.totalDebit) : ""}</td>
                    <td className="px-6 py-3 text-right font-mono text-card-foreground">{a.totalCredit > 0 ? fmt(a.totalCredit) : ""}</td>
                    <td className={cn("px-6 py-3 text-right font-mono font-medium", a.balance >= 0 ? "text-card-foreground" : "text-destructive")}>{fmt(a.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-muted/20 font-bold">
                  <td colSpan={2} className="px-6 py-3 text-card-foreground">Totals</td>
                  <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(accountBalances.reduce((s, a) => s + a.totalDebit, 0))}</td>
                  <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(accountBalances.reduce((s, a) => s + a.totalCredit, 0))}</td>
                  <td className="px-6 py-3"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </TabsContent>

        {/* Income Statement */}
        <TabsContent value="income">
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-display font-semibold text-lg text-card-foreground mb-4">
              Income Statement (P&L)
              {(dateFrom || dateTo) && <span className="text-sm font-normal text-muted-foreground ml-2">({dateFrom || "…"} to {dateTo || "…"})</span>}
            </h3>
            <div className="space-y-1">
              <h4 className="font-medium text-muted-foreground mt-2 mb-1">REVENUE</h4>
              {byType("revenue").map((a) => (
                <div key={a.id} className="flex justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-muted/50" onClick={() => drillDown(a.id, `${a.account_number} - ${a.name}`)}>
                  <span className="text-card-foreground">{a.account_number} - {a.name}</span>
                  <span className="font-mono text-success">{fmt(a.balance)}</span>
                </div>
              ))}
              <div className="flex justify-between py-2 border-t border-border font-medium">
                <span className="text-card-foreground">Total Revenue</span>
                <span className="font-mono text-success">{fmt(sumType("revenue"))}</span>
              </div>

              <h4 className="font-medium text-muted-foreground mt-4 mb-1">EXPENSES</h4>
              {byType("expense").map((a) => (
                <div key={a.id} className="flex justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-muted/50" onClick={() => drillDown(a.id, `${a.account_number} - ${a.name}`)}>
                  <span className="text-card-foreground">{a.account_number} - {a.name}</span>
                  <span className="font-mono text-destructive">{fmt(a.balance)}</span>
                </div>
              ))}
              <div className="flex justify-between py-2 border-t border-border font-medium">
                <span className="text-card-foreground">Total Expenses</span>
                <span className="font-mono text-destructive">{fmt(sumType("expense"))}</span>
              </div>

              <div className="flex justify-between py-3 border-t-2 border-border font-bold text-lg">
                <span className="text-card-foreground">Net Income</span>
                <span className={cn("font-mono", sumType("revenue") - sumType("expense") >= 0 ? "text-success" : "text-destructive")}>
                  {fmt(sumType("revenue") - sumType("expense"))}
                </span>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Balance Sheet */}
        <TabsContent value="balance-sheet">
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-display font-semibold text-lg text-card-foreground mb-4">
              Balance Sheet
              {dateTo && <span className="text-sm font-normal text-muted-foreground ml-2">(as of {dateTo})</span>}
            </h3>
            <div className="space-y-1">
              <h4 className="font-medium text-muted-foreground mb-1">ASSETS</h4>
              {bsByType("asset").map((a) => (
                <div key={a.id} className="flex justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-muted/50" onClick={() => drillDown(a.id, `${a.account_number} - ${a.name}`)}>
                  <span className="text-card-foreground">{a.account_number} - {a.name}</span>
                  <span className="font-mono text-card-foreground">{fmt(a.balance)}</span>
                </div>
              ))}
              <div className="flex justify-between py-2 border-t border-border font-medium">
                <span className="text-card-foreground">Total Assets</span>
                <span className="font-mono text-card-foreground">{fmt(bsSumType("asset"))}</span>
              </div>

              <h4 className="font-medium text-muted-foreground mt-4 mb-1">LIABILITIES</h4>
              {bsByType("liability").map((a) => (
                <div key={a.id} className="flex justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-muted/50" onClick={() => drillDown(a.id, `${a.account_number} - ${a.name}`)}>
                  <span className="text-card-foreground">{a.account_number} - {a.name}</span>
                  <span className="font-mono text-destructive">{fmt(a.balance)}</span>
                </div>
              ))}
              <div className="flex justify-between py-2 border-t border-border font-medium">
                <span className="text-card-foreground">Total Liabilities</span>
                <span className="font-mono text-destructive">{fmt(bsSumType("liability"))}</span>
              </div>

              <h4 className="font-medium text-muted-foreground mt-4 mb-1">EQUITY</h4>
              {bsByType("equity").map((a) => (
                <div key={a.id} className="flex justify-between py-1.5 px-2 rounded cursor-pointer hover:bg-muted/50" onClick={() => drillDown(a.id, `${a.account_number} - ${a.name}`)}>
                  <span className="text-card-foreground">{a.account_number} - {a.name}</span>
                  <span className="font-mono text-card-foreground">{fmt(a.balance)}</span>
                </div>
              ))}
              <div className="flex justify-between py-1.5 px-2">
                <span className="text-card-foreground italic">Retained Earnings (Net Income)</span>
                <span className="font-mono text-card-foreground">{fmt(bsSumType("revenue") - bsSumType("expense"))}</span>
              </div>
              <div className="flex justify-between py-2 border-t border-border font-medium">
                <span className="text-card-foreground">Total Equity</span>
                <span className="font-mono text-card-foreground">{fmt(bsSumType("equity") + bsSumType("revenue") - bsSumType("expense"))}</span>
              </div>

              <div className="flex justify-between py-3 border-t-2 border-primary font-bold text-lg">
                <span className="text-card-foreground">Total L + E</span>
                <span className="font-mono text-card-foreground">{fmt(bsSumType("liability") + bsSumType("equity") + bsSumType("revenue") - bsSumType("expense"))}</span>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* AR Aging */}
        <TabsContent value="ar-aging">
          <AgingTable title="Accounts Receivable" aging={arAging} items={openAR} nameField="client" />
        </TabsContent>

        {/* AP Aging */}
        <TabsContent value="ap-aging">
          <AgingTable title="Accounts Payable" aging={apAging} items={openAP} nameField="vendor" />
        </TabsContent>

        {/* 1099 Summary */}
        <TabsContent value="1099">
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border">
              <h3 className="font-display font-semibold text-lg text-card-foreground">1099-NEC Summary</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Vendors marked as 1099 with total payments ≥ $600.
                {(dateFrom || dateTo) && <span> Filtered: {dateFrom || "…"} → {dateTo || "…"}</span>}
              </p>
            </div>
            {(() => {
              // Get 1099 vendors with proper is_1099 filter
              const vendors1099 = (apInvoices as any[])
                .filter((i) => i.vendors?.name && i.vendors?.is_1099 && i.status !== "void")
                .reduce((acc: Record<string, { name: string; taxId: string; total: number }>, inv: any) => {
                  const vendorName = inv.vendors?.name;
                  if (!vendorName) return acc;
                  if (!acc[vendorName]) {
                    acc[vendorName] = { name: vendorName, taxId: inv.vendors?.tax_id || "—", total: 0 };
                  }
                  // Only count paid amounts within date range
                  const inRange = (!dateFrom || inv.date >= dateFrom) && (!dateTo || inv.date <= dateTo);
                  if (inRange) {
                    acc[vendorName].total += (inv.paid || 0);
                  }
                  return acc;
                }, {});

              const all1099 = Object.values(vendors1099) as { name: string; taxId: string; total: number }[];
              const eligible = all1099.filter((v) => v.total >= 600);
              const belowThreshold = all1099.filter((v) => v.total > 0 && v.total < 600);

              return (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Vendor</th>
                      <th className="text-left px-6 py-3 font-medium text-muted-foreground">Tax ID / EIN</th>
                      <th className="text-right px-6 py-3 font-medium text-muted-foreground">Total Payments</th>
                      <th className="text-center px-6 py-3 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eligible.length === 0 && belowThreshold.length === 0 ? (
                      <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No 1099 vendors with payments in this period.</td></tr>
                    ) : (
                      <>
                        {eligible.sort((a, b) => b.total - a.total).map((v) => (
                          <tr key={v.name} className="border-b border-border/50">
                            <td className="px-6 py-3 font-medium text-card-foreground">{v.name}</td>
                            <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{v.taxId}</td>
                            <td className="px-6 py-3 text-right font-mono font-medium text-card-foreground">{fmt(v.total)}</td>
                            <td className="px-6 py-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-xs bg-success/10 text-success font-medium">1099 Required</span>
                            </td>
                          </tr>
                        ))}
                        {belowThreshold.sort((a, b) => b.total - a.total).map((v) => (
                          <tr key={v.name} className="border-b border-border/50 opacity-60">
                            <td className="px-6 py-3 font-medium text-card-foreground">{v.name}</td>
                            <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{v.taxId}</td>
                            <td className="px-6 py-3 text-right font-mono text-muted-foreground">{fmt(v.total)}</td>
                            <td className="px-6 py-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground font-medium">Below $600</span>
                            </td>
                          </tr>
                        ))}
                      </>
                    )}
                  </tbody>
                  {eligible.length > 0 && (
                    <tfoot>
                      <tr className="bg-muted/20 font-bold">
                        <td colSpan={2} className="px-6 py-3 text-card-foreground">Total ({eligible.length} vendors requiring 1099)</td>
                        <td className="px-6 py-3 text-right font-mono text-card-foreground">{fmt(eligible.reduce((s, v) => s + v.total, 0))}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              );
            })()}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
