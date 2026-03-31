import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { VendorInvoiceWithRelations } from "@/integrations/supabase/helpers";
import PageHeader from "@/components/PageHeader";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import JobSelect from "@/components/JobSelect";
import VendorSelect from "@/components/VendorSelect";
import { Plus, Search, Pencil, Trash2, CreditCard, Upload } from "lucide-react";
import BulkApImportDialog from "@/components/BulkApImportDialog";
import { cn, parseMoney } from "@/lib/utils";
import { fetchAll } from "@/lib/fetchAll";
import { toast } from "sonner";

export default function Vendors() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [vendorDialogOpen, setVendorDialogOpen] = useState(false);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [payBillsOpen, setPayBillsOpen] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "vendor" | "invoice"; id: string } | null>(null);
  const [vendorForm, setVendorForm] = useState({ name: "", contact: "", phone: "", email: "", address: "", tax_id: "", is_1099: false });
  const [invoiceForm, setInvoiceForm] = useState({ vendor_id: "", invoice_no: "", amount: "", date: new Date().toISOString().split("T")[0], due_date: "", job_id: "" });
  const [selectedBills, setSelectedBills] = useState<Set<string>>(new Set());
  const [payBankAccountId, setPayBankAccountId] = useState("");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => { const { data, error } = await supabase.from("vendors").select("*").order("name"); if (error) throw error; return data; },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["vendor-invoices"],
    queryFn: async () => fetchAll((sb) => sb.from("vendor_invoices").select("*, vendors(name), jobs(job_number)").order("date", { ascending: false })) as Promise<VendorInvoiceWithRelations[]>,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async () => { const { data, error } = await supabase.from("bank_accounts").select("*").eq("active", true).order("name"); if (error) throw error; return data; },
  });

  // Vendor CRUD
  const openNewVendor = () => { setEditingVendorId(null); setVendorForm({ name: "", contact: "", phone: "", email: "", address: "", tax_id: "", is_1099: false }); setVendorDialogOpen(true); };
  const openEditVendor = (v: any) => { setEditingVendorId(v.id); setVendorForm({ name: v.name, contact: v.contact, phone: v.phone, email: v.email, address: v.address || "", tax_id: v.tax_id || "", is_1099: v.is_1099 || false }); setVendorDialogOpen(true); };

  const saveVendor = useMutation({
    mutationFn: async () => {
      const row = { name: vendorForm.name, contact: vendorForm.contact, phone: vendorForm.phone, email: vendorForm.email, address: vendorForm.address, tax_id: vendorForm.tax_id, is_1099: vendorForm.is_1099 };
      if (editingVendorId) {
        const { error } = await supabase.from("vendors").update(row).eq("id", editingVendorId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("vendors").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["vendors"] }); setVendorDialogOpen(false); toast.success(editingVendorId ? "Vendor updated" : "Vendor added"); },
    onError: (err: Error) => toast.error(err.message),
  });

  // Invoice CRUD
  const openNewInvoice = () => { setEditingInvoiceId(null); setInvoiceForm({ vendor_id: "", invoice_no: "", amount: "", date: new Date().toISOString().split("T")[0], due_date: "", job_id: "" }); setInvoiceDialogOpen(true); };
  const openEditInvoice = (inv: any) => {
    setEditingInvoiceId(inv.id);
    setInvoiceForm({ vendor_id: inv.vendor_id, invoice_no: inv.invoice_no, amount: String(inv.amount), date: inv.date, due_date: inv.due_date || "", job_id: inv.job_id || "" });
    setInvoiceDialogOpen(true);
  };

  const saveInvoice = useMutation({
    mutationFn: async () => {
      const row = { vendor_id: invoiceForm.vendor_id, invoice_no: invoiceForm.invoice_no, amount: parseMoney(invoiceForm.amount), date: invoiceForm.date, due_date: invoiceForm.due_date || null, job_id: invoiceForm.job_id || null };
      if (editingInvoiceId) {
        const { error } = await supabase.from("vendor_invoices").update(row).eq("id", editingInvoiceId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("vendor_invoices").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] }); setInvoiceDialogOpen(false); toast.success(editingInvoiceId ? "Invoice updated" : "Invoice saved"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ type, id }: { type: "vendor" | "invoice"; id: string }) => {
      if (type === "invoice") {
        // Void instead of delete — preserves audit trail
        const { error } = await supabase.from("vendor_invoices").update({ status: "void" }).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("vendors").delete().eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
      setDeleteTarget(null);
      toast.success(variables.type === "invoice" ? "Invoice voided" : "Vendor deleted");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Pay Bills workflow
  const openBills = invoices.filter(inv => (inv.amount - inv.paid) > 0.005);
  
  const toggleBill = (id: string) => {
    setSelectedBills(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const payBillsMutation = useMutation({
    mutationFn: async () => {
      if (selectedBills.size === 0) throw new Error("No bills selected");
      if (!payBankAccountId) throw new Error("Please select a bank account to pay from");
      const today = new Date().toISOString().split("T")[0];

      // Look up AP account (2000) so the auto-post trigger creates DR AP / CR Cash
      const { data: apAcct } = await supabase.from("gl_accounts")
        .select("id").eq("account_number", "2000").eq("active", true).maybeSingle();
      if (!apAcct) {
        throw new Error("Missing GL account 2000 (Accounts Payable). Please add it in Chart of Accounts before paying bills.");
      }

      // Gather all selected bills
      const billsToPay = Array.from(selectedBills)
        .map(invId => invoices.find(i => i.id === invId))
        .filter((inv): inv is NonNullable<typeof inv> => !!inv && (inv.amount - inv.paid) > 0.005);

      if (billsToPay.length === 0) throw new Error("No open balances to pay");

      const totalPayment = billsToPay.reduce((sum, inv) => sum + (inv.amount - inv.paid), 0);
      const vendorNames = [...new Set(billsToPay.map(inv => inv.vendors?.name || "Vendor"))];
      const invoiceNos = billsToPay.map(inv => inv.invoice_no).filter(Boolean);
      const payee = vendorNames.join(", ");
      const memo = invoiceNos.length === 1
        ? `Pay invoice ${invoiceNos[0]}`
        : `Pay invoices: ${invoiceNos.join(", ")}`;

      // Create ONE consolidated checkbook transaction
      // gl_account_id = AP so trigger does DR AP / CR Cash (reduces liability)
      const { error: txErr } = await supabase.from("transactions").insert({
        date: today,
        payee,
        memo,
        category: "Accounts Payable",
        payment: totalPayment,
        deposit: 0,
        bank_account_id: payBankAccountId,
        job_id: billsToPay.length === 1 ? (billsToPay[0].job_id || null) : null,
        vendor_invoice_id: billsToPay.length === 1 ? billsToPay[0].id : null,
        gl_account_id: apAcct.id,
      });
      if (txErr) throw txErr;

      // Mark each invoice as paid
      for (const inv of billsToPay) {
        const { error: invErr } = await supabase.from("vendor_invoices")
          .update({ paid: inv.amount, status: "paid" })
          .eq("id", inv.id);
        if (invErr) throw invErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-checkbook"] });
      setPayBillsOpen(false);
      setSelectedBills(new Set());
      toast.success(`${selectedBills.size} bill(s) paid and recorded in checkbook`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const selectedTotal = Array.from(selectedBills).reduce((sum, id) => {
    const inv = invoices.find(i => i.id === id);
    return sum + (inv ? inv.amount - inv.paid : 0);
  }, 0);

  return (
    <div className="p-8">
      <PageHeader title="Vendors & Accounts Payable" description="Manage vendor invoices, statements, and payments"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setBulkImportOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />Import AP CSV
            </Button>
            <Button variant="outline" onClick={() => { setSelectedBills(new Set()); if (bankAccounts.length > 0 && !payBankAccountId) setPayBankAccountId(bankAccounts[0].id); setPayBillsOpen(true); }}>
              <CreditCard className="w-4 h-4 mr-2" />Pay Bills
            </Button>
            <Button variant="outline" onClick={openNewVendor}><Plus className="w-4 h-4 mr-2" />Add Vendor</Button>
            <Button onClick={openNewInvoice}><Plus className="w-4 h-4 mr-2" />New Invoice</Button>
          </div>
        }
      />

      {/* Vendor Dialog */}
      <Dialog open={vendorDialogOpen} onOpenChange={setVendorDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingVendorId ? "Edit Vendor" : "Add Vendor"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label>Name</Label><Input value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} /></div>
            <div><Label>Contact</Label><Input value={vendorForm.contact} onChange={(e) => setVendorForm({ ...vendorForm, contact: e.target.value })} /></div>
            <div><Label>Address</Label><Input placeholder="Street, City, State ZIP" value={vendorForm.address} onChange={(e) => setVendorForm({ ...vendorForm, address: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Phone</Label><Input value={vendorForm.phone} onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={vendorForm.email} onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Tax ID / EIN</Label><Input placeholder="XX-XXXXXXX" value={vendorForm.tax_id} onChange={(e) => setVendorForm({ ...vendorForm, tax_id: e.target.value })} /></div>
              <div className="flex items-end gap-2 pb-1">
                <Checkbox id="is1099" checked={vendorForm.is_1099} onCheckedChange={(c) => setVendorForm({ ...vendorForm, is_1099: !!c })} />
                <Label htmlFor="is1099" className="cursor-pointer">1099 Vendor</Label>
              </div>
            </div>
            <Button onClick={() => saveVendor.mutate()} disabled={saveVendor.isPending}>{editingVendorId ? "Update Vendor" : "Save Vendor"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Invoice Dialog */}
      <Dialog open={invoiceDialogOpen} onOpenChange={setInvoiceDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingInvoiceId ? "Edit Invoice" : "Enter Vendor Invoice"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label>Vendor</Label>
              <VendorSelect value={invoiceForm.vendor_id} onValueChange={(v) => setInvoiceForm({ ...invoiceForm, vendor_id: v })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Invoice #</Label><Input value={invoiceForm.invoice_no} onChange={(e) => setInvoiceForm({ ...invoiceForm, invoice_no: e.target.value })} /></div>
              <div><Label>Amount</Label><Input type="number" value={invoiceForm.amount} onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Invoice Date</Label><Input type="date" value={invoiceForm.date} onChange={(e) => setInvoiceForm({ ...invoiceForm, date: e.target.value })} /></div>
              <div><Label>Due Date</Label><Input type="date" value={invoiceForm.due_date} onChange={(e) => setInvoiceForm({ ...invoiceForm, due_date: e.target.value })} /></div>
            </div>
            <div>
              <Label>Job Number</Label>
              <JobSelect value={invoiceForm.job_id} onValueChange={(v) => setInvoiceForm({ ...invoiceForm, job_id: v })} />
            </div>
            <Button onClick={() => saveInvoice.mutate()} disabled={saveInvoice.isPending}>{editingInvoiceId ? "Update Invoice" : "Save Invoice"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pay Bills Dialog */}
      <Dialog open={payBillsOpen} onOpenChange={setPayBillsOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Pay Bills</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            {bankAccounts.length > 0 && (
              <div>
                <Label>Pay From Account</Label>
                <Select value={payBankAccountId} onValueChange={setPayBankAccountId}>
                  <SelectTrigger><SelectValue placeholder="Select bank account" /></SelectTrigger>
                  <SelectContent>
                    {bankAccounts.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({a.account_type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {openBills.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No open bills to pay.</p>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b border-border">
                      <th className="px-3 py-2 w-8"><Checkbox checked={selectedBills.size === openBills.length && openBills.length > 0} onCheckedChange={(c) => {
                        if (c) setSelectedBills(new Set(openBills.map(b => b.id)));
                        else setSelectedBills(new Set());
                      }} /></th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Vendor</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Invoice #</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Due</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Balance Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openBills.map(inv => (
                      <tr key={inv.id} className="border-b border-border/50">
                        <td className="px-3 py-2"><Checkbox checked={selectedBills.has(inv.id)} onCheckedChange={() => toggleBill(inv.id)} /></td>
                        <td className="px-3 py-2 font-medium text-card-foreground">{inv.vendors?.name}</td>
                        <td className="px-3 py-2 font-mono text-xs">{inv.invoice_no}</td>
                        <td className="px-3 py-2 text-muted-foreground">{inv.due_date || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-destructive">${(inv.amount - inv.paid).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {selectedBills.size > 0 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-muted-foreground">{selectedBills.size} bill(s) selected</span>
                <span className="font-mono font-semibold text-card-foreground">Total: ${selectedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <Button onClick={() => payBillsMutation.mutate()} disabled={payBillsMutation.isPending || selectedBills.size === 0}>
              Pay Selected Bills ({selectedBills.size})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BulkApImportDialog open={bulkImportOpen} onOpenChange={setBulkImportOpen} />

      <DeleteConfirmDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)} />

      <Tabs defaultValue="invoices">
        <TabsList className="mb-6">
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
        </TabsList>

        <div className="relative mb-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <TabsContent value="invoices">
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Invoice #</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Vendor</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Job</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Due</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Amount</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Paid</th>
                  <th className="text-right px-6 py-3 font-medium text-muted-foreground">Balance</th>
                  <th className="text-center px-6 py-3 font-medium text-muted-foreground w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.filter(inv => {
                  if (!search) return true;
                  const s = search.toLowerCase();
                  return inv.invoice_no.toLowerCase().includes(s) ||
                    inv.vendors?.name?.toLowerCase().includes(s) ||
                    inv.jobs?.job_number?.toLowerCase().includes(s);
                }).length === 0 ? (
                  <tr><td colSpan={10} className="px-6 py-8 text-center text-muted-foreground">{search ? "No matching invoices." : "No invoices yet."}</td></tr>
                ) : invoices.filter(inv => {
                  if (!search) return true;
                  const s = search.toLowerCase();
                  return inv.invoice_no.toLowerCase().includes(s) ||
                    inv.vendors?.name?.toLowerCase().includes(s) ||
                    inv.jobs?.job_number?.toLowerCase().includes(s);
                }).map((inv) => (
                  <tr key={inv.id} className="table-row-hover border-b border-border/50">
                    <td className="px-6 py-3 font-mono text-xs text-card-foreground">{inv.invoice_no}</td>
                    <td className="px-6 py-3 font-medium text-card-foreground">{inv.vendors?.name}</td>
                    <td className="px-6 py-3 font-mono text-xs text-primary">{inv.jobs?.job_number || "—"}</td>
                    <td className="px-6 py-3 text-muted-foreground">{inv.date}</td>
                    <td className="px-6 py-3 text-muted-foreground">{inv.due_date || "—"}</td>
                    <td className="px-6 py-3">
                      <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium",
                        inv.status === "open" && "bg-warning/10 text-warning",
                        inv.status === "partial" && "bg-info/10 text-info",
                        inv.status === "paid" && "bg-success/10 text-success"
                      )}>{inv.status}</span>
                    </td>
                    <td className="px-6 py-3 text-right font-mono text-card-foreground">${(inv.amount || 0).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right font-mono text-success">${(inv.paid || 0).toLocaleString()}</td>
                    <td className="px-6 py-3 text-right font-mono font-medium text-card-foreground">${((inv.amount || 0) - (inv.paid || 0)).toLocaleString()}</td>
                    <td className="px-6 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditInvoice(inv)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ type: "invoice", id: inv.id })}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="vendors">
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Vendor</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Contact</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Phone</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Email</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Tax ID</th>
                  <th className="text-center px-6 py-3 font-medium text-muted-foreground">1099</th>
                  <th className="text-center px-6 py-3 font-medium text-muted-foreground w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.filter(v => {
                  if (!search) return true;
                  const s = search.toLowerCase();
                  return v.name.toLowerCase().includes(s) ||
                    v.contact.toLowerCase().includes(s) ||
                    v.email.toLowerCase().includes(s) ||
                    v.phone.toLowerCase().includes(s);
                }).length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">{search ? "No matching vendors." : "No vendors yet."}</td></tr>
                ) : vendors.filter(v => {
                  if (!search) return true;
                  const s = search.toLowerCase();
                  return v.name.toLowerCase().includes(s) ||
                    v.contact.toLowerCase().includes(s) ||
                    v.email.toLowerCase().includes(s) ||
                    v.phone.toLowerCase().includes(s);
                }).map((v) => (
                  <tr key={v.id} className="table-row-hover border-b border-border/50">
                    <td className="px-6 py-3 font-medium text-card-foreground">{v.name}</td>
                    <td className="px-6 py-3 text-muted-foreground">{v.contact}</td>
                    <td className="px-6 py-3 text-muted-foreground">{v.phone}</td>
                    <td className="px-6 py-3 text-muted-foreground">{v.email}</td>
                    <td className="px-6 py-3 font-mono text-xs text-muted-foreground">{v.tax_id || "—"}</td>
                    <td className="px-6 py-3 text-center">
                      {v.is_1099 && <span className="px-2 py-0.5 rounded-full text-xs bg-warning/10 text-warning font-medium">1099</span>}
                    </td>
                    <td className="px-6 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEditVendor(v)}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteTarget({ type: "vendor", id: v.id })}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
