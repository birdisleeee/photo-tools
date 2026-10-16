// Synthetic R2/DO only. No credentials or production requests.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Store=require('./image-storage-store.cjs'),root=path.resolve(__dirname,'..');
const cache=new Map();function moduleURL(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);let s=fs.readFileSync(file,'utf8');s=file.endsWith('.html')?'export default '+JSON.stringify(s):s.replace(/from\s+(['"])(\.[^'"]+)\1/g,(_,q,t)=>'from '+JSON.stringify(moduleURL(path.resolve(path.dirname(file),t))));const u='data:text/javascript;base64,'+Buffer.from(s).toString('base64');cache.set(file,u);return u;}
class Bucket{
 constructor(){this.map=new Map();this.puts=0;this.fail=false;this.corrupt=false;}
 async head(k){const o=this.map.get(k);return o?{size:o.bytes.length,customMetadata:o.meta}:null;}
 async put(k,b,opt={}){this.puts++;if(this.fail)throw Error('synthetic R2 unavailable');const bytes=new Uint8Array(b).slice();if(this.corrupt)bytes[0]^=1;this.map.set(k,{bytes,meta:opt.customMetadata});return {size:bytes.length};}
 async get(k){const o=this.map.get(k);return o?{arrayBuffer:async()=>o.bytes.slice().buffer}:null;}
 async delete(k){this.map.delete(k);}
}
const png=Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
async function main(){
 const images=await import(moduleURL(root+'/paidan-booking/image-storage.js')),storage=new Store(),bucket=new Bucket(),ctx={storage,id:{toString:()=> 'tenant-a'}},env={IMAGE_BUCKET:bucket,IMAGE_STORE_REQUIRED:'1'};
 const proof={name:'test.png',type:'image/png',data:Buffer.from(png).toString('base64')},order=JSON.stringify({id:'abc',payment:{proof}}),staged=new Map([['e:test/ab:abc',png.buffer],['e:test/o:abc',order],['e:test/audit:one',JSON.stringify({before:JSON.parse(order)})]]);
 let prepared=await images.prepareImages(storage,env,ctx,staged);await storage.transaction(tx=>images.commitImages(tx,prepared));assert.equal(bucket.map.size,1);assert.equal([...storage.map.values()].filter(v=>v?.imageVersion).length,3);
 for(const [k,v] of staged){const out=await images.readStored(storage,env,ctx,k,await storage.get('v:'+k));assert.deepEqual(out,v);}
 assert(!JSON.stringify([...storage.map]).includes(proof.data));assert.equal(await storage.get('img:refs:'+await images.imageDigest(png)),3);
 await assert.rejects(()=>images.readStored(storage,env,{...ctx,id:{toString:()=> 'tenant-b'}},'e:test/ab:abc',storage.map.get('v:e:test/ab:abc')),/scope/);
 // A failed DO commit must retain the previously committed image and release new uploads.
 const next=png.slice();next[next.length-1]^=1;storage.fail=true;prepared=await images.prepareImages(storage,env,ctx,new Map([['e:test/ab:abc',next.buffer]]));await assert.rejects(()=>storage.transaction(tx=>images.commitImages(tx,prepared)));storage.fail=false;await images.cleanImages(storage,env,ctx);assert.equal(bucket.map.size,1);assert.deepEqual(await images.readStored(storage,env,ctx,'e:test/ab:abc',await storage.get('v:e:test/ab:abc')),png.buffer);
 // R2 errors/corruption never publish a pointer. Durable intents survive until safe cleanup.
 bucket.corrupt=true;await assert.rejects(()=>images.prepareImages(storage,env,ctx,new Map([['e:test/ab:other',next.buffer]])),/integrity/);bucket.corrupt=false;assert.equal(bucket.map.size,1);
 bucket.fail=true;await assert.rejects(()=>images.prepareImages(storage,env,ctx,new Map([['e:test/ab:other',next.buffer]])));bucket.fail=false;
 assert(!await storage.get('v:e:test/ab:other'));
 await assert.rejects(()=>images.prepareImages(storage,{IMAGE_STORE_REQUIRED:'1'},ctx,staged),/binding/);
 // References shared by an order and its audit cannot be collected by a replacement.
 prepared=await images.prepareImages(storage,env,ctx,new Map([['e:test/o:abc',JSON.stringify({id:'abc',payment:{proof:null}})]]));await storage.transaction(tx=>images.commitImages(tx,prepared));await images.cleanImages(storage,env,ctx);assert.equal(bucket.map.size,1);
 // Reversing migration materializes the exact image in DO before a legacy-code rollback.
 const req=data=>new Request('https://test/maintenance',{method:'POST',body:JSON.stringify(data)}),load=k=>images.readStored(storage,env,ctx,k,storage.map.get('v:'+k));
 let r=await images.imageMaintenance(req({action:'restore',key:'e:test/ab:abc',confirm:true,backupDigest:await images.imageDigest(png)}),env,ctx,load);assert.equal(r.status,200);assert(!storage.map.get('v:e:test/ab:abc').imageVersion);assert.deepEqual(await load('e:test/ab:abc'),png.buffer);
 const d=await (await images.imageMaintenance(req({action:'export',key:'e:test/ab:abc'}),env,ctx,load)).json();r=await images.imageMaintenance(req({action:'migrate',key:'e:test/ab:abc',confirm:true,backupDigest:d.digest}),env,ctx,load);assert.equal(r.status,200);assert(storage.map.get('v:e:test/ab:abc').imageVersion);
 assert.equal((await images.imageMaintenance(req({action:'migrate',key:'e:test/ab:abc',confirm:true,backupDigest:'wrong'}),env,ctx,load)).status,409);
 // Business-handler integration: existing protected attachment and payment APIs are unchanged.
 const mod=await import(moduleURL(root+'/paidan-booking/worker.js')),s=new Store(),kv=new Map(),e={id:'test',name:'Synthetic',status:'active',dates:['10月2日'],slots:['12:30-13:00'],price:35},o={id:'abcdef123456',eventId:'test',cn:'Synthetic',phone:'13800138000',date:e.dates[0],timeSlot:e.slots[0],character:'Test'};
 for(const [k,v] of [['events',[e]],['e:test/orders',[o.id]],['e:test/o:'+o.id,o],['e:test/config',{price:35}]])kv.set(k,JSON.stringify(v));
 const b=new Bucket(),testEnv={ADMIN_KEY:'synthetic-key',CUSTOMER_SECRET:'synthetic-pepper',IMAGE_BUCKET:b,IMAGE_STORE_REQUIRED:'1',PAIDAN_KV:{get:async(k,opt)=>kv.has(k)?opt?.type==='arrayBuffer'?new TextEncoder().encode(kv.get(k)).buffer:kv.get(k):null}};
 for(const n of ['PRIVATE_EDGE_RATE','PRIVATE_AUTH_RATE','PRIVATE_QUERY_RATE','PRIVATE_WRITE_RATE','PRIVATE_UPLOAD_RATE','PRIVATE_CUSTOMER_AUTH_RATE'])testEnv[n]={limit:async()=>({success:true})};
 const coordinator=new mod.BookingStore({storage:s,id:{toString:()=> 'private-test'}},testEnv);testEnv.BOOKING_STORE={idFromName:n=>n,get:()=>coordinator};
 const call=(url,data,auth=true)=>{const f=data instanceof FormData;return mod.default.fetch(new Request('https://test'+url,{method:data===undefined?'GET':'POST',headers:{...(auth?{'X-Admin-Key':'synthetic-key'}:{}),Origin:'https://test',...(!f?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:f?data:JSON.stringify(data)}),testEnv);};
 const form=new FormData();form.set('order_id',o.id);form.set('eventId','test');form.set('file',new Blob([png],{type:'image/png'}),'test.png');r=await call('/api/attach',form);assert.equal(r.status,200,await r.text());
 r=await call('/api/attach/'+o.id+'?ev=test');assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png);assert.equal((await call('/api/attach/'+o.id+'?ev=test',undefined,false)).status,401);
 r=await call('/admin/api/payment-record?ev=test',{id:o.id,payment:{mode:'discount',status:'paid',amount:20,reason:'Synthetic',proof}});assert.equal(r.status,200,await r.text());r=await call('/admin/api/orders?ev=test',{});assert.equal((await r.json()).orders[0].payment.proof.data,proof.data);
 assert.equal((await call('/admin/api/image-storage',{action:'inventory'})).status,401);
 // Recover pre-event legacy keys only after backup checksum verification.
 const oldId='abcdef999999',legacy={...o,id:oldId,hasAttach:true};kv.set('e:test/o:'+oldId,JSON.stringify(legacy));kv.set('ab:'+oldId,png.buffer);const legacyMeta=JSON.stringify({type:'image/png',name:'old.png',size:png.length});kv.set('a:'+oldId,legacyMeta);
 testEnv.PAIDAN_KV.get=async(k,opt)=>kv.has(k)?opt?.type==='arrayBuffer'?(typeof kv.get(k)==='string'?new TextEncoder().encode(kv.get(k)).buffer:kv.get(k)):kv.get(k):null;
 const recovery=new Request('https://test/admin/api/image-storage',{method:'POST',headers:{'X-Admin-Key':'synthetic-key','X-Image-Maintenance-Key':'synthetic-key','Content-Type':'application/json',Origin:'https://test'},body:JSON.stringify({action:'recover-legacy',key:'e:test/ab:'+oldId,confirm:true,backupDigest:await images.imageDigest(png),metadataDigest:await images.imageDigest(legacyMeta)})});
 r=await mod.default.fetch(recovery,testEnv);assert.equal(r.status,200,await r.text());r=await call('/api/attach/'+oldId+'?ev=test');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),png);
 // Public preflight includes R2 bytes before a single upload; tenant ids partition keys.
 const {enforceCommitQuota}=await import(moduleURL(root+'/public-service/quota.js')),quota=new Store();await quota.put('service:grant',{status:'active',quota:{events:20,orders:200,bytes:10}});
 const before=b.puts;await assert.rejects(()=>enforceCommitQuota(quota,new Map([['e:test/ab:abc',png.buffer]]),new Map(),[],true),/额度/);assert.equal(b.puts,before);assert(!await quota.get('service:usage'));
 await quota.put('service:grant',{status:'active',quota:{events:20,orders:200,bytes:10000}});await enforceCommitQuota(quota,new Map([['e:test/ab:abc',png.buffer]]),new Map(),[],true);assert(!await quota.get('service:usage'));
 const hosted=await require('../public-service/tests/harness.cjs').setup();hosted.env.IMAGE_BUCKET=new Bucket();hosted.env.IMAGE_STORE_REQUIRED='1';
 const hc=async(p,options)=>{const out=await hosted.call(p,options);return {status:out.status,cookie:out.headers.get('Set-Cookie')?.split(';')[0],data:await out.json()};};
 const owner=(await hc('/service/api/owner-login',{data:{key:hosted.env.OWNER_KEY}})).cookie,users=[];
 for(let i=0;i<2;i++){
  const user=await hc('/service/api/register',{data:{username:'r2tester'+i,password:'synthetic-password',name:'Synthetic',contact:'Synthetic',reason:'R2 isolation test'},ip:'192.0.2.'+(i+2)});users.push(user);
  assert.equal((await hc('/service/api/owner/review',{cookie:owner,data:{id:user.data.user.id,expectedRevision:0,status:'active',quota:{events:20,orders:200,bytes:104857600,notifications:600,requestsPerDay:1000},note:''}})).status,200);
 }
 const prefix='/t/r2tester0',cookie=users[0].cookie,event={name:'Synthetic',year:2027,dates:['5月1日'],shootDates:{'5月1日':'2027-05-01'},slots:['12:30-13:00'],price:35,publicConfig:{},requestId:crypto.randomUUID(),expectedActiveId:null};
 const he=(await hc(prefix+'/admin/api/event-publish',{cookie,data:event})).data.event;
 const ho=(await hc(prefix+'/api/order',{data:{eventId:he.id,date:'5月1日',timeSlot:'12:30-13:00',cn:'Synthetic',phone:'13800138000',character:'Synthetic',requestId:crypto.randomUUID()}})).data;
 const upload=async bytes=>{const f=new FormData();f.set('eventId',he.id);f.set('order_id',ho.id);f.set('phone','13800138000');f.set('file',new Blob([bytes],{type:'image/png'}),'synthetic.png');return hosted.mod.default.fetch(new Request('https://booking.test'+prefix+'/api/attach',{method:'POST',headers:{Origin:'https://booking.test','CF-Connecting-IP':'192.0.2.1'},body:f}),hosted.env);};
 assert.equal((await upload(png)).status,200);
 const tenant=hosted.tenants.get(users[0].data.user.id),hs=tenant.ctx.storage,hm=await hs.get('v:e:'+he.id+'/ab:'+ho.id);assert(hm.image.key.startsWith('images/v1/'+users[0].data.user.id+'/'));
 assert.equal((await hosted.call(prefix+'/api/attach/'+ho.id+'?ev='+he.id,{cookie:users[1].cookie})).status,401);
 const got=await hosted.call(prefix+'/api/attach/'+ho.id+'?ev='+he.id,{cookie});assert.deepEqual(new Uint8Array(await got.arrayBuffer()),png);
 assert.equal((await hc(prefix+'/admin/api/payment-record?ev='+he.id,{cookie,data:{id:ho.id,payment:{mode:'discount',amount:20,status:'paid',reason:'Synthetic',proof}}})).status,200);
 assert.equal((await hc(prefix+'/admin/api/payment-proof?ev='+he.id,{cookie,data:{id:ho.id}})).data.proof.data,proof.data);
 assert((await hs.get('v:e:'+he.id+'/proof:'+ho.id)).imageVersion);assert.equal(hosted.env.IMAGE_BUCKET.map.size,1);
 const grant=await hs.get('service:grant'),usage=await hs.get('service:usage');await hs.put('service:grant',{...grant,quota:{...grant.quota,bytes:usage.bytes}});
 const bigger=new Uint8Array(png.length+1000);bigger.set(png);const puts=hosted.env.IMAGE_BUCKET.puts;assert.equal((await upload(bigger)).status,429);assert.equal(hosted.env.IMAGE_BUCKET.puts,puts);assert.deepEqual(await hs.get('service:usage'),usage);
 await hs.put('service:grant',grant);
 assert.equal((await hc('/service/api/owner/image-storage',{cookie,data:{id:users[0].data.user.id,action:'inventory'}})).status,403);
 assert.equal((await hc('/service/api/owner/image-storage',{cookie:owner,data:{action:'selftest'}})).status,200);
 await hs.put('service:grant',{...grant,status:'suspended'});assert.equal((await hosted.call(prefix+'/api/attach/'+ho.id+'?ev='+he.id,{cookie})).status,403);
 console.log('PASS: private/public R2 references/proofs/audits; tenant isolation; integrity; corruption; R2 failure; transaction rollback; cleanup/refcounts; migration/restore; authorization; suspended accounts; public quota before upload.');
}
module.exports={Bucket,moduleURL,png};if(require.main===module)main().catch(e=>{console.error(e.stack?.split('\n').slice(0,5).join('\n'));process.exit(1)});
