"use client";
import { useEffect, useMemo, useState } from "react";
import { IconDeviceFloppy, IconPlus, IconRefresh, IconTrash } from "@tabler/icons-react";

type Model = { id:string; code:string; manufacturer:string; name:string; definitionVersion:string; capabilities:{ capabilityKeys?:string[]; metricKeys?:string[] } };
type Metric = { id:string; key:string; name:string; category:string; unit:string; dataType:string };
type NoticeTone = "success"|"info"|"warning";
async function req<T>(path:string, init?:RequestInit):Promise<T>{const r=await fetch(path,{...init,credentials:"include",headers:{"Content-Type":"application/json",...init?.headers}});if(!r.ok){const b=await r.json().catch(()=>null) as {error?:string}|null;throw new Error(b?.error||"No fue posible completar la solicitud.");}if(r.status===204)return undefined as T;return r.json() as Promise<T>;}

export function DeviceModelCatalog({canWrite,notify}:{canWrite:boolean;notify:(message:string,tone?:NoticeTone)=>void}) {
 const [data,setData]=useState<{models:Model[];metrics:Metric[]}|null>(null); const [loading,setLoading]=useState(true); const [editing,setEditing]=useState<string|null>(null);
 const blank={code:"",manufacturer:"",name:"",definitionVersion:"1.0",capabilityKeys:"",metricKeys:[] as string[]};
 const [form,setForm]=useState(blank);
 const load=async()=>{setLoading(true);try{setData(await req("/api/v1/engineering/device-models"));}catch(e){notify(e instanceof Error?e.message:"No fue posible cargar modelos.","warning");}finally{setLoading(false);}};
 useEffect(()=>{void load();},[]);
 const categories=useMemo(()=>{const m=new Map<string,Metric[]>();for(const metric of data?.metrics??[]){m.set(metric.category,[...(m.get(metric.category)??[]),metric]);}return [...m.entries()];},[data]);
 const edit=(model:Model)=>{setEditing(model.id);setForm({code:model.code,manufacturer:model.manufacturer,name:model.name,definitionVersion:model.definitionVersion,capabilityKeys:(model.capabilities.capabilityKeys??[]).join(", "),metricKeys:model.capabilities.metricKeys??[]});};
 const save=async(e:React.FormEvent)=>{e.preventDefault();try{const payload={...(editing?{id:editing}:{code:form.code}),manufacturer:form.manufacturer,name:form.name,definitionVersion:form.definitionVersion,capabilityKeys:form.capabilityKeys.split(",").map(x=>x.trim()).filter(Boolean),metricKeys:form.metricKeys};await req("/api/v1/engineering/device-models",{method:editing?"PATCH":"POST",body:JSON.stringify(payload)});notify(editing?"Modelo actualizado.":"Modelo registrado.");setEditing(null);setForm(blank);await load();}catch(e){notify(e instanceof Error?e.message:"No fue posible guardar el modelo.","warning");}};
 const remove=async()=>{if(!editing)return;try{await req("/api/v1/engineering/device-models",{method:"DELETE",body:JSON.stringify({id:editing})});notify("Modelo eliminado.");setEditing(null);setForm(blank);await load();}catch(e){notify(e instanceof Error?e.message:"No fue posible eliminar el modelo.","warning");}};
 return <section className="panel module-panel device-model-catalog">
  <div className="module-toolbar"><div><span className="eyebrow">Ingeniería · catálogo</span><h2>Modelos y plantillas de métricas</h2><p>Define qué métricas y capacidades se materializan al provisionar un dispositivo de cada modelo.</p></div><button className="secondary-button" onClick={()=>void load()} disabled={loading}><IconRefresh size={16}/> Actualizar</button></div>
  <div className="inventory-columns"><section><div className="inventory-heading"><div><span className="eyebrow">Modelos</span><h3>Catálogo disponible</h3></div><span>{data?.models.length??0}</span></div><div className="operational-card-list">{(data?.models??[]).map(m=><article key={m.id}><div><strong>{m.manufacturer} · {m.name}</strong><small>{m.code} · definición {m.definitionVersion}</small><em>{m.capabilities.metricKeys?.length??0} métricas · {(m.capabilities.capabilityKeys??[]).length} capacidades</em></div>{canWrite&&<button className="resource-edit-button" onClick={()=>edit(m)}>Editar</button>}</article>)}</div></section>
  {canWrite&&<form className="hierarchy-create-form" onSubmit={save}><div className="hierarchy-form-heading"><span className="eyebrow">{editing?"Editar":"Nuevo"} modelo</span><h3>{editing?form.code:"Registrar modelo"}</h3></div>
   {!editing&&<label><span>Código</span><input required value={form.code} onChange={e=>setForm({...form,code:e.target.value})} placeholder="PM5560"/></label>}
   <label><span>Fabricante</span><input required value={form.manufacturer} onChange={e=>setForm({...form,manufacturer:e.target.value})}/></label><label><span>Nombre</span><input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label><span>Versión de definición</span><input required value={form.definitionVersion} onChange={e=>setForm({...form,definitionVersion:e.target.value})}/></label>
   <label className="field-wide"><span>Capacidades</span><input value={form.capabilityKeys} onChange={e=>setForm({...form,capabilityKeys:e.target.value})} placeholder="electrical, ats, temperature"/></label>
   <div className="field-wide"><span className="eyebrow">Métricas de la plantilla</span>{categories.map(([category,metrics])=><div key={category}><strong>{category}</strong>{metrics.map(metric=><label key={metric.id} className="resource-active-toggle"><input type="checkbox" checked={form.metricKeys.includes(metric.key)} onChange={e=>setForm({...form,metricKeys:e.target.checked?[...form.metricKeys,metric.key]:form.metricKeys.filter(k=>k!==metric.key)})}/><span><strong>{metric.name}</strong><small>{metric.key}{metric.unit?` · ${metric.unit}`:""} · {metric.dataType}</small></span></label>)}</div>)}</div>
   <button className="primary-button" type="submit"><IconDeviceFloppy size={16}/> {editing?"Guardar modelo":"Registrar modelo"}</button>{editing&&<><button className="secondary-button" type="button" onClick={()=>{setEditing(null);setForm(blank);}}><IconPlus size={16}/> Nuevo</button><button className="danger-button" type="button" onClick={()=>void remove()}><IconTrash size={16}/> Eliminar</button></>}
  </form>}</div>
 </section>;
}
