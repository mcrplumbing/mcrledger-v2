import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { toast } from "sonner";

interface VendorSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}

export default function VendorSelect({ value, onValueChange, placeholder = "Select vendor" }: VendorSelectProps) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", contact: "", phone: "", email: "" });

  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vendors").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const createVendor = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("vendors").insert({
        name: form.name,
        contact: form.contact,
        phone: form.phone,
        email: form.email,
      }).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["vendors"] });
      onValueChange(data.id);
      setCreateOpen(false);
      setForm({ name: "", contact: "", phone: "", email: "" });
      toast.success("Vendor created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="flex gap-2 items-end">
      <div className="flex-1">
        <Select value={value} onValueChange={onValueChange}>
          <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
          <SelectContent>
            {vendors.map((v) => (
              <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="button" variant="outline" size="icon" onClick={() => setCreateOpen(true)} title="Create Vendor">
        <Plus className="w-4 h-4" />
      </Button>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Quick Create Vendor</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label>Vendor Name</Label><Input placeholder="Company name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Contact</Label><Input placeholder="Contact person" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Phone</Label><Input placeholder="555-0100" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input type="email" placeholder="vendor@co.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <Button onClick={() => createVendor.mutate()} disabled={createVendor.isPending || !form.name}>Create Vendor</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
