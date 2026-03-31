// Job Opening Balances - enter pre-ledger cost/revenue totals
import { useState } from "react";
import ClientSelect from "@/components/ClientSelect";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Job } from "@/integrations/supabase/helpers";
import { fetchAll } from "@/lib/fetchAll";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Save, Loader2, Briefcase, CheckCircle } from "lucide-react";
import { parseMoney, sumMoney } from "@/lib/utils";
import { toast } from "sonner";

interface CostEntry {
  label: string;
  accountNumber: string;
  amount: string;
}

const COST_CATEGORIES: { label: string; accountNumber: string }[] = [
  { label: "Labor (Payroll)", accountNumber: "6100" },
  { label: "Materials / Supplies", accountNumber: "5000" },
  { label: "Subcontractors", accountNumber: "5100" },
  { label: "Equipment Rental", accountNumber: "5200" },
  { label: "Permits & Fees", accountNumber: "5300" },
  { label: "Other Job Costs", accountNumber: "5400" },
];

const REVENUE_CATEGORY = { label: "Revenue (Invoiced)", accountNumber: "4000" };

const defaultNewJob = () => ({ job_number: "", name: "", client: "", budget: "" });

export default function JobOpeningBalances() {
  const queryClient = useQueryClient();
  const [selectedJobId, setSelectedJobId] = useState("");
  const [costs, setCosts] = useState<CostEntry[]>(
    COST_CATEGORIES.map((c) => ({ ...c, amount: "" }))
  );
  const [revenue, setRevenue] = useState("");
  const [arBalance, setArBalance] = useState("");
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [newJob, setNewJob] = useState(defaultNewJob());
  const [postedJobs, setPostedJobs] = useState<string[]>([]);

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs-list"],
    queryFn: () => fetchAll<Job>((sb) => sb.from("jobs").select("*").order("job_number")),
  });

  const { data: glAccounts = [] } = useQuery({
    queryKey: ["gl-accounts-all"],
    queryFn: () => fetchAll((sb) => sb.from("gl_accounts").select("*").eq("active", true)),
  });

  const findAccount = (num: string) =>
    glAccounts.find((a: any) => a.account_number === num)?.id;

  const createJobMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("jobs").insert({
        job_number: newJob.job_number,
        name: newJob.name,
        client: newJob.client,
        budget: parseMoney(newJob.budget),
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Job ${data.job_number} created`);
      queryClient.invalidateQueries({ queryKey: ["jobs-list"] });
      setSelectedJobId(data.id);
      setNewJobOpen(false);
      setNewJob(defaultNewJob());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const postMutation = useMutation({
    mutationFn: async () => {
      const oeId = findAccount("3900");
      if (!oeId) throw new Error("Opening Balance Equity account (3900) not found. Add it to Chart of Accounts first.");

      const job = jobs.find((j) => j.id === selectedJobId);
      if (!job) throw new Error("Select a job first");

      const lines: { account_id: string; debit: number; credit: number; description: string; job_id: string }[] = [];

      // Expense lines (debit expense, credit OBE)
      for (const cost of costs) {
        const amt = parseMoney(cost.amount);
        if (amt <= 0) continue;
        const acctId = findAccount(cost.accountNumber);
        if (!acctId) throw new Error(`GL account ${cost.accountNumber} (${cost.label}) not found. Add it to Chart of Accounts.`);
        lines.push({ account_id: acctId, debit: amt, credit: 0, description: `Opening bal: ${cost.label}`, job_id: selectedJobId });
        lines.push({ account_id: oeId, debit: 0, credit: amt, description: `Opening bal: ${cost.label}`, job_id: selectedJobId });
      }

      // Revenue line (credit revenue, debit OBE) — gives job its revenue for profitability
      const revAmt = parseMoney(revenue);
      if (revAmt > 0) {
        const revId = findAccount(REVENUE_CATEGORY.accountNumber);
        if (!revId) throw new Error(`GL account ${REVENUE_CATEGORY.accountNumber} (Revenue) not found.`);
        lines.push({ account_id: revId, debit: 0, credit: revAmt, description: `Opening bal: Revenue`, job_id: selectedJobId });
        lines.push({ account_id: oeId, debit: revAmt, credit: 0, description: `Opening bal: Revenue`, job_id: selectedJobId });
      }

      // AR reclassification — moves AR from generic opening balance to job-tagged
      // DR AR (with job_id) / CR AR (no job_id) = net zero on GL 1100 total
      // This avoids double-counting the AR already posted via Opening Balance Wizard
      const arAmt = parseMoney(arBalance);
      if (arAmt > 0) {
        const arId = findAccount("1100");
        if (!arId) throw new Error("GL account 1100 (AR) not found.");
        // Debit AR tagged to this job
        lines.push({ account_id: arId, debit: arAmt, credit: 0, description: `Reclassify AR to ${job?.job_number}`, job_id: selectedJobId });
        // Credit AR untagged (removes from generic pool)
        lines.push({ account_id: arId, debit: 0, credit: arAmt, description: `Reclassify AR to ${job?.job_number}`, job_id: "" });
      }

      if (lines.length === 0) throw new Error("Enter at least one amount");

      // Create JE as draft
      const { data: je, error: jeErr } = await supabase.from("journal_entries").insert({
        entry_number: `JOB-OB-${job?.job_number}`,
        date: new Date().toISOString().slice(0, 10),
        description: `Job opening balances: ${job?.job_number} — ${job?.name}`,
        status: "draft",
      }).select().single();
      if (jeErr) throw jeErr;

      // Insert lines
      const { error: lineErr } = await supabase.from("journal_entry_lines").insert(
        lines.map((l) => ({ ...l, journal_entry_id: je.id }))
      );
      if (lineErr) throw lineErr;

      // Post it
      const { error: postErr } = await supabase.from("journal_entries").update({ status: "posted" }).eq("id", je.id);
      if (postErr) throw postErr;

      return job?.job_number;
    },
    onSuccess: (jobNum) => {
      toast.success(`Opening balances posted for Job ${jobNum}`);
      setPostedJobs((prev) => [...prev, selectedJobId]);
      setCosts(COST_CATEGORIES.map((c) => ({ ...c, amount: "" })));
      setRevenue("");
      setArBalance("");
      setSelectedJobId("");
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalCosts = sumMoney(costs.map((c) => parseMoney(c.amount)));
  const totalRevenue = parseMoney(revenue);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader title="Job Opening Balances" description="Enter pre-ledger cost and revenue totals for existing jobs" />

      {/* Job selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Briefcase className="h-5 w-5" /> Select or Create Job
          </CardTitle>
          <CardDescription>Pick an existing job or add a new one</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="flex-1 space-y-1">
              <Label>Job</Label>
              <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                <SelectTrigger><SelectValue placeholder="Choose a job…" /></SelectTrigger>
                <SelectContent>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.job_number} — {j.name} ({j.client || "No client"})
                      {postedJobs.includes(j.id) ? " ✓" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => setNewJobOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Job
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* New Job Dialog */}
      <Dialog open={newJobOpen} onOpenChange={setNewJobOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add New Job</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label>Job Number</Label><Input placeholder="J-100" value={newJob.job_number} onChange={(e) => setNewJob({ ...newJob, job_number: e.target.value })} /></div>
            <div><Label>Job Name</Label><Input placeholder="Project name" value={newJob.name} onChange={(e) => setNewJob({ ...newJob, name: e.target.value })} /></div>
            <div><Label>Client</Label><ClientSelect value={newJob.client} onValueChange={(v) => setNewJob({ ...newJob, client: v })} /></div>
            <div><Label>Budget</Label><Input type="number" placeholder="0.00" value={newJob.budget} onChange={(e) => setNewJob({ ...newJob, budget: e.target.value })} /></div>
            <Button onClick={() => createJobMutation.mutate()} disabled={createJobMutation.isPending || !newJob.job_number || !newJob.name}>
              {createJobMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Job
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cost entry */}
      {selectedJobId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Cost & Revenue Totals</CardTitle>
            <CardDescription>
              Enter lump-sum pre-ledger totals. Each amount posts as a journal entry against Opening Balance Equity (3900) with the job linked.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="w-28 text-right">GL Acct</TableHead>
                  <TableHead className="w-40 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costs.map((c, i) => (
                  <TableRow key={c.accountNumber}>
                    <TableCell className="font-medium">{c.label}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{c.accountNumber}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        className="w-36 text-right ml-auto"
                        placeholder="0.00"
                        value={c.amount}
                        onChange={(e) => {
                          const next = [...costs];
                          next[i] = { ...c, amount: e.target.value };
                          setCosts(next);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-primary/30">
                  <TableCell className="font-bold">Total Costs</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono font-bold">${totalCosts.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <div className="border-t border-border pt-4 grid gap-3">
              <div className="flex items-center gap-4">
                <Label className="w-48">Revenue (Invoiced to Date)</Label>
                <span className="font-mono text-muted-foreground w-20 text-right">{REVENUE_CATEGORY.accountNumber}</span>
                <Input type="number" className="w-36 text-right ml-auto" placeholder="0.00" value={revenue} onChange={(e) => setRevenue(e.target.value)} />
              </div>
              <div className="flex items-center gap-4">
                <Label className="w-48">Outstanding AR Balance</Label>
                <span className="font-mono text-muted-foreground w-20 text-right">1100</span>
                <Input type="number" className="w-36 text-right ml-auto" placeholder="0.00" value={arBalance} onChange={(e) => setArBalance(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground italic">
                AR is reclassified from your generic opening balance — it does NOT add new AR. The total in GL 1100 stays the same; it just gets tagged to this job.
              </p>
            </div>

            {totalCosts > 0 && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between"><span>Total Costs:</span><span className="font-mono">${totalCosts.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between"><span>Total Revenue:</span><span className="font-mono">${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between font-bold border-t border-border pt-1">
                  <span>Profit / (Loss):</span>
                  <span className={`font-mono ${totalRevenue - totalCosts >= 0 ? "text-primary" : "text-destructive"}`}>
                    ${(totalRevenue - totalCosts).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            )}

            <Button
              className="w-full"
              onClick={() => postMutation.mutate()}
              disabled={postMutation.isPending || totalCosts + totalRevenue + parseMoney(arBalance) === 0}
            >
              {postMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Post Opening Balances
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Posted summary */}
      {postedJobs.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="h-4 w-4 text-primary" />
              <span>Posted opening balances for {postedJobs.length} job(s) this session</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
