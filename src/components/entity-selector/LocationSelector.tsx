// LocationSelector — especialização geográfica do EntitySelector.
//
// É o ÚNICO componente autorizado a selecionar localizações em toda a
// aplicação. Consome exclusivamente as server functions do módulo
// `@/lib/geo`, que por sua vez passam obrigatoriamente pelo
// `LocationRepository`. Nenhum consumidor pode consultar tabelas
// geográficas diretamente nem implementar lógica de resolução própria.

import { useCallback, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";

import {
  EntitySelector,
  type EntityOption,
  type EntitySelectorProps,
} from "./EntitySelector";
import {
  getLocationsByIds,
  searchLocations,
} from "@/lib/geo/geo.functions";
import type { LocationType } from "@/lib/geo";

type Filter = LocationType | undefined;

function tipoLabel(tipo: LocationType): string {
  switch (tipo) {
    case "distrito":
      return "Distrito";
    case "concelho":
      return "Concelho";
    case "freguesia":
      return "Freguesia";
    case "zona_funcional":
      return "Zona funcional";
  }
}

export interface LocationSelectorProps
  extends Omit<EntitySelectorProps, "fetcher" | "resolveByIds"> {
  /** Restringe a pesquisa a um tipo específico. */
  tipo?: Filter;
}

export function LocationSelector({
  tipo,
  placeholder = "Pesquisar localização…",
  emptyText = "Sem localizações",
  ...rest
}: LocationSelectorProps) {
  const search = useServerFn(searchLocations);
  const byIds = useServerFn(getLocationsByIds);

  const fetcher = useCallback(
    async (query: string): Promise<EntityOption[]> => {
      const rows = await search({ data: { text: query, tipo, limit: 30 } });
      return rows.map((l) => ({
        id: l.id,
        label: l.nome,
        hint: tipoLabel(l.tipo),
      }));
    },
    [search, tipo],
  );

  const resolveByIds = useCallback(
    async (ids: string[]): Promise<EntityOption[]> => {
      if (ids.length === 0) return [];
      const rows = await byIds({ data: { ids } });
      return rows.map((l) => ({
        id: l.id,
        label: l.nome,
        hint: tipoLabel(l.tipo),
      }));
    },
    [byIds],
  );

  // Estabilizar identidade para evitar loops no efeito de reidratação.
  const stableFetcher = useMemo(() => fetcher, [fetcher]);
  const stableResolver = useMemo(() => resolveByIds, [resolveByIds]);

  return (
    <EntitySelector
      {...rest}
      placeholder={placeholder}
      emptyText={emptyText}
      fetcher={stableFetcher}
      resolveByIds={stableResolver}
    />
  );
}