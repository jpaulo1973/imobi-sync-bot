import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProperties from "./tools/list-properties";
import listBuyerClients from "./tools/list-buyer-clients";
import listPortalListings from "./tools/list-portal-listings";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "imomatch-mcp",
  title: "Property Match",
  version: "0.1.0",
  instructions:
    "Tools to explore your Property Match data: imported properties, buyer leads, and portal listings. All tools are scoped to the signed-in user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProperties, listBuyerClients, listPortalListings],
});