import { readFileSync } from "node:fs";
import { indexSnapshot } from "@/lib/geo/location-repository";
import { resolveRecordLocation } from "@/lib/geo/geo-resolve-record";
import { classifyProperty } from "@/lib/geo/homonym-backfill";
const j=(f:string)=>JSON.parse(readFileSync(`/tmp/impact/${f}.json`,"utf8")||"[]");
const snap=indexSnapshot(6,j("locations"),j("aliases"),j("relations"),j("fzm"));
const S:Record<string,number>={freguesia:4,zona_funcional:3,concelho:2,distrito:1};
for(const p of j("properties") as any[]){
  const r=resolveRecordLocation({distrito:p.distrito,concelho:p.concelho,freguesia:p.freguesia,zona:p.zona},snap);
  if(classifyProperty(p.location_id??null,r,snap)!=="corrige")continue;
  const a=p.location_id?snap.byId.get(p.location_id):null, b=r.location_id?snap.byId.get(r.location_id):null;
  console.log(p.referencia, `${a?.nome}(${a?.tipo})`,"->",`${b?.nome}(${b?.tipo})`, (S[a?.tipo??""]??0)>(S[b?.tipo??""]??0)?"PERDE_NIVEL":"");
}
