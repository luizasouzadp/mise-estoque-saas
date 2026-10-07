import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/searchable-select";

// Supplier picker for purchases. purchases.supplier stores the supplier's name,
// so the value is the name; a name not in the registry is kept as an option.
export function SupplierSelect({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const { data: suppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });
  const current = value.trim();
  const unknown = current && !(suppliers ?? []).some((s) => s.name === current);

  return (
    <Select value={current || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Sem fornecedor</SelectItem>
        {unknown && <SelectItem value={current}>{current} (não cadastrado)</SelectItem>}
        {(suppliers ?? []).map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
