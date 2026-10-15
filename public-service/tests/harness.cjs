// Synthetic in-memory storage only. Never connects to a deployed service.
const fs=require('node:fs'),path=require('node:path');
class Storage{
 constructor(){this.map=new Map();this.alarm=null;}
 async get(k){return structuredClone(this.map.get(k));}
 async put(k,v){this.map.set(k,structuredClone(v));}
 async delete(k){this.map.delete(k);}
 async list({prefix=''}){return new Map([...this.map].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
 async getAlarm(){return this.alarm;}async setAlarm(t){this.alarm=t;}async deleteAlarm(){this.alarm=null;}
 async transaction(fn){const before=structuredClone(this.map),alarm=this.alarm;try{return await fn(this);}catch(e){this.map=before;this.alarm=alarm;throw e;}}
}
const cache=new Map();
function moduleURL(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);let source=fs.readFileSync(file,'utf8');if(file.endsWith('.html'))source='export default '+JSON.stringify(source)+';';else source=source.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_,q,target)=>'from '+JSON.stringify(moduleURL(path.resolve(path.dirname(file),target))));const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');cache.set(file,url);return url;}
async function setup(){
 const mod=await import(moduleURL(path.join(__dirname,'../worker.js'))),registryStorage=new Storage(),tenants=new Map();
 const env={INTERNAL_KEY:'synthetic-internal-only',OWNER_KEY:'synthetic-owner-only',PUBLIC_META:{async get(){return null;}}};
 const registry=new mod.Registry({storage:registryStorage},env);env.REGISTRY={idFromName:n=>n,get:()=>registry};
 env.TENANTS={idFromName:n=>n,get:id=>{if(!tenants.has(id))tenants.set(id,new mod.TenantStore({storage:new Storage()},env));return tenants.get(id);}};
 await registryStorage.put('policy',{revision:0,registrationOpen:true,maxActiveAccounts:3,maxAccounts:30,maxPending:10,globalRequestsPerDay:3000,quotaBudget:{events:60,orders:600,bytes:300*1048576,notifications:1800,requestsPerDay:3000}});
 const request=(p,{data,method=data===undefined?'GET':'POST',cookie='',ip='192.0.2.1',headers={},body}={})=>new Request('https://booking.test'+p,{method,headers:{Origin:'https://booking.test','CF-Connecting-IP':ip,'Content-Type':'application/json',Cookie:cookie,...headers},body:body??(data===undefined?undefined:JSON.stringify(data)),...(body instanceof ReadableStream?{duplex:'half'}:{})});
 const call=(p,options)=>mod.default.fetch(request(p,options),env);
 return {mod,env,registryStorage,tenants,request,call};
}
module.exports={setup};
