import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import PageHeader from "@/components/PageHeader";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, Circle, ArrowRight, AlertTriangle,
  Landmark, FileText, TrendingDown, TrendingUp,
  ClipboardList, CalendarCheck, RotateCcw,
} from "lucide-react";

const STORAGE_KEY = "mcr-migration-checklist";

interface CheckItem {
  id: string;
  label: string;
  description: string;
  category: "setup" | "ap" | "ar" | "bank" | "verify";
  link?: string;
  autoCheck?: boolean;
}

const CHECKLIST: CheckItem[] = [
  // Setup
  { id: "coa", label: "Chart of Accounts configured", description: "Verify all GL accounts match your QuickBooks chart", category: "setup", link: "/chart-of-accounts" },
  { id: "bank-accts", label: "Bank accounts created", description: "Add all active bank accounts with correct opening balances", category: "setup", link: "/bank-accounts" },
  { id: "opening-bal", label: "Opening balances entered", description: "Enter March 31 trial balance from QuickBooks", category: "setup", link: "/opening-balances", autoCheck: true },
  { id: "employees", label: "Employees set up", description: "All active employees with correct rates, filing status, and deductions", category: "setup", link: "/payroll" },
  { id: "vendors-setup", label: "Vendors imported", description: "All active vendors entered with 1099 status and tax IDs", category: "setup", link: "/vendors" },
  { id: "jobs-setup", label: "Active jobs created", description: "All open jobs with budgets and client info", category: "setup", link: "/jobs" },
  { id: "tax-tables", label: "Tax tables current", description: "Federal and state withholding tables loaded for current year", category: "setup", link: "/tax-settings", autoCheck: true },

  // AP
  { id: "ap-invoices", label: "Open AP invoices entered", description: "Enter all unpaid vendor invoices as of March 31", category: "ap", link: "/vendors", autoCheck: true },

  // AR
  { id: "ar-invoices", label: "Open AR invoices entered", description: "Enter all unpaid customer invoices as of March 31", category: "ar", link: "/invoices", autoCheck: true },

  // Bank verification
  { id: "bank-bal-match", label: "Bank balances match QuickBooks", description: "Confirm each bank account balance matches QB as of March 31", category: "bank" },
  { id: "ar-bal-match", label: "AR total matches QuickBooks", description: "Confirm total open AR matches QB Accounts Receivable balance", category: "bank" },
  { id: "ap-bal-match", label: "AP total matches QuickBooks", description: "Confirm total open AP matches QB Accounts Payable balance", category: "bank" },

  // Go-live verification
  { id: "parallel-test", label: "First parallel transaction entered", description: "Enter your first April transaction in both systems to compare", category: "verify" },
  { id: "payroll-test", label: "Test payroll run completed", description: "Run a test payroll and compare output with QuickBooks", category: "verify" },
  { id: "recon-test", label: "First bank reconciliation done", description: "Complete April bank reconciliation and compare with QB", category: "verify", link: "/bank-reconciliation" },
];

const CATEGORIES = [
  { key: "setup", label: "System Setup", icon: ClipboardList, color: "text-primary" },
  { key: "ap", label: "Accounts Payable", icon: TrendingDown, color: "text-warning" },
  { key: "ar", label: "Accounts Receivable", icon: TrendingUp, color: "text-success" },
  { key: "bank", label: "Balance Verification", icon: Landmark, color: "text-primary" },
  { key: "verify", label: "Go-Live Validation", icon: CalendarCheck, color: "text-destructive" },
] as const;

export default function MigrationChecklist() {
  const navigate = useNavigate();

  // Persisted manual checks
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch { return {}; }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checked));
  }, [checked]);

  const toggle = (id: string) => setChecked((prev) => ({ ...prev, [id]: !prev[id] }));

  // Auto-detect data for auto-checkable items
  const { data: openAP = [] } = useQuery({
    queryKey: ["migration-ap"],
    queryFn: async () => fetchAll((sb) => sb.from("vendor_invoices").select("id").eq("status", "open")),
  });

  const { data: openAR = [] } = useQuery({
    queryKey: ["migration-ar"],
    queryFn: async () => fetchAll((sb) => sb.from("job_invoices").select("id").neq("status", "paid")),
  });

  const { data: maxTaxYear } = useQuery({
    queryKey: ["migration-tax-year"],
    queryFn: async () => {
      const { data } = await supabase.from("tax_settings").select("effective_year").order("effective_year", { ascending: false }).limit(1);
      return data?.[0]?.effective_year || 0;
    },
  });

  const { data: glAccounts = [] } = useQuery({
    queryKey: ["migration-gl"],
    queryFn: async () => {
      const { data } = await supabase.from("gl_accounts").select("id").eq("active", true);
      return data || [];
    },
  });

  const currentYear = new Date().getFullYear();

  // Auto status hints
  const autoStatus: Record<string, { done: boolean; hint: string }> = useMemo(() => ({
    "tax-tables": {
      done: maxTaxYear !== undefined && maxTaxYear >= currentYear,
      hint: maxTaxYear ? `Latest year: ${maxTaxYear}` : "No tax tables found",
    },
    "ap-invoices": {
      done: openAP.length > 0,
      hint: `${openAP.length} open AP invoice(s) in system`,
    },
    "ar-invoices": {
      done: openAR.length > 0,
      hint: `${openAR.length} open AR invoice(s) in system`,
    },
    "opening-bal": {
      done: glAccounts.length > 0,
      hint: `${glAccounts.length} GL accounts active`,
    },
  }), [openAP, openAR, maxTaxYear, currentYear, glAccounts]);

  const isChecked = (id: string) => checked[id] || autoStatus[id]?.done || false;

  const totalItems = CHECKLIST.length;
  const completedItems = CHECKLIST.filter((i) => isChecked(i.id)).length;
  const progressPct = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;

  const resetAll = () => {
    setChecked({});
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <div className="p-8 space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Migration Checklist"
        description="April 1 cutover from QuickBooks — track every step"
      />

      {/* Progress summary */}
      <div className="glass-card rounded-xl p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Overall Progress</p>
            <p className="text-3xl font-display font-bold text-card-foreground">
              {completedItems} / {totalItems}
              <span className="text-base font-normal text-muted-foreground ml-2">
                ({progressPct.toFixed(0)}%)
              </span>
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={resetAll} className="text-muted-foreground">
            <RotateCcw className="w-4 h-4 mr-1" /> Reset
          </Button>
        </div>
        <Progress value={progressPct} className="h-3" />
        {completedItems === totalItems && (
          <div className="flex items-center gap-2 text-success text-sm font-medium pt-1">
            <CheckCircle2 className="w-4 h-4" />
            All steps complete — you're ready for April 1!
          </div>
        )}
      </div>

      {/* Categories */}
      {CATEGORIES.map((cat) => {
        const items = CHECKLIST.filter((i) => i.category === cat.key);
        const catDone = items.filter((i) => isChecked(i.id)).length;
        const CatIcon = cat.icon;

        return (
          <div key={cat.key} className="glass-card rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <CatIcon className={cn("w-5 h-5", cat.color)} />
              <h3 className="font-display font-semibold text-card-foreground flex-1">{cat.label}</h3>
              <span className="text-xs text-muted-foreground font-medium">
                {catDone}/{items.length}
              </span>
            </div>
            <div className="divide-y divide-border/50">
              {items.map((item) => {
                const done = isChecked(item.id);
                const auto = autoStatus[item.id];

                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-start gap-4 px-5 py-4 transition-colors cursor-pointer hover:bg-muted/30",
                      done && "bg-muted/20"
                    )}
                    onClick={() => toggle(item.id)}
                  >
                    <button
                      className="mt-0.5 flex-shrink-0"
                      onClick={(e) => { e.stopPropagation(); toggle(item.id); }}
                    >
                      {done ? (
                        <CheckCircle2 className="w-5 h-5 text-success" />
                      ) : (
                        <Circle className="w-5 h-5 text-muted-foreground/40" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm font-medium",
                        done ? "text-muted-foreground line-through" : "text-card-foreground"
                      )}>
                        {item.label}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                      {auto && (
                        <p className={cn(
                          "text-xs mt-1 flex items-center gap-1",
                          auto.done ? "text-success" : "text-warning"
                        )}>
                          {auto.done ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                          {auto.hint}
                        </p>
                      )}
                    </div>
                    {item.link && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-shrink-0 text-primary"
                        onClick={(e) => { e.stopPropagation(); navigate(item.link!); }}
                      >
                        Go <ArrowRight className="w-3 h-3 ml-1" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
