import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PageHeader from "@/components/PageHeader";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const defaultForm = () => ({ name: "", type: "payable", principal: "", rate: "", payment: "", next_due: "" });

export default function Loans() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm());

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loans"],
    queryFn: async () => { const { data, error } = await supabase.from("loans").select("*").order("name"); if (error) throw error; return data; },
  });

  const openNew = () => { setEditingId(null); setForm(defaultForm()); setDialogOpen(true); };
  const openEdit = (loan: any) => {
    setEditingId(loan.id);
    setForm({ name: loan.name, type: loan.type, principal: String(loan.principal), rate: String(loan.rate), payment: String(loan.payment), next_due: loan.next_due || "" });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const principal = parseFloat(form.principal) || 0;
      const row = { name: form.name, type: form.type, principal, balance: editingId ? undefined : principal, rate: parseFloat(form.rate) || 0, payment: parseFloat(form.payment) || 0, next_due: form.next_due || null };
      if (editingId) {
        const { balance, ...updateRow } = row as any;
        const { error } = await supabase.from("loans").update(updateRow).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("loans").insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["loans"] }); setDialogOpen(false); toast.success(editingId ? "Loan updated" : "Loan added"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("loans").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["loans"] }); setDeleteId(null); toast.success("Loan deleted"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const renderTable = (type: "payable" | "receivable") => {
    const filtered = loans.filter((l) => l.type === type);
    return (
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-right px-6 py-3 font-medium text-muted-foreground">Principal</th>
              <th className="text-right px-6 py-3 font-medium text-muted-foreground">Balance</th>
              <th className="text-right px-6 py-3 font-medium text-muted-foreground">Rate</th>
              <th className="text-right px-6 py-3 font-medium text-muted-foreground">Payment</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Next Due</th>
              <th className="text-center px-6 py-3 font-medium text-muted-foreground w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No loans recorded</td></tr>
            ) : filtered.map((loan) => (
              <tr key={loan.id} className="table-row-hover border-b border-border/50">
                <td className="px-6 py-3 font-medium text-card-foreground">{loan.name}</td>
                <td className="px-6 py-3 text-right font-mono text-card-foreground">${(loan.principal || 0).toLocaleString()}</td>
                <td className={cn("px-6 py-3 text-right font-mono font-medium", type === "payable" ? "text-destructive" : "text-success")}>${(loan.balance || 0).toLocaleString()}</td>
                <td className="px-6 py-3 text-right font-mono text-muted-foreground">{loan.rate}%</td>
                <td className="px-6 py-3 text-right font-mono text-card-foreground">${(loan.payment || 0).toLocaleString()}</td>
                <td className="px-6 py-3 text-muted-foreground">{loan.next_due || "N/A"}</td>
                <td className="px-6 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(loan)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteId(loan.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="p-8">
      <PageHeader title="Loans" description="Track loans payable and receivable"
        actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />New Loan</Button>} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit Loan" : "Add Loan"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label>Loan Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="payable">Payable (we owe)</SelectItem>
                  <SelectItem value="receivable">Receivable (owed to us)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Principal</Label><Input type="number" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} /></div>
              <div><Label>Interest Rate %</Label><Input type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Monthly Payment</Label><Input type="number" value={form.payment} onChange={(e) => setForm({ ...form, payment: e.target.value })} /></div>
              <div><Label>Next Due</Label><Input type="date" value={form.next_due} onChange={(e) => setForm({ ...form, next_due: e.target.value })} /></div>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{editingId ? "Update Loan" : "Save Loan"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} title="Delete loan?" />

      <Tabs defaultValue="payable">
        <TabsList className="mb-6">
          <TabsTrigger value="payable">Loans Payable</TabsTrigger>
          <TabsTrigger value="receivable">Loans Receivable</TabsTrigger>
        </TabsList>
        <TabsContent value="payable">{renderTable("payable")}</TabsContent>
        <TabsContent value="receivable">{renderTable("receivable")}</TabsContent>
      </Tabs>
    </div>
  );
}
