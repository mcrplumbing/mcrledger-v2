import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import JobSelect from "@/components/JobSelect";
import ClientSelect from "@/components/ClientSelect";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, DollarSign, FileText, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  paid: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  overdue: "bg-destructive/10 text-destructive",
};

const defaultForm = () => ({
  invoice_number: "", job_id: "", client: "", description: "", amount: "",
  date: new Date().toISOString().split("T")[0], due_date: "", status: "draft",
});

export default function Invoices() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm());

  // Receive payment state
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payInvoice, setPayInvoice] = useState<any>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().split("T")[0]);
  const [payMethod, setPayMethod] = useState("check");
  const [payRefNo, setPayRefNo] = useState("");

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["job-invoices"],
    queryFn: async () => fetchAll((sb) => sb.from("job_invoices").select("*, jobs(job_number, name)").order("date", { ascending: false })),
  });

  const { data: undepositedCount = 0 } = useQuery({
    queryKey: ["undeposited-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("received_payments")
        .select("*", { count: "exact", head: true })
        .eq("deposited", false);
      if (error) throw error;
      return count || 0;
    },
  });

  const openEdit = (inv: any) => {
    setEditingId(inv.id);
    setForm({
      invoice_number: inv.invoice_number, job_id: inv.job_id || "", client: inv.client,
      description: inv.description, amount: String(inv.amount), date: inv.date,
      due_date: inv.due_date || "", status: inv.status,
    });
    setDialogOpen(true);
  };

  const openNew = () => { setEditingId(null); setForm(defaultForm()); setDialogOpen(true); };

  const openReceivePayment = (inv: any) => {
    setPayInvoice(inv);
    const outstanding = (inv.amount || 0) - (inv.paid || 0);
    setPayAmount(String(outstanding));
    setPayDate(new Date().toISOString().split("T")[0]);
    setPayMethod("check");
    setPayRefNo("");
    setPayDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const row = {
        invoice_number: form.invoice_number, job_id: form.job_id || null, client: form.client,
        description: form.description, amount: parseFloat(form.amount) || 0,
        date: form.date, due_date: form.due_date || null, status: form.status,
      };
      if (editingId) {
        const { error } = await supabase.from("job_invoices").update(row).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("job_invoices").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-invoices"] });
      setDialogOpen(false);
      toast.success(editingId ? "Invoice updated" : "Invoice created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Void invoice: zero out amount and mark as void (trigger will void the JE)
  const voidMutation = useMutation({
    mutationFn: async (id: string) => {
      const inv = invoices.find(i => i.id === id);
      if (!inv) throw new Error("Invoice not found");
      const { error } = await supabase.from("job_invoices")
        .update({ status: "void", amount: 0, description: `VOIDED: ${inv.description || inv.invoice_number}` })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-invoices"] });
      setDeleteId(null);
      toast.success("Invoice voided — reversing journal entry created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Receive Payment → Undeposited Funds (no bank transaction yet)
  const receivePaymentMutation = useMutation({
    mutationFn: async () => {
      if (!payInvoice) throw new Error("No invoice selected");
      const amount = parseFloat(payAmount) || 0;
      if (amount <= 0) throw new Error("Amount must be greater than 0");
      const outstanding = (payInvoice.amount || 0) - (payInvoice.paid || 0);
      if (amount > outstanding + 0.01) throw new Error("Amount exceeds outstanding balance");

      // Insert into received_payments (undeposited funds)
      const { error: rpError } = await supabase.from("received_payments").insert({
        invoice_id: payInvoice.id,
        client: payInvoice.client,
        amount,
        payment_date: payDate,
        payment_method: payMethod,
        reference_no: payRefNo,
        memo: `Invoice ${payInvoice.invoice_number}`,
      });
      if (rpError) throw rpError;

      // Update invoice paid amount and status
      const newPaid = (payInvoice.paid || 0) + amount;
      const newStatus = newPaid >= payInvoice.amount ? "paid" : payInvoice.status;
      const { error: invError } = await supabase.from("job_invoices")
        .update({ paid: newPaid, status: newStatus })
        .eq("id", payInvoice.id);
      if (invError) throw invError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["undeposited-count"] });
      setPayDialogOpen(false);
      toast.success("Payment received → Undeposited Funds");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const totalBilled = invoices.reduce((s, i) => s + (i.amount || 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (i.paid || 0), 0);
  const totalOutstanding = totalBilled - totalPaid;
  const overdueCount = invoices.filter((i) => i.status === "overdue").length;

  return (
    <div className="p-8">
      <PageHeader title="Invoices Receivable" description="Track customer invoices and revenue by job"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => window.location.href = "/make-deposit"} className="relative">
              <DollarSign className="w-4 h-4 mr-2" />Make Deposit
              {undepositedCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                  {undepositedCount}
                </span>
              )}
            </Button>
            <Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />New Invoice</Button>
          </div>
        } />

      {/* Create/Edit Invoice Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit Invoice" : "Create Invoice"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Invoice #</Label><Input placeholder="INV-001" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} /></div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Client</Label><ClientSelect value={form.client} onValueChange={(v) => setForm({ ...form, client: v })} /></div>
            <div><Label>Job</Label><JobSelect value={form.job_id} onValueChange={(v) => setForm({ ...form, job_id: v })} /></div>
            <div><Label>Description</Label><Input placeholder="Work description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Amount</Label><Input type="number" placeholder="0.00" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.invoice_number}>
              {editingId ? "Update Invoice" : "Save Invoice"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receive Payment → Undeposited Funds */}
      <Dialog open={payDialogOpen} onOpenChange={setPayDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Receive Payment</DialogTitle></DialogHeader>
          {payInvoice && (
            <div className="grid gap-4 py-4">
              <div className="glass-card rounded-lg p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Invoice:</span><span className="font-mono font-medium text-card-foreground">{payInvoice.invoice_number}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Client:</span><span className="text-card-foreground">{payInvoice.client}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Total:</span><span className="font-mono text-card-foreground">${(payInvoice.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Already Paid:</span><span className="font-mono text-card-foreground">${(payInvoice.paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                <div className="flex justify-between font-medium border-t border-border pt-1 mt-1">
                  <span className="text-card-foreground">Outstanding:</span>
                  <span className="font-mono text-card-foreground">${((payInvoice.amount || 0) - (payInvoice.paid || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
                💡 Payment will go to <strong>Undeposited Funds</strong>. Use <strong>Make Deposit</strong> to group payments into a bank deposit.
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><Label>Payment Amount</Label><Input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
                <div><Label>Date Received</Label><Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Payment Method</Label>
                  <Select value={payMethod} onValueChange={setPayMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="check">Check</SelectItem>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="ach">ACH/Wire</SelectItem>
                      <SelectItem value="credit_card">Credit Card</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Reference / Check #</Label><Input placeholder="e.g. 4521" value={payRefNo} onChange={(e) => setPayRefNo(e.target.value)} /></div>
              </div>
              <Button onClick={() => receivePaymentMutation.mutate()} disabled={receivePaymentMutation.isPending || !payAmount}>
                Receive Payment
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}
        onConfirm={() => deleteId && voidMutation.mutate(deleteId)}
        title="Void this invoice?"
        description="This will zero out the invoice amount and create a reversing journal entry. The invoice record remains for audit trail." />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard title="Total Billed" value={`$${totalBilled.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={FileText} />
        <StatCard title="Total Received" value={`$${totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={DollarSign} />
        <StatCard title="Outstanding" value={`$${totalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} icon={DollarSign} />
        <StatCard title="Overdue" value={overdueCount.toString()} icon={AlertTriangle} />
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Invoice #</th>
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Client</th>
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Job</th>
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Due</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Amount</th>
                <th className="text-right px-6 py-3 font-medium text-muted-foreground">Paid</th>
                <th className="text-center px-6 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-center px-6 py-3 font-medium text-muted-foreground w-36">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">No invoices yet.</td></tr>
              ) : invoices.map((inv) => {
                const outstanding = (inv.amount || 0) - (inv.paid || 0);
                return (
                  <tr key={inv.id} className="table-row-hover border-b border-border/50">
                    <td className="px-6 py-3 font-mono text-xs font-medium text-card-foreground">{inv.invoice_number}</td>
                    <td className="px-6 py-3 font-medium text-card-foreground">{inv.client}</td>
                    <td className="px-6 py-3 font-mono text-xs text-primary">{(inv as any).jobs?.job_number ? `${(inv as any).jobs.job_number} - ${(inv as any).jobs.name}` : "—"}</td>
                    <td className="px-6 py-3 text-muted-foreground">{inv.date}</td>
                    <td className="px-6 py-3 text-muted-foreground">{inv.due_date || "—"}</td>
                    <td className="px-6 py-3 text-right font-mono font-medium text-card-foreground">${(inv.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="px-6 py-3 text-right font-mono text-card-foreground">${(inv.paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="px-6 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status] || ""}`}>{inv.status}</span>
                    </td>
                    <td className="px-6 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {outstanding > 0.01 && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openReceivePayment(inv)}>
                            <DollarSign className="w-3 h-3 mr-1" />Receive
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(inv)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        {inv.status !== "void" && (
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-warning hover:text-warning" onClick={() => setDeleteId(inv.id)} title="Void invoice">
                            <Ban className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
