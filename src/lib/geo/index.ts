// Ponto único de entrada da infraestrutura geográfica.
// Todos os consumidores devem importar a partir daqui.

export * from "./geo-types";
export { normalizeGeoText, splitConnectors, toSlug } from "./geo-context";
export { LocationRepository } from "./location-repository";
export { parseLocations } from "./geo-parser";