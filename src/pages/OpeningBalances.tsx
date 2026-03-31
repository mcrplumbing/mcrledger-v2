import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { CalendarIcon, ChevronRight, ChevronLeft, Check, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ACCOUNT_TYPE_STEPS = [
  { type: "asset", label: "Assets", icon: "💰", description: "Cash, accounts receivable, equipment, vehicles, inventory — things you own", normalBalance: "debit" },
  { type: "liability", label: "Liabilities", icon: "📋", description: "Accounts payable, loans, credit cards — things you owe", normalBalance: "credit" },
  { type: "equity", label: "Equity", icon: "🏛️", description: "Owner's equity, retained earnings, capital contributions", normalBalance: "credit" },
  { type: "revenue", label: "Revenue (YTD)", icon: "📈", description: "Year-to-date income and sales through your cutover date", normalBalance: "credit" },
  { type: "expense", label: "Expenses (YTD)", icon: "📉", description: "Year-to-date costs and expenses through your cutover date", normalBalance: "debit" },
];

interface AccountBalance {
  accountId: string;
  accountNumber: string;
  accountName: string;
  balance: string;
  normalBalance: string;
}

export default function OpeningBalances() {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0); // 0 = date, 1-5 = account types, 6 = review
  const [cutoverDate, setCutoverDate] = useState<Date>();
  const [balances, setBalances] = useState<Record<string, string>>({});

  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ["gl-accounts-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("gl_accounts")
        .select("id, account_number, name, account_type, normal_balance, active")
        .eq("active", true)
        .order("account_number");
      if (error) throw error;
      return data;
    },
  });

  const accountsByType = useMemo(() => {
    const grouped: Record<string, typeof accounts> = {};
    ACCOUNT_TYPE_STEPS.forEach((s) => {
      grouped[s.type] = accounts.filter((a) => a.account_type === s.type);
    });
    return grouped;
  }, [accounts]);

  const getBalance = (id: string) => balances[id] || "";
  const setBalance = (id: string, val: string) => setBalances((prev) => ({ ...prev, [id]: val }));

  // Calculate totals for review
  const allEntries = useMemo(() => {
    const lines: AccountBalance[] = [];
    accounts.forEach((a) => {
      const bal = parseFloat(balances[a.id] || "0");
      if (bal > 0) {
        lines.push({
          accountId: a.id,
          accountNumber: a.account_number,
          accountName: a.name,
          balance: bal.toFixed(2),
          normalBalance: a.normal_balance,
        });
      }
    });
    return lines;
  }, [accounts, balances]);

  const totalDebits = useMemo(
    () => allEntries.filter((e) => e.normalBalance === "debit").reduce((s, e) => s + parseFloat(e.balance), 0),
    [allEntries]
  );
  const totalCredits = useMemo(
    () => allEntries.filter((e) => e.normalBalance === "credit").reduce((s, e) => s + parseFloat(e.balance), 0),
    [allEntries]
  );
  const difference = totalDebits - totalCredits;
  const isBalanced = Math.abs(difference) < 0.01 && allEntries.length > 0;

  const postMutation = useMutation({
    mutationFn: async () => {
      if (!cutoverDate) throw new Error("Please set a cutover date");
      if (!isBalanced) throw new Error("Debits must equal credits. Adjust balances or the Opening Balance Equity account.");

      const dateStr = format(cutoverDate, "yyyy-MM-dd");

      // Create the journal entry header as draft first (draft-then-post pattern)
      const { data: entry, error: hErr } = await supabase
        .from("journal_entries")
        .insert({
          entry_number: `OB-${dateStr}`,
          date: dateStr,
          description: `Opening balances as of ${format(cutoverDate, "PPP")}`,
          status: "draft",
        })
        .select("id")
        .single();
      if (hErr) throw hErr;

      // Create journal entry lines
      const lineInserts = allEntries.map((e) => ({
        journal_entry_id: entry.id,
        account_id: e.accountId,
        debit: e.normalBalance === "debit" ? parseFloat(e.balance) : 0,
        credit: e.normalBalance === "credit" ? parseFloat(e.balance) : 0,
        description: "Opening balance",
      }));

      const { error: lErr } = await supabase.from("journal_entry_lines").insert(lineInserts);
      if (lErr) throw lErr;

      // Now post — balance validation will pass with all lines in place
      const { error: postErr } = await supabase
        .from("journal_entries")
        .update({ status: "posted" })
        .eq("id", entry.id);
      if (postErr) throw postErr;

      return entry.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["gl-accounts"] });
      toast.success("Opening balances posted as journal entry!");
      setStep(7); // success screen
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const totalSteps = 7; // 0=date, 1-5=types, 6=review
  const canGoNext = step === 0 ? !!cutoverDate : true;

  if (accountsLoading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <PageHeader
        title="Opening Balance Wizard"
        description="Set up your starting balances for a clean cutover from another system"
      />

      {/* Progress bar */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          {["Date", ...ACCOUNT_TYPE_STEPS.map((s) => s.label), "Review"].map((label, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <button
                onClick={() => i <= 6 && step !== 7 && setStep(i)}
                className={cn(
                  "flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-colors",
                  i === step
                    ? "bg-primary text-primary-foreground"
                    : i < step
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {i < step ? <Check className="w-4 h-4" /> : i + 1}
              </button>
              {i < 6 && <div className={cn("flex-1 h-0.5", i < step ? "bg-primary/40" : "bg-muted")} />}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground px-1">
          {["Date", ...ACCOUNT_TYPE_STEPS.map((s) => s.label), "Review"].map((label, i) => (
            <span key={i} className={cn("text-center", i === step && "text-primary font-medium")}>{label}</span>
          ))}
        </div>
      </div>

      {/* Step 0: Cutover Date */}
      {step === 0 && (
        <div className="glass-card rounded-xl p-8 max-w-lg mx-auto text-center space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-card-foreground mb-2">Choose Your Cutover Date</h2>
            <p className="text-muted-foreground">
              This is the date your balances are effective as of. Typically the last day of a month or quarter 
              (e.g., March 31st for an April 1st start).
            </p>
          </div>
          <div className="flex justify-center">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-64 justify-start text-left font-normal", !cutoverDate && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {cutoverDate ? format(cutoverDate, "PPP") : "Pick cutover date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="center">
                <Calendar mode="single" selected={cutoverDate} onSelect={setCutoverDate} initialFocus className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}

      {/* Steps 1-5: Account type balance entry */}
      {step >= 1 && step <= 5 && (() => {
        const typeStep = ACCOUNT_TYPE_STEPS[step - 1];
        const typeAccounts = accountsByType[typeStep.type] || [];
        const typeTotal = typeAccounts.reduce((s, a) => s + (parseFloat(balances[a.id] || "0") || 0), 0);

        return (
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="p-6 border-b border-border">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{typeStep.icon}</span>
                <div>
                  <h2 className="text-xl font-bold text-card-foreground">{typeStep.label}</h2>
                  <p className="text-sm text-muted-foreground">{typeStep.description}</p>
                </div>
              </div>
            </div>

            {typeAccounts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <p>No {typeStep.label.toLowerCase()} accounts in your Chart of Accounts yet.</p>
                <p className="text-sm mt-1">Add them in Chart of Accounts or CSV Import, then come back.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {typeAccounts.map((account) => (
                  <div key={account.id} className="flex items-center gap-4 px-6 py-3 hover:bg-muted/20 transition-colors">
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-sm text-muted-foreground mr-2">{account.account_number}</span>
                      <span className="text-sm font-medium text-card-foreground">{account.name}</span>
                    </div>
                    <div className="flex items-center gap-2 w-48">
                      <span className="text-xs text-muted-foreground">$</span>
                      <Input
                        type="number"
                        className="h-9 text-right font-mono"
                        placeholder="0.00"
                        value={getBalance(account.id)}
                        onChange={(e) => setBalance(account.id, e.target.value)}
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="px-6 py-4 bg-muted/20 border-t border-border flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                Total {typeStep.label}
              </span>
              <span className="font-mono text-lg font-bold text-card-foreground">
                ${typeTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Step 6: Review */}
      {step === 6 && (
        <div className="space-y-4">
          <div className="glass-card rounded-xl p-6">
            <h2 className="text-xl font-bold text-card-foreground mb-1">Review Opening Balances</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Journal entry <span className="font-mono font-medium">OB-{cutoverDate ? format(cutoverDate, "yyyy-MM-dd") : "?"}</span> will be posted as of{" "}
              <span className="font-medium">{cutoverDate ? format(cutoverDate, "PPP") : "—"}</span>
            </p>

            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Account</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground w-32">Debit</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground w-32">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {allEntries.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                        No balances entered. Go back and enter some account balances.
                      </td>
                    </tr>
                  ) : (
                    allEntries.map((e) => (
                      <tr key={e.accountId} className="border-b border-border/50">
                        <td className="px-4 py-2 text-card-foreground">
                          <span className="font-mono text-xs text-muted-foreground mr-2">{e.accountNumber}</span>
                          {e.accountName}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-card-foreground">
                          {e.normalBalance === "debit" ? `$${parseFloat(e.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ""}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-card-foreground">
                          {e.normalBalance === "credit" ? `$${parseFloat(e.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ""}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/20 border-t border-border font-bold">
                    <td className="px-4 py-3 text-card-foreground">Totals</td>
                    <td className="px-4 py-3 text-right font-mono text-card-foreground">
                      ${totalDebits.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-card-foreground">
                      ${totalCredits.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-4">
              {isBalanced ? (
                <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "hsl(var(--primary))" }}>
                  <Check className="w-4 h-4" />
                  Balanced — ready to post!
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-destructive text-sm font-medium">
                    <AlertCircle className="w-4 h-4" />
                    Out of balance by ${Math.abs(difference).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    {difference > 0 ? " (debits exceed credits)" : " (credits exceed debits)"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tip: Go back and adjust an Equity account (like "Opening Balance Equity") to absorb the difference, 
                    or double-check your asset/liability balances match your QuickBooks trial balance.
                  </p>
                </div>
              )}
            </div>
          </div>

          <Button
            className="w-full h-12 text-base"
            onClick={() => postMutation.mutate()}
            disabled={postMutation.isPending || !isBalanced}
          >
            {postMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Posting...</>
            ) : (
              <><Check className="w-4 h-4 mr-2" />Post Opening Balances</>
            )}
          </Button>
        </div>
      )}

      {/* Step 7: Success */}
      {step === 7 && (
        <div className="glass-card rounded-xl p-12 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Check className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-card-foreground">Opening Balances Posted!</h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Your opening balance journal entry has been created and posted. You can view it in Journal Entries 
            or see its effect in GL Reports.
          </p>
          <div className="flex gap-3 justify-center pt-2">
            <Button variant="outline" onClick={() => window.location.href = "/journal-entries"}>View Journal Entries</Button>
            <Button onClick={() => window.location.href = "/gl-reports"}>View GL Reports</Button>
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      {step < 7 && (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
            <ChevronLeft className="w-4 h-4 mr-2" />Back
          </Button>
          {step < 6 && (
            <Button onClick={() => setStep(step + 1)} disabled={!canGoNext}>
              Next<ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
