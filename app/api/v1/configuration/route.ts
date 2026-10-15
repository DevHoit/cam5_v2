import type { NextRequest } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { assets, auditLogs, deviceCapabilities, deviceMetrics, deviceModels, devices, gateways, metricDefinitions, sites, userAssetScopes } from "../../../../db/schema";
import { apiErrorResponse, ApiError, requestMetadata, requireApiSession } from "../_lib/auth";

export const dynamic = "force-dynamic";
function requiredText(value: unknown, label: string, minimum=2) { if(typeof value!=="string"||value.trim().length<minimum) throw new ApiError(400, `${label} es obligatorio.`); return value.trim(); }
function optionalText(value: unknown) { return typeof value==="string"&&value.trim()?value.trim():null; }
async function assertAssetAccess(db: Awaited<ReturnType<typeof requireApiSession>>["db"], user: Awaited<ReturnType<typeof requireApiSession>>["user"], assetId:string) {
 const [asset]=await db.select({id:assets.id,siteId:assets.siteId}).from(assets).where(and(eq(assets.id,assetId),eq(assets.siteId,user.siteId))).limit(1);
 if(!asset) throw new ApiError(404,"El activo no existe en el sitio activo.");
 const scopes=await db.select({assetId:userAssetScopes.assetId}).from(userAssetScopes).where(eq(userAssetScopes.userId,user.id));
 if(scopes.length&&!scopes.some(s=>s.assetId===assetId)) throw new ApiError(403,"No tienes acceso al activo indicado.");
 return asset;
}

export async function GET(request:NextRequest){
 try{
  const {db,user}=await requireApiSession(request,"settings.read"); const assetId=request.nextUrl.searchParams.get("assetId")||""; if(!assetId) throw new ApiError(400,"Selecciona un activo."); await assertAssetAccess(db,user,assetId);
  const [asset]=await db.select({id:assets.id,code:assets.code,name:assets.name,area:assets.area,state:assets.state,active:assets.active,siteId:sites.id,siteCode:sites.code,siteName:sites.name,siteTimezone:sites.timezone}).from(assets).innerJoin(sites,eq(sites.id,assets.siteId)).where(eq(assets.id,assetId)).limit(1);
  if(!asset) throw new ApiError(404,"El activo no existe.");
  const deviceRows=await db.select({id:devices.id,code:devices.code,name:devices.name,state:devices.state,serialNumber:devices.serialNumber,firmwareVersion:devices.firmwareVersion,lastReadAt:devices.lastReadAt,modelCode:deviceModels.code,modelName:deviceModels.name,gatewayId:gateways.id,gatewayCode:gateways.code,gatewayName:gateways.name,gatewayState:gateways.state,gatewayLastSeenAt:gateways.lastSeenAt}).from(devices).leftJoin(deviceModels,eq(deviceModels.id,devices.modelId)).leftJoin(gateways,eq(gateways.id,devices.gatewayId)).where(and(eq(devices.assetId,assetId),eq(devices.active,true))).orderBy(asc(devices.code));
  const deviceIds=deviceRows.map(d=>d.id);
  const metrics=deviceIds.length?await db.select({deviceId:deviceMetrics.deviceId,id:deviceMetrics.id,code:deviceMetrics.code,name:deviceMetrics.name,enabled:deviceMetrics.enabled,key:metricDefinitions.key,category:metricDefinitions.category,unit:metricDefinitions.unit,dataType:metricDefinitions.dataType}).from(deviceMetrics).innerJoin(metricDefinitions,eq(metricDefinitions.id,deviceMetrics.metricDefinitionId)).where(inArray(deviceMetrics.deviceId,deviceIds)).orderBy(deviceMetrics.deviceId,deviceMetrics.displayOrder):[];
  const capabilities=deviceIds.length?await db.select({deviceId:deviceCapabilities.deviceId,key:deviceCapabilities.capabilityKey,enabled:deviceCapabilities.enabled}).from(deviceCapabilities).where(inArray(deviceCapabilities.deviceId,deviceIds)):[];
  const siteGateways=await db.select({id:gateways.id,code:gateways.code,name:gateways.name,state:gateways.state,lastSeenAt:gateways.lastSeenAt}).from(gateways).where(and(eq(gateways.siteId,asset.siteId),eq(gateways.active,true))).orderBy(gateways.code);
  const warnings:string[]=[]; if(!deviceRows.length) warnings.push("El activo no tiene dispositivos asociados."); if(!siteGateways.length) warnings.push("El sitio no tiene gateways activos."); if(deviceRows.length&&!metrics.some(m=>m.enabled)) warnings.push("Los dispositivos del activo no tienen métricas habilitadas.");
  return Response.json({asset,devices:deviceRows.map(d=>({...d,lastReadAt:d.lastReadAt?.toISOString()??null,gatewayLastSeenAt:d.gatewayLastSeenAt?.toISOString()??null})),gateways:siteGateways.map(g=>({...g,lastSeenAt:g.lastSeenAt?.toISOString()??null})),metrics,capabilities,validation:{valid:warnings.length===0,warnings}}, {headers:{"Cache-Control":"no-store"}});
 }catch(error){return apiErrorResponse(error);}
}

export async function PATCH(request:NextRequest){
 try{
  const {db,user}=await requireApiSession(request,"settings.write"); const body=await request.json().catch(()=>null) as Record<string,unknown>|null; if(!body) throw new ApiError(400,"No se recibieron cambios.");
  const assetId=requiredText(body.assetId,"El activo"); await assertAssetAccess(db,user,assetId); const section=body.section;
  if(section!=="asset"&&section!=="device") throw new ApiError(400,"La configuración física del protocolo pertenece al Gateway Agent. Core sólo administra activo y asociación lógica del dispositivo.");
  const metadata=requestMetadata(request); let before:Record<string,unknown>={}; let after:Record<string,unknown>={};
  if(section==="asset"){
   const [current]=await db.select().from(assets).where(eq(assets.id,assetId)).limit(1); if(!current) throw new ApiError(404,"El activo no existe."); before=current;
   const [updated]=await db.update(assets).set({name:requiredText(body.name,"El nombre"),area:optionalText(body.area),updatedAt:new Date()}).where(eq(assets.id,assetId)).returning(); after=updated;
  } else {
   const deviceId=requiredText(body.deviceId,"El dispositivo"); const [current]=await db.select().from(devices).where(and(eq(devices.id,deviceId),eq(devices.assetId,assetId),eq(devices.active,true))).limit(1); if(!current) throw new ApiError(404,"El dispositivo no pertenece al activo."); before=current;
   const gatewayId=requiredText(body.gatewayId,"El gateway"); const [gateway]=await db.select({id:gateways.id}).from(gateways).innerJoin(assets,eq(assets.siteId,gateways.siteId)).where(and(eq(gateways.id,gatewayId),eq(assets.id,assetId),eq(gateways.active,true))).limit(1); if(!gateway) throw new ApiError(400,"El gateway no pertenece al sitio del activo.");
   const [updated]=await db.update(devices).set({name:requiredText(body.name,"El nombre del dispositivo"),gatewayId,updatedAt:new Date()}).where(eq(devices.id,deviceId)).returning(); after=updated;
  }
  await db.insert(auditLogs).values({siteId:user.siteId,actorUserId:user.id,action:`configuration.${String(section)}.update`,resourceType:section==="asset"?"asset":"device",resourceId:section==="asset"?assetId:String(body.deviceId),ipAddress:metadata.ipAddress,userAgent:metadata.userAgent,before,after});
  return Response.json({ok:true,item:after},{headers:{"Cache-Control":"no-store"}});
 }catch(error){return apiErrorResponse(error);}
}
