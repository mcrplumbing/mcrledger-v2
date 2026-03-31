import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface ClientSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  /** If true, show a + button to add a new client name inline */
  allowCreate?: boolean;
}

export default function ClientSelect({ value, onValueChange, placeholder = "Select client…", allowCreate = true }: ClientSelectProps) {
  const [open, setOpen] = useState(false);
  const [newClient, setNewClient] = useState("");

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("jobs").select("client").order("client");
      if (error) throw error;
      return data;
    },
  });

  // Deduplicate client names (case-insensitive, preserve original casing of first occurrence)
  const clients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const j of jobs) {
      const c = (j.client || "").trim();
      if (c && !seen.has(c.toLowerCase())) {
        seen.set(c.toLowerCase(), c);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [jobs]);

  const handleAddNew = () => {
    const trimmed = newClient.trim();
    if (trimmed) {
      onValueChange(trimmed);
      setNewClient("");
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          {value || <span className="text-muted-foreground">{placeholder}</span>}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Type client name…" />
          <CommandList>
            <CommandEmpty>
              {allowCreate ? (
                <div className="p-2">
                  <p className="text-xs text-muted-foreground mb-2">No matching client. Add a new one:</p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="New client name"
                      value={newClient}
                      onChange={(e) => setNewClient(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddNew(); }}
                      className="h-8 text-sm"
                    />
                    <Button size="sm" className="h-8" onClick={handleAddNew} disabled={!newClient.trim()}>
                      <Plus className="w-3 h-3 mr-1" />Add
                    </Button>
                  </div>
                </div>
              ) : (
                "No clients found."
              )}
            </CommandEmpty>
            <CommandGroup>
              {clients.map((c) => (
                <CommandItem
                  key={c}
                  value={c}
                  onSelect={() => { onValueChange(c); setOpen(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === c ? "opacity-100" : "opacity-0")} />
                  <span>{c}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
