import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ClientSelect from "@/components/ClientSelect";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, ChevronsUpDown, Check } from "lucide-react";
import { cn, parseMoney } from "@/lib/utils";
import { toast } from "sonner";

interface JobSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}

export default function JobSelect({ value, onValueChange, placeholder = "Search jobs…" }: JobSelectProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ job_number: "", name: "", client: "", budget: "" });

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("id, job_number, name").order("job_number");
      if (error) throw error;
      return data;
    },
  });

  const selectedLabel = useMemo(() => {
    const job = jobs.find((j) => j.id === value);
    return job ? `${job.job_number} - ${job.name}` : "";
  }, [value, jobs]);

  const createJob = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from("jobs").insert({
        job_number: form.job_number,
        name: form.name,
        client: form.client,
        budget: parseMoney(form.budget),
      }).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      onValueChange(data.id);
      setCreateOpen(false);
      setForm({ job_number: "", name: "", client: "", budget: "" });
      toast.success("Job created");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="flex gap-2 items-end">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={open} className="flex-1 justify-between font-normal">
            {selectedLabel || <span className="text-muted-foreground">{placeholder}</span>}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Type job # or name…" />
            <CommandList>
              <CommandEmpty>No jobs found.</CommandEmpty>
              <CommandGroup>
                {jobs.map((j) => (
                  <CommandItem
                    key={j.id}
                    value={`${j.job_number} ${j.name}`}
                    onSelect={() => { onValueChange(j.id); setOpen(false); }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === j.id ? "opacity-100" : "opacity-0")} />
                    <span className="font-mono text-xs mr-2">{j.job_number}</span>
                    <span className="truncate">{j.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button type="button" variant="outline" size="icon" onClick={() => setCreateOpen(true)} title="Create Job">
        <Plus className="w-4 h-4" />
      </Button>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Quick Create Job</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Job #</Label><Input placeholder="J-001" value={form.job_number} onChange={(e) => setForm({ ...form, job_number: e.target.value })} /></div>
              <div><Label>Budget</Label><Input type="number" placeholder="0.00" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></div>
            </div>
            <div><Label>Job Name</Label><Input placeholder="Project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Client</Label><ClientSelect value={form.client} onValueChange={(v) => setForm({ ...form, client: v })} /></div>
            <Button onClick={() => createJob.mutate()} disabled={createJob.isPending || !form.job_number || !form.name}>Create Job</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
