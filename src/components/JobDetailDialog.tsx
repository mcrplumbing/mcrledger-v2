import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FileText, DollarSign, Clock, Receipt } from "lucide-react";

interface JobDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: any;
}

const fmt = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function JobDetailDialog({ open, onOpenChange, job }: JobDetailDialogProps) {
  const jobId = job?.id;

  const { data: transactions = [] } = useQuery({
    queryKey: ["job-detail-transactions", jobId],
    queryFn: async () => fetchAll((sb) =>
      sb.from("transactions").select("*").eq("job_id", jobId).order("date", { ascending: false })
    ),
    enabled: !!jobId && open,
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["job-detail-invoices", jobId],
    queryFn: async () => fetchAll((sb) =>
      sb.from("job_invoices").select("*").eq("job_id", jobId).order("date", { ascending: false })
    ),
    enabled: !!jobId && open,
  });

  const { data: vendorInvoices = [] } = useQuery({
    queryKey: ["job-detail-vendor-invoices", jobId],
    queryFn: async () => fetchAll((sb) =>
      sb.from("vendor_invoices").select("*, vendors(name)").eq("job_id", jobId).order("date", { ascending: false })
    ),
    enabled: !!jobId && open,
  });

  const { data: timesheets = [] } = useQuery({
    queryKey: ["job-detail-timesheets", jobId],
    queryFn: async () => fetchAll((sb) =>
      sb.from("timesheets").select("*, employees(name, rate)").eq("job_id", jobId).order("date", { ascending: false })
    ),
    enabled: !!jobId && open,
  });

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{job.job_number} — {job.name}</DialogTitle>
          <p className="text-sm text-muted-foreground">Client: {job.client || "—"}</p>
        </DialogHeader>

        <Tabs defaultValue="transactions" className="mt-2">
          <TabsList>
            <TabsTrigger value="transactions"><DollarSign className="w-3.5 h-3.5 mr-1.5" />Checkbook ({transactions.length})</TabsTrigger>
            <TabsTrigger value="invoices"><FileText className="w-3.5 h-3.5 mr-1.5" />AR Invoices ({invoices.length})</TabsTrigger>
            <TabsTrigger value="vendor"><Receipt className="w-3.5 h-3.5 mr-1.5" />AP Bills ({vendorInvoices.length})</TabsTrigger>
            <TabsTrigger value="timesheets"><Clock className="w-3.5 h-3.5 mr-1.5" />Timesheets ({timesheets.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="transactions">
            {transactions.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground text-sm">No checkbook transactions linked to this job.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Check #</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Payee</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Memo</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Payment</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Deposit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t: any) => (
                      <tr key={t.id} className="border-b border-border/50">
                        <td className="px-3 py-2 text-card-foreground">{t.date}</td>
                        <td className="px-3 py-2 font-mono text-xs text-card-foreground">{t.check_no || "—"}</td>
                        <td className="px-3 py-2 text-card-foreground">{t.payee}</td>
                        <td className="px-3 py-2 text-muted-foreground">{t.memo}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive">{t.payment > 0 ? fmt(t.payment) : ""}</td>
                        <td className="px-3 py-2 text-right font-mono text-success">{t.deposit > 0 ? fmt(t.deposit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="invoices">
            {invoices.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground text-sm">No AR invoices linked to this job.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Invoice #</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Client</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Amount</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv: any) => (
                      <tr key={inv.id} className="border-b border-border/50">
                        <td className="px-3 py-2 font-mono text-xs text-card-foreground">{inv.invoice_number}</td>
                        <td className="px-3 py-2 text-card-foreground">{inv.client}</td>
                        <td className="px-3 py-2 text-muted-foreground">{inv.date}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">{inv.status}</span></td>
                        <td className="px-3 py-2 text-right font-mono text-card-foreground">{fmt(inv.amount || 0)}</td>
                        <td className="px-3 py-2 text-right font-mono text-success">{fmt(inv.paid || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="vendor">
            {vendorInvoices.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground text-sm">No vendor invoices linked to this job.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Invoice #</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Vendor</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorInvoices.map((vi: any) => (
                      <tr key={vi.id} className="border-b border-border/50">
                        <td className="px-3 py-2 font-mono text-xs text-card-foreground">{vi.invoice_no}</td>
                        <td className="px-3 py-2 text-card-foreground">{vi.vendors?.name || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{vi.date}</td>
                        <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">{vi.status}</span></td>
                        <td className="px-3 py-2 text-right font-mono text-card-foreground">{fmt(vi.amount || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="timesheets">
            {timesheets.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground text-sm">No timesheets linked to this job.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Employee</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Pay Class</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Hours</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Rate</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timesheets.map((ts: any) => {
                      const rate = ts.employees?.rate || 0;
                      const multiplier = ts.pay_class === "double" ? 2 : ts.pay_class === "overtime" ? 1.5 : 1;
                      const cost = (ts.hours || 0) * rate * multiplier;
                      return (
                        <tr key={ts.id} className="border-b border-border/50">
                          <td className="px-3 py-2 text-card-foreground">{ts.date}</td>
                          <td className="px-3 py-2 text-card-foreground">{ts.employees?.name || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground capitalize">{ts.pay_class}</td>
                          <td className="px-3 py-2 text-right font-mono text-card-foreground">{(ts.hours || 0).toFixed(1)}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmt(rate)}</td>
                          <td className="px-3 py-2 text-right font-mono text-card-foreground">{fmt(cost)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
