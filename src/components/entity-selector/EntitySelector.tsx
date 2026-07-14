// EntitySelector — combobox assíncrono, genérico e minimalista.
//
// Não sabe nada sobre geografia. Recebe:
//  - value: IDs selecionados
//  - onChange: callback com novos IDs
//  - fetcher: função async(query) => Entity[]  (chamada obrigatoriamente
//    através de uma server function do domínio; este componente nunca
//    consulta o Supabase diretamente)
//  - resolveByIds: função async(ids) => Entity[] para reidratar os labels
//    dos IDs já selecionados quando o componente monta.
//
// Especializações (ex: LocationSelector) devem passar apenas o fetcher e o
// resolver adequados; nenhuma lógica de domínio pode viver aqui.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface EntityOption {
  id: string;
  label: string;
  hint?: string | null;
}

export interface EntitySelectorProps {
  value: string[];
  onChange: (ids: string[]) => void;
  fetcher: (query: string) => Promise<EntityOption[]>;
  resolveByIds?: (ids: string[]) => Promise<EntityOption[]>;
  placeholder?: string;
  emptyText?: string;
  multiple?: boolean;
  disabled?: boolean;
  className?: string;
  minChars?: number;
  ariaLabel?: string;
}

export function EntitySelector({
  value,
  onChange,
  fetcher,
  resolveByIds,
  placeholder = "Pesquisar…",
  emptyText = "Sem resultados",
  multiple = true,
  disabled,
  className,
  minChars = 1,
  ariaLabel,
}: EntitySelectorProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLabels, setSelectedLabels] = useState<Record<string, EntityOption>>({});
  const seqRef = useRef(0);

  // Reidratar labels para IDs já selecionados.
  useEffect(() => {
    let cancelled = false;
    const missing = value.filter((id) => !selectedLabels[id]);
    if (missing.length === 0 || !resolveByIds) return;
    resolveByIds(missing)
      .then((entities) => {
        if (cancelled) return;
        setSelectedLabels((prev) => {
          const next = { ...prev };
          for (const e of entities) next[e.id] = e;
          return next;
        });
      })
      .catch(() => {
        /* ignore reidratação parcial */
      });
    return () => {
      cancelled = true;
    };
  }, [value, resolveByIds, selectedLabels]);

  // Debounced fetch
  useEffect(() => {
    if (!open) return;
    if (query.trim().length < minChars) {
      setResults([]);
      return;
    }
    const mySeq = ++seqRef.current;
    setLoading(true);
    const t = setTimeout(() => {
      fetcher(query.trim())
        .then((r) => {
          if (mySeq !== seqRef.current) return;
          setResults(r);
        })
        .catch(() => {
          if (mySeq !== seqRef.current) return;
          setResults([]);
        })
        .finally(() => {
          if (mySeq !== seqRef.current) return;
          setLoading(false);
        });
    }, 180);
    return () => clearTimeout(t);
  }, [query, open, fetcher, minChars]);

  const toggle = useCallback(
    (opt: EntityOption) => {
      const already = value.includes(opt.id);
      if (multiple) {
        onChange(already ? value.filter((v) => v !== opt.id) : [...value, opt.id]);
      } else {
        onChange(already ? [] : [opt.id]);
        setOpen(false);
      }
      setSelectedLabels((prev) => ({ ...prev, [opt.id]: opt }));
    },
    [value, onChange, multiple],
  );

  const remove = useCallback(
    (id: string) => {
      onChange(value.filter((v) => v !== id));
    },
    [value, onChange],
  );

  const chips = useMemo(
    () =>
      value.map((id) => selectedLabels[id] ?? { id, label: id.slice(0, 8) + "…" }),
    [value, selectedLabels],
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label={ariaLabel ?? placeholder}
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className="truncate text-muted-foreground">
              {value.length === 0
                ? placeholder
                : multiple
                  ? `${value.length} selecionado${value.length === 1 ? "" : "s"}`
                  : chips[0]?.label}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={placeholder}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              {loading && (
                <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> A pesquisar…
                </div>
              )}
              {!loading && results.length === 0 && (
                <CommandEmpty>{emptyText}</CommandEmpty>
              )}
              {!loading && results.length > 0 && (
                <CommandGroup>
                  {results.map((r) => {
                    const selected = value.includes(r.id);
                    return (
                      <CommandItem
                        key={r.id}
                        value={r.id}
                        onSelect={() => toggle(r)}
                        className="flex items-center gap-2"
                      >
                        <Check
                          className={cn(
                            "h-4 w-4",
                            selected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{r.label}</span>
                          {r.hint && (
                            <span className="text-xs text-muted-foreground">{r.hint}</span>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <Badge key={c.id} variant="secondary" className="gap-1 pr-1">
              <span className="max-w-[16rem] truncate">{c.label}</span>
              <button
                type="button"
                aria-label={`Remover ${c.label}`}
                onClick={() => remove(c.id)}
                className="rounded-sm p-0.5 hover:bg-muted"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}