// Private R2 objects; callers still use the existing authorized application routes.
// The immutable DO id is the scope. No client-controlled path or object URL is used.
const enc=new TextEncoder(),dec=new TextDecoder();
const fail=message=>{throw new Error(message);};
export const imageDigest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?enc.encode(value):value)),b=>b.toString(16).padStart(2,'0')).join('');
const bytesOf=value=>typeof value==='string'?enc.encode(value):new Uint8Array(value);
const from64=data=>Uint8Array.from(atob(data),c=>c.charCodeAt(0));
function to64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
function imageType(b){if(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71&&b[4]===13&&b[5]===10&&b[6]===26&&b[7]===10)return 'image/png';if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';if(dec.decode(b.subarray(0,4))==='RIFF'&&dec.decode(b.subarray(8,12))==='WEBP')return 'image/webp';return null;}
export function imageScope(ctx){const scope=ctx.id?.toString();if(!scope||!/^[a-zA-Z0-9_-]{1,128}$/.test(scope))fail('Missing immutable image scope');return 'images/v1/'+scope+'/';}
function objectKey(scope,hash){if(!/^[a-f0-9]{64}$/.test(hash))fail('Invalid image digest');return scope+hash;}
async function objectBytes(bucket,scope,ref){
 if(ref.key!==objectKey(scope,ref.hash))fail('Image scope mismatch');
 const object=await bucket.get(ref.key);if(!object)fail('Image temporarily unavailable');
 const bytes=new Uint8Array(await object.arrayBuffer());
 if(bytes.length!==ref.size||await imageDigest(bytes)!==ref.hash)fail('Image integrity check failed');return bytes;
}
export async function readStored(storage,env,ctx,key,meta){
 if(meta.imageVersion&&(!env.IMAGE_BUCKET||meta.imageVersion!==1))fail('Image storage unavailable');
 const scope=meta.imageVersion?imageScope(ctx):null;
 if(meta.image)return (await objectBytes(env.IMAGE_BUCKET,scope,meta.image)).buffer;
 const parts=await Promise.all(Array.from({length:meta.count},(_,i)=>storage.get('c:'+meta.rev+':'+i)));
 const bytes=new Uint8Array(meta.storedSize??meta.size);let offset=0;
 for(const p of parts){if(!p)fail('Stored value incomplete');bytes.set(p,offset);offset+=p.length;}
 if(offset!==bytes.length)fail('Stored value length mismatch');
 if(!meta.proofs?.length)return meta.binary?bytes.buffer:dec.decode(bytes);
 const json=JSON.parse(dec.decode(bytes)),cache=new Map();
 for(const p of meta.proofs){let at=json;for(const field of p.path)at=at[field];if(!at||typeof at!=='object')fail('Invalid proof pointer');if(!cache.has(p.ref.key))cache.set(p.ref.key,to64(await objectBytes(env.IMAGE_BUCKET,scope,p.ref)));at.data=cache.get(p.ref.key);}
 return JSON.stringify(json);
}
export async function prepareImages(storage,env,ctx,staged,{restore=false}={}){
 if(env.IMAGE_STORE_REQUIRED==='1'&&!env.IMAGE_BUCKET)fail('Image storage binding missing');
 const scope=env.IMAGE_BUCKET?imageScope(ctx):null,objects=new Map(),entries=new Map();
 async function image(bytes,type){
  if(!bytes.length||bytes.length>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(type)||imageType(bytes)!==type)fail('Invalid stored image');
  const hash=await imageDigest(bytes),key=objectKey(scope,hash),ref={key,hash,size:bytes.length,type};objects.set(key,{ref,bytes});return ref;
 }
 for(const [key,value] of staged){
  const original=bytesOf(value),binary=typeof value!=='string',meta={rev:crypto.randomUUID(),size:original.length,binary},proofs=[];let packed=original;
  if(scope&&!restore){
   if(binary&&/^e:[^/]+\/ab:/.test(key))meta.image=await image(original,imageType(original));
   else if(!binary&&/^e:[^/]+\/(?:o:|records$|audit:|proof:)/.test(key)){
    const json=JSON.parse(value);
    async function visit(node,path=[]){
     if(!node||typeof node!=='object')return;
     // Only validated proof-shaped values. Reference paths live in trusted DO metadata.
     if(typeof node.data==='string'&&typeof node.name==='string'&&['image/png','image/jpeg','image/webp'].includes(node.type)){
      const ref=await image(from64(node.data),node.type);proofs.push({path,ref});node.data=null;return;
     }
     for(const [field,child] of Object.entries(node))await visit(child,[...path,field]);
    }
    await visit(json);if(proofs.length){meta.proofs=proofs;packed=enc.encode(JSON.stringify(json));}
   }
   if(meta.image||proofs.length)meta.imageVersion=1;
  }
  meta.count=meta.image?0:Math.ceil(packed.length/60000);meta.storedSize=meta.image?0:packed.length;
  entries.set(key,{meta,bytes:packed});
 }
 // Intent precedes network writes. A restart can remove uploaded but uncommitted objects.
 const intent=objects.size?'img:pending:'+crypto.randomUUID():null;
 if(intent)await storage.put(intent,[...objects.values()].map(x=>x.ref));
 try{
  for(const {ref,bytes} of objects.values()){
   const existing=await env.IMAGE_BUCKET.head(ref.key);
   if(existing){if(existing.size!==bytes.length||existing.customMetadata?.sha256!==ref.hash)fail('Existing image integrity mismatch');continue;}
   const uploaded=await env.IMAGE_BUCKET.put(ref.key,bytes,{httpMetadata:{contentType:ref.type},customMetadata:{sha256:ref.hash}});
   if(!uploaded||uploaded.size!==ref.size)fail('Image upload incomplete');
   // Verify actual bytes before switching the DO pointer, including legacy migration.
   await objectBytes(env.IMAGE_BUCKET,scope,ref);
  }
 }catch(error){await cleanImages(storage,env,ctx).catch(()=>{});throw error;}
 return {entries,intent};
}
function references(meta){return [...new Map([...(meta?.image?[meta.image]:[]),...(meta?.proofs||[]).map(p=>p.ref)].map(ref=>[ref.key,ref])).values()];}
export async function commitImages(tx,prepared){
 for(const [key,{meta,bytes}] of prepared.entries){
  const prev=await tx.get('v:'+key),old=references(prev),next=references(meta),delta=new Map();
  for(const ref of old)delta.set(ref.key,{ref,n:-1});for(const ref of next)delta.set(ref.key,{ref,n:(delta.get(ref.key)?.n||0)+1});
  for(const {ref,n} of delta.values())if(n){const k='img:refs:'+ref.hash,count=(await tx.get(k)||0)+n;if(count<0)fail('Invalid image reference count');if(count){await tx.put(k,count);await tx.delete('img:gc:'+ref.hash);}else{await tx.delete(k);await tx.put('img:gc:'+ref.hash,ref);}}
  for(let i=0;i<meta.count;i++)await tx.put('c:'+meta.rev+':'+i,bytes.slice(i*60000,(i+1)*60000));
  await tx.put('v:'+key,meta);
  if(prev)for(let i=0;i<prev.count;i++)await tx.delete('c:'+prev.rev+':'+i);
 }
 if(prepared.intent)await tx.delete(prepared.intent);
}
export async function cleanImages(storage,env,ctx){
 if(!env.IMAGE_BUCKET)return;
 const scope=imageScope(ctx);
 // Bounded per request. Refcounts are committed with the business records.
 for(const [k,refs] of [...await storage.list({prefix:'img:pending:',limit:4})].slice(0,4)){
  for(const ref of refs){if(ref.key!==objectKey(scope,ref.hash))fail('Invalid cleanup scope');if(!await storage.get('img:refs:'+ref.hash))await env.IMAGE_BUCKET.delete(ref.key);}
  await storage.delete(k);
 }
 for(const [k,ref] of [...await storage.list({prefix:'img:gc:',limit:8})].slice(0,8)){
  if(ref.key!==objectKey(scope,ref.hash))fail('Invalid cleanup scope');if(!await storage.get('img:refs:'+ref.hash))await env.IMAGE_BUCKET.delete(ref.key);await storage.delete(k);
 }
}
const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function imageMaintenance(request,env,ctx,load){
 if(!env.IMAGE_BUCKET)return json({ok:false,error:'图片存储未配置'},503);
 let d;try{d=await request.json();}catch{return json({ok:false},400);}
 const storage=ctx.storage;
 if(d.action==='inventory'){
  const start=typeof d.cursor==='string'?d.cursor:'';
  const page=await storage.list({prefix:'v:e:',...(start?{startAfter:start}:{}),limit:32});
  return json({ok:true,keys:[...page].map(([k,m])=>({key:k.slice(2),r2:!!m.imageVersion,size:m.size})),cursor:page.size===32?[...page.keys()].at(-1):null});
 }
 if(d.action==='selftest'){
  const key=imageScope(ctx)+'selftest-'+crypto.randomUUID(),bytes=Uint8Array.of(137,80,78,71,13,10,26,10);
  try{await env.IMAGE_BUCKET.put(key,bytes);const o=await env.IMAGE_BUCKET.get(key);if(!o||await imageDigest(await o.arrayBuffer())!==await imageDigest(bytes))fail('R2 self-test failed');return json({ok:true,privateReadWriteVerified:true});}finally{await env.IMAGE_BUCKET.delete(key);}
 }
 // v1 private installs used global a:/ab: keys. Recover only the matching existing
 // order, with independently backed-up digests; never accept an arbitrary source key.
 if(d.action==='recover-legacy'){
  const match=typeof d.key==='string'&&d.key.match(/^e:([a-zA-Z0-9-]+)\/ab:([a-zA-Z0-9-]+)$/);
  if(!match||d.confirm!==true)return json({ok:false},400);
  const [,eventId,id]=match,order=JSON.parse(await load('e:'+eventId+'/o:'+id)||'null');
  if(!order||order.id!==id||!order.hasAttach||order.eventId&&order.eventId!==eventId)return json({ok:false},409);
  if(await load(d.key)!==null||await load('e:'+eventId+'/a:'+id)!==null)return json({ok:false,error:'目标已有附件，请人工核对'},409);
  const raw=await env.PAIDAN_KV.get('ab:'+id,{type:'arrayBuffer'}),metadata=await env.PAIDAN_KV.get('a:'+id);
  if(!raw||!metadata)return json({ok:false},404);
  if(await imageDigest(raw)!==d.backupDigest||await imageDigest(metadata)!==d.metadataDigest)return json({ok:false,error:'旧图备份校验不一致'},409);
  const info=JSON.parse(metadata);if(info.type!==imageType(new Uint8Array(raw))||info.size!==raw.byteLength)return json({ok:false,error:'旧图元信息不符'},409);
  const prepared=await prepareImages(storage,env,ctx,new Map([[d.key,raw],['e:'+eventId+'/a:'+id,metadata]]));
  await storage.transaction(tx=>commitImages(tx,prepared));await cleanImages(storage,env,ctx).catch(()=>{});
  const after=await readStored(storage,env,ctx,d.key,await storage.get('v:'+d.key));if(await imageDigest(after)!==d.backupDigest)fail('Recovered image readback mismatch');
  return json({ok:true,images:1,recovered:true,digest:d.backupDigest});
 }
 if(!['export','migrate','restore'].includes(d.action)||typeof d.key!=='string'||!/^e:[a-zA-Z0-9-]+\/(?:ab:|o:|records$|audit:|proof:)[a-zA-Z0-9-]*$/.test(d.key))return json({ok:false,error:'无效的图片维护请求'},400);
 const value=await load(d.key);if(value===null)return json({ok:false},404);const digest=await imageDigest(bytesOf(value));
 if(d.action==='export')return json({ok:true,digest,binary:typeof value!=='string',value:typeof value==='string'?value:to64(new Uint8Array(value))});
 if(d.confirm!==true||d.backupDigest!==digest)return json({ok:false,error:'备份校验不一致'},409);
 const meta=await storage.get('v:'+d.key);
 if(d.action==='migrate'&&meta?.imageVersion)return json({ok:true,alreadyMigrated:true,digest});
 const prepared=await prepareImages(storage,env,ctx,new Map([[d.key,value]]),{restore:d.action==='restore'});
 const next=prepared.entries.get(d.key).meta;
 if(d.action==='migrate'&&!next.imageVersion){await cleanImages(storage,env,ctx);return json({ok:true,images:0,digest});}
 await storage.transaction(tx=>commitImages(tx,prepared));await cleanImages(storage,env,ctx).catch(()=>{});
 const after=await readStored(storage,env,ctx,d.key,await storage.get('v:'+d.key));if(await imageDigest(bytesOf(after))!==digest)fail('Migration readback mismatch');
 return json({ok:true,images:references(next).length,digest,restored:d.action==='restore'});
}
