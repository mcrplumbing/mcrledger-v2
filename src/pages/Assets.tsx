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
import { Plus, Pencil, Trash2 } from "lucide-react";
import { cn, parseMoney, sumMoney } from "@/lib/utils";
import { toast } from "sonner";

const defaultForm = () => ({ name: "", category: "", purchase_date: "", cost: "", depreciation_method: "Straight-line", assigned_to: "" });

export default function Assets() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm());

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ["assets"],
    queryFn: async () => { const { data, error } = await supabase.from("assets").select("*").order("name"); if (error) throw error; return data; },
  });

  const openNew = () => { setEditingId(null); setForm(defaultForm()); setDialogOpen(true); };
  const openEdit = (a: any) => {
    setEditingId(a.id);
    setForm({ name: a.name, category: a.category, purchase_date: a.purchase_date || "", cost: String(a.cost), depreciation_method: a.depreciation_method, assigned_to: a.assigned_to });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cost = parseMoney(form.cost);
      const row = { name: form.name, category: form.category, purchase_date: form.purchase_date || null, cost, depreciation_method: form.depreciation_method, assigned_to: form.assigned_to };
      if (editingId) {
        const { error } = await supabase.from("assets").update(row).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("assets").insert({ ...row, current_value: cost });
        if (error) throw error;
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["assets"] }); setDialogOpen(false); toast.success(editingId ? "Asset updated" : "Asset added"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("assets").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["assets"] }); setDeleteId(null); toast.success("Asset deleted"); },
    onError: (err: Error) => toast.error(err.message),
  });

  const totalCost = sumMoney(assets.map((a) => a.cost || 0));
  const totalValue = sumMoney(assets.map((a) => a.current_value || 0));

  return (
    <div className="p-8">
      <PageHeader title="Asset Tracking" description="Track company assets, depreciation, and assignments"
        actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-2" />Add Asset</Button>} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit Asset" : "Add Asset"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label>Asset Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Heavy Equipment">Heavy Equipment</SelectItem>
                  <SelectItem value="Vehicles">Vehicles</SelectItem>
                  <SelectItem value="Tools">Tools</SelectItem>
                  <SelectItem value="Equipment">Equipment</SelectItem>
                  <SelectItem value="Office Equipment">Office Equipment</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Purchase Date</Label><Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></div>
              <div><Label>Cost</Label><Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></div>
            </div>
            <div><Label>Assigned To</Label><Input placeholder="Job or department" value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} /></div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>{editingId ? "Update Asset" : "Save Asset"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)} title="Delete asset?" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="stat-card">
          <p className="text-sm font-medium text-muted-foreground">Total Asset Cost</p>
          <p className="text-2xl font-display font-bold mt-1 text-card-foreground">${totalCost.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <p className="text-sm font-medium text-muted-foreground">Current Book Value</p>
          <p className="text-2xl font-display font-bold mt-1 text-card-foreground">${totalValue.toLocaleString()}</p>
          <p className="text-xs font-medium mt-2 text-destructive">${(totalCost - totalValue).toLocaleString()} total depreciation</p>
        </div>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Asset</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Category</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Purchased</th>
              <th className="text-right px-6 py-3 font-medium text-muted-foreground">Cost</th>
              <th className="text-right px-6 py-3 font-medium text-muted-foreground">Book Value</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Depreciation</th>
              <th className="text-left px-6 py-3 font-medium text-muted-foreground">Assigned To</th>
              <th className="text-center px-6 py-3 font-medium text-muted-foreground w-20">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : assets.length === 0 ? (
              <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">No assets yet.</td></tr>
            ) : assets.map((asset) => (
              <tr key={asset.id} className="table-row-hover border-b border-border/50">
                <td className="px-6 py-3 font-medium text-card-foreground">{asset.name}</td>
                <td className="px-6 py-3"><span className="px-2 py-0.5 rounded-full text-xs bg-secondary text-secondary-foreground">{asset.category}</span></td>
                <td className="px-6 py-3 text-muted-foreground">{asset.purchase_date || "—"}</td>
                <td className="px-6 py-3 text-right font-mono text-card-foreground">${(asset.cost || 0).toLocaleString()}</td>
                <td className={cn("px-6 py-3 text-right font-mono font-medium", (asset.current_value || 0) < (asset.cost || 0) * 0.5 ? "text-warning" : "text-card-foreground")}>${(asset.current_value || 0).toLocaleString()}</td>
                <td className="px-6 py-3 text-muted-foreground">{asset.depreciation_method}</td>
                <td className="px-6 py-3 text-muted-foreground">{asset.assigned_to}</td>
                <td className="px-6 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(asset)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteId(asset.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
