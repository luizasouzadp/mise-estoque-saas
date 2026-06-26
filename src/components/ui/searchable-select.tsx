"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

// Drop-in replacement for shadcn Select with built-in fuzzy search.
// Same API surface used in the app: Select, SelectTrigger, SelectValue, SelectContent, SelectItem.

type Ctx = {
  value: string | undefined;
  setValue: (v: string) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
  registerItem: (value: string, label: React.ReactNode) => void;
  unregisterItem: (value: string) => void;
  labels: Map<string, React.ReactNode>;
  disabled?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
};

const SelectCtx = React.createContext<Ctx | null>(null);
const useSelectCtx = () => {
  const ctx = React.useContext(SelectCtx);
  if (!ctx) throw new Error("Select components must be used inside <Select>");
  return ctx;
};

export interface SelectProps<T extends string = string> {
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export function Select<T extends string = string>({

  value,
  defaultValue,
  onValueChange,
  open: openProp,
  onOpenChange,
  disabled,
  children,
  searchPlaceholder,
  emptyMessage,
}: SelectProps<T>) {
  const [internalValue, setInternalValue] = React.useState<T | undefined>(defaultValue);
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : internalValue;
  const open = openProp ?? internalOpen;

  const setValue = (v: string) => {
    if (!isControlled) setInternalValue(v as T);
    onValueChange?.(v as T);
  };

  const setOpen = (o: boolean) => {
    if (openProp === undefined) setInternalOpen(o);
    onOpenChange?.(o);
  };

  const [labels, setLabels] = React.useState<Map<string, React.ReactNode>>(new Map());
  const registerItem = React.useCallback((v: string, label: React.ReactNode) => {
    setLabels((prev) => {
      if (prev.get(v) === label) return prev;
      const next = new Map(prev);
      next.set(v, label);
      return next;
    });
  }, []);
  const unregisterItem = React.useCallback((v: string) => {
    setLabels((prev) => {
      if (!prev.has(v)) return prev;
      const next = new Map(prev);
      next.delete(v);
      return next;
    });
  }, []);

  return (
    <SelectCtx.Provider
      value={{
        value: currentValue,
        setValue,
        open,
        setOpen,
        registerItem,
        unregisterItem,
        labels,
        disabled,
        searchPlaceholder,
        emptyMessage,
      }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        {children}
      </Popover>
    </SelectCtx.Provider>
  );
};

export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const ctx = useSelectCtx();
    return (
      <PopoverTrigger asChild>
        <button
          ref={ref}
          type="button"
          role="combobox"
          aria-expanded={ctx.open}
          disabled={ctx.disabled}
          className={cn(
            "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background cursor-pointer text-left data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
            className,
          )}
          {...props}
        >
          {children}
          <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
    );
  },
);
SelectTrigger.displayName = "SelectTrigger";

export interface SelectValueProps {
  placeholder?: React.ReactNode;
  className?: string;
}

export const SelectValue: React.FC<SelectValueProps> = ({ placeholder, className }) => {
  const ctx = useSelectCtx();
  const label = ctx.value !== undefined ? ctx.labels.get(ctx.value) : undefined;
  const hasValue = label !== undefined && label !== null && label !== "";
  return (
    <span className={cn("flex-1 truncate", !hasValue && "text-muted-foreground", className)}>
      {hasValue ? label : placeholder}
    </span>
  );
};

export interface SelectContentProps {
  className?: string;
  children?: React.ReactNode;
  align?: "start" | "center" | "end";
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export const SelectContent: React.FC<SelectContentProps> = ({
  className,
  children,
  align = "start",
  searchPlaceholder,
  emptyMessage,
}) => {
  const ctx = useSelectCtx();
  const placeholder = searchPlaceholder ?? ctx.searchPlaceholder ?? "Buscar...";
  const empty = emptyMessage ?? ctx.emptyMessage ?? "Nenhum resultado.";
  return (
    <PopoverContent
      align={align}
      className={cn("p-0 w-[var(--radix-popover-trigger-width)] min-w-[12rem]", className)}
    >
      <Command
        filter={(value, search) => {
          if (!search) return 1;
          return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
        }}
      >
        <CommandInput placeholder={placeholder} className="h-9" />
        <CommandList className="max-h-72">
          <CommandEmpty>{empty}</CommandEmpty>
          <CommandGroup>{children}</CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  );
};

export interface SelectItemProps {
  value: string;
  children?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  /** Optional plain-text used for fuzzy matching; defaults to stringified children. */
  keywords?: string;
}

function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (React.isValidElement(node)) return nodeText((node.props as { children?: React.ReactNode }).children);
  return "";
}

export const SelectItem: React.FC<SelectItemProps> = ({ value, children, disabled, className, keywords }) => {
  const ctx = useSelectCtx();
  const label = children;
  const searchText = keywords ?? nodeText(children);

  const { registerItem, unregisterItem } = ctx;
  React.useEffect(() => {
    registerItem(value, label);
    return () => unregisterItem(value);
  }, [value, label, registerItem, unregisterItem]);


  const selected = ctx.value === value;

  return (
    <CommandItem
      value={`${searchText} ${value}`}
      disabled={disabled}
      onSelect={() => {
        ctx.setValue(value);
        ctx.setOpen(false);
      }}
      className={cn("cursor-pointer", className)}
    >
      <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
      <span className="flex-1 truncate">{label}</span>
    </CommandItem>
  );
};

// Stubs to keep API parity (no-ops in this implementation)
export const SelectGroup: React.FC<{ children?: React.ReactNode }> = ({ children }) => <>{children}</>;
export const SelectLabel: React.FC<{ className?: string; children?: React.ReactNode }> = ({ className, children }) => (
  <div className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)}>{children}</div>
);
export const SelectSeparator: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("-mx-1 my-1 h-px bg-muted", className)} />
);
export const SelectScrollUpButton: React.FC = () => null;
export const SelectScrollDownButton: React.FC = () => null;
