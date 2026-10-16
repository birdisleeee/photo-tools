// Synthetic in-memory fixtures only. No remote service, author data, or live credentials.
const fs=require('node:fs'),path=require('node:path');
class Storage{
 constructor(){this.map=new Map();this.alarm=null;this.fail=false;}
 async get(key){return structuredClone(this.map.get(key));}
 async put(key,value){this.map.set(key,structuredClone(value));}
 async delete(key){this.map.delete(key);}
 async list({prefix=''}){return new Map([...this.map].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]));}
 async getAlarm(){return this.alarm;}async setAlarm(t){this.alarm=t;}async deleteAlarm(){this.alarm=null;}
 async transaction(fn){const before=structuredClone(this.map),alarm=this.alarm;try{const result=await fn(this);if(this.fail)throw Error('synthetic transaction failure');return result;}catch(error){this.map=before;this.alarm=alarm;throw error;}}
}
const cache=new Map();
function moduleURL(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);let source=fs.readFileSync(file,'utf8');if(file.endsWith('.html'))source='export default '+JSON.stringify(source)+';';else source=source.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_,quote,target)=>'from '+JSON.stringify(moduleURL(path.resolve(path.dirname(file),target))));const url='data:text/javascript;base64,'+Buffer.from(source).toString('base64');cache.set(file,url);return url;}
async function setup({empty=false,sourceRoot=path.join(__dirname,'..')}={}){
 const mod=await import(moduleURL(path.join(sourceRoot,'worker.js'))),storage=new Storage(),kv=new Map(),reads=[];
 const event={id:'fixture-event',name:'Synthetic Event',year:2027,status:'active',dates:['10月2日'],shootDates:{'10月2日':'2027-10-02'},slots:['12:30-13:00','13:00-13:30','13:30-14:00'],price:35,publicConfig:{subtitle:'Synthetic test only',photographer:'Test Photographer',phone:'13800138000'}};
 const old={id:'abcdef12abcd',eventId:event.id,date:'10月2日',timeSlot:'13:30-14:00',cn:'Synthetic legacy client',phone:'13800138000',character:'Test character',paid:false,createdAt:'2026-10-01T00:00:00Z'};
 if(!empty){for(const [key,value] of [['events',[event]],['e:'+event.id+'/orders',[old.id]],['e:'+event.id+'/o:'+old.id,old],['e:'+event.id+'/booked',{'10月2日':['13:30-14:00']}]])kv.set(key,JSON.stringify(value));}
 const env={ADMIN_KEY:'synthetic-admin-only',CUSTOMER_SECRET:'synthetic-customer-pepper-only',PAIDAN_KV:{async get(key,options){reads.push(key);const value=kv.get(key);return value===undefined?null:options?.type==='arrayBuffer'?(typeof value==='string'?new TextEncoder().encode(value).buffer:value):value;}}};
 for(const name of ['PRIVATE_EDGE_RATE','PRIVATE_AUTH_RATE','PRIVATE_QUERY_RATE','PRIVATE_WRITE_RATE','PRIVATE_UPLOAD_RATE','PRIVATE_CUSTOMER_AUTH_RATE'])env[name]={limit:async()=>({success:true})};
 const coordinator=new mod.BookingStore({storage},env);env.BOOKING_STORE={idFromName:name=>name,get:()=>coordinator};
 const raw=async(url,body,headers={})=>{if(body instanceof FormData){const wire=new Response(body);headers={'Content-Type':wire.headers.get('Content-Type'),...headers};body=await wire.arrayBuffer();}const binary=body instanceof ArrayBuffer;return mod.default.fetch(new Request('http://127.0.0.1:8151'+url,{method:body===undefined?'GET':'POST',headers:{'CF-Connecting-IP':'192.0.2.1',...(!binary?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:binary?body:JSON.stringify(body)}),env);};
 return {mod,env,event,old,kv,reads,storage,raw,coordinator};
}
module.exports={setup};
