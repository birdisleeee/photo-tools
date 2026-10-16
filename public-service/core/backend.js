import { readStored, prepareImages, commitImages, cleanImages, imageMaintenance } from './image-storage.js';
import { enforceCommitQuota } from '../quota.js';
// Request handlers shared by the production entrypoint and integration tests.
import { watchRoute, watchStage, watchCommit, watchAlarm } from './watch-runtime.js';
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const read=async(env,key,fallback=null)=>{const v=await env.PAIDAN_KV.get(key);return v===null?fallback:JSON.parse(v);};
const write=(env,key,value)=>env.PAIDAN_KV.put(key,JSON.stringify(value));
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1000000&&Math.abs(v*100-Math.round(v*100))<1e-6;
function validateEvent(d){
 if(typeof d.name!=='string'||!d.name.trim()||d.name.length>40||!Number.isInteger(d.year)||d.year<2000||d.year>2100||!amount(d.price))throw Error('名称、年份或单价无效');
 if(!Array.isArray(d.dates)||!d.dates.length||d.dates.length>14||new Set(d.dates).size!==d.dates.length)throw Error('日期不能重复，最多14天');
 for(const day of d.dates){const iso=d.shootDates?.[day];if(!/^\d{4}-\d{2}-\d{2}$/.test(iso||'')||!Number.isFinite(Date.parse(iso))||new Date(iso).toISOString().slice(0,10)!==iso||Number(iso.slice(0,4))!==d.year||day!==Number(iso.slice(5,7))+'月'+Number(iso.slice(8,10))+'日')throw Error('拍摄日期无效');}
 if(!Array.isArray(d.slots)||!d.slots.length||d.slots.length>100)throw Error('请设置拍摄时段');
 let last=-1;for(const slot of d.slots){const m=typeof slot==='string'&&slot.match(/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/);if(!m)throw Error('时段格式无效');const a=+m[1]*60+ +m[2],b=+m[3]*60+ +m[4];if(a>=b||a<last)throw Error('时段不能重叠');last=b;}
 const limits={subtitle:150,location:150,equipment:150,lighting:150,late:1000,extra:1000,remarkHint:200,photographer:40,phone:30,wechat:80,alipay:80,paymentNote:1000};
 if(!d.publicConfig||typeof d.publicConfig!=='object'||Array.isArray(d.publicConfig)||Object.entries(d.publicConfig).some(([k,v])=>!limits[k]||typeof v!=='string'||v.length>limits[k]))throw Error('客人页面设置无效');
}
function validateProof(p){
 if(p==null)return null;
 if(!p||!['image/png','image/jpeg','image/webp'].includes(p.type)||typeof p.data!=='string'||p.data.length>7*1024*1024||typeof p.name!=='string'||p.name.length>200)throw Error('凭证格式无效');
 let raw;try{raw=atob(p.data);}catch{throw Error('凭证编码无效');}
 if(!raw.length||raw.length>5*1024*1024)throw Error('凭证不得超过5MB');
 if(p.type==='image/png'&&!raw.startsWith('\x89PNG\r\n\x1a\n')||p.type==='image/jpeg'&&!raw.startsWith('\xff\xd8\xff')||p.type==='image/webp'&&!(raw.startsWith('RIFF')&&raw.slice(8,12)==='WEBP'))throw Error('凭证内容与图片类型不符');
 return {name:p.name,type:p.type,data:p.data};
}
export async function extendedRoutes(request,env){
 const url=new URL(request.url),path=url.pathname;
 const admin=path.startsWith('/admin/');
 if(admin&&(url.searchParams.get('key')||request.headers.get('X-Admin-Key'))!==env.ADMIN_KEY)return reply({ok:false,error:'unauthorized'},401);
 const handled=['/admin/api/payment-proof','/admin/api/event-publish','/admin/api/order-update','/admin/api/payment-record','/admin/api/records-merge','/api/paid'];
 if(!handled.includes(path))return null;
 if(request.method!=='POST')return reply({ok:false,error:'method not allowed'},405);
 let d;try{d=await request.json();if(!d||typeof d!=='object')throw Error();}catch{return reply({ok:false,error:'bad json'},400);}
 const events=await read(env,'events',[]),active=events.find(e=>e.status==='active');
 const selected=url.searchParams.get('ev'),ev=selected?events.find(e=>e.id===selected):active;
 if(path==='/admin/api/event-publish'){
  try{validateEvent(d);}catch(e){return reply({ok:false,error:e.message},400);}
  if(typeof d.requestId!=='string'||!/^[\da-f-]{36}$/i.test(d.requestId))return reply({ok:false,error:'缺少发布请求编号'},400);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(d))))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const prior=await read(env,'publish:'+d.requestId);
  if(prior)return prior.digest===digest?reply({ok:true,event:prior.event}):reply({ok:false,error:'请求内容已变化，请重新打开草稿'},409);
  if(d.expectedActiveId!==(active?.id||null))return reply({ok:false,error:'当前届已变化，请重新核对后发布'},409);
  const event={id:'ev-'+crypto.randomUUID().slice(0,8),name:d.name.trim(),status:'active',year:d.year,dates:d.dates,shootDates:d.shootDates,slots:d.slots,price:d.price,publicConfig:d.publicConfig,createdAt:new Date().toISOString()};
  for(const e of events)if(e.status==='active')e.status='archived';events.unshift(event);
  await write(env,'e:'+event.id+'/config',{price:d.price});await write(env,'e:'+event.id+'/booked',{});await write(env,'e:'+event.id+'/orders',[]);
  await write(env,'events',events);await write(env,'publish:'+d.requestId,{digest,event});return reply({ok:true,event});
 }
 if(path==='/api/paid'){
  // This is a customer notification, not an administrator-verified receipt.
  const event=events.find(e=>e.id===d.eventId);if(!event)return reply({ok:false,error:'请重新查询预约'},409);
  const key='e:'+event.id+'/o:'+String(d.id||''),o=await read(env,key);
  if(!o||o.cancelled||o.phone!==d.phone)return reply({ok:false,error:'预约不存在或验证失败'},403);
  o.paymentReportedAt=new Date().toISOString();await write(env,key,o);return reply({ok:true});
 }
 if(!ev)return reply({ok:false,error:'漫展不存在'},404);
 const prefix='e:'+ev.id+'/';
 if(path==='/admin/api/records-merge'){
  const records=await read(env,prefix+'records',[]);
  if(!equal(records,d.expected))return reply({ok:false,error:'历史记录已变化'},409);
  if(!ev.imported||!Array.isArray(d.records)||records.length!==d.records.length||d.records.some((r,i)=>r.cn!==records[i].cn||r.date!==records[i].date||r.time!==records[i].time||r.character!==records[i].character))return reply({ok:false,error:'只能补充既有记录'},400);
  await write(env,prefix+'audit:'+crypto.randomUUID(),{at:new Date().toISOString(),action:'records-merge',before:records});await write(env,prefix+'records',d.records);return reply({ok:true,count:d.records.length});
 }
 const isRecord=d.targetType==='record';let list,target,key;
 if(isRecord){list=await read(env,prefix+'records',[]);if(!Number.isInteger(d.recordIndex)||d.recordIndex<0||d.recordIndex>=list.length)return reply({ok:false,error:'记录不存在'},404);target=list[d.recordIndex];if(!equal(target,d.expectedRecord))return reply({ok:false,error:'历史记录已变化，请刷新'},409);key=prefix+'records';}
 else {if(typeof d.id!=='string'||!/^[a-z0-9-]{1,80}$/i.test(d.id))return reply({ok:false,error:'订单编号无效'},400);key=prefix+'o:'+d.id;target=await read(env,key);if(!target||target.cancelled)return reply({ok:false,error:'订单不存在或已取消'},404);}
 const proofKey=prefix+'proof:'+(isRecord?'record-'+d.recordIndex:d.id);
 if(path==='/admin/api/payment-proof')return reply({ok:true,proof:await read(env,proofKey,target.payment?.proof?.data?target.payment.proof:null)});
 const before=structuredClone(target);
 if(path==='/admin/api/order-update'){
  if(d.eventId!==ev.id)return reply({ok:false,error:'漫展不匹配'},409);
  const limits={cn:30,phone:11,character:50,remark:100},changes=d.changes||{};
  if(Object.keys(changes).length!==1)return reply({ok:false,error:'每次修改一个字段'},400);
  const [field,value]=Object.entries(changes)[0];
  if(!limits[field]||typeof value!=='string'||value.length>limits[field]||(field!=='remark'&&!value.trim())||(field==='phone'&&(isRecord||!/^1[3-9]\d{9}$/.test(value))))return reply({ok:false,error:'字段内容无效'},400);
  if((target[field]||'')!==d.expected?.[field])return reply({ok:false,error:'记录已变化，请刷新'},409);target[field]=value;
 }else{
  const p=d.payment||{},config=await read(env,prefix+'config',{});
  if(!['normal','free','discount'].includes(p.mode)||!['paid','deposit','unpaid'].includes(p.status)||!amount(p.amount))return reply({ok:false,error:'收款内容无效'},400);
  if(p.mode==='normal'&&p.amount!==(config.price??0))return reply({ok:false,error:'单价已更新，请重新确认'},409);
  if(p.mode==='free'&&(p.amount!==0||p.status!=='paid'))return reply({ok:false,error:'免单必须为0元'},400);
  if(p.mode==='discount'&&(typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>300))return reply({ok:false,error:'请填写优惠原因'},400);
  if(p.status==='deposit'&&(!amount(p.depositAmount)||p.depositAmount<=0||p.depositAmount>p.amount))return reply({ok:false,error:'定金无效'},400);
  let proof;try{proof=p.mode==='discount'?validateProof(p.proof):null;}catch(e){return reply({ok:false,error:e.message},400);}
  await write(env,proofKey,proof);
  target.payment={mode:p.mode,status:p.status,amount:p.amount,depositAmount:p.status==='deposit'?p.depositAmount:null,reason:p.mode==='discount'?p.reason.trim():'',proof:proof?{name:proof.name,type:proof.type,remote:true}:null,updatedAt:new Date().toISOString()};
  if(!isRecord){target.paid=p.status==='paid';target.amount=p.amount;if(target.paid)target.paidAt=target.payment.updatedAt;else delete target.paidAt;}
 }
 await write(env,prefix+'audit:'+crypto.randomUUID(),{at:new Date().toISOString(),action:path.split('/').pop(),id:d.id||d.recordIndex,before});
 await write(env,key,isRecord?list:target);return reply({ok:true,target,order:target});
}

// All API requests use one durable coordinator. Changes are staged, then atomically
// committed; the old KV namespace remains a read-only source for lazy migration.
export class TransactionalStore {
 constructor(ctx,env,handler){this.ctx=ctx;this.env=env;this.handler=handler;this.queue=Promise.resolve();}
 fetch(request){const task=this.queue.then(()=>this.run(request));this.queue=task.catch(()=>{});return task;}
 // Network delivery must not hold up booking requests. Queue updates use storage transactions.
 alarm(){return watchAlarm(this.ctx.storage);}
 async run(request){
  const storage=this.ctx.storage,staged=new Map(),readCache=new Map();
  const watchResponse=await watchRoute(request,this.env,storage);if(watchResponse)return watchResponse;
  const load=async key=>{if(staged.has(key))return staged.get(key);if(readCache.has(key))return readCache.get(key);const meta=await storage.get('v:'+key);let value=null;
   if(meta)value=await readStored(storage,this.env,this.ctx,key,meta);
   else value=await this.env.PAIDAN_KV.get(key,{type:'arrayBuffer'}).then(v=>v===null?null:(key.includes('/ab:')?v:new TextDecoder().decode(v)));
   readCache.set(key,value);return value;
  };
  if(new URL(request.url).pathname==='/service/images'){await cleanImages(storage,this.env,this.ctx);return imageMaintenance(request,this.env,this.ctx,load);}
  const adapter={get:async(key,options)=>{const value=await load(key);if(value===null)return null;if(options?.type==='arrayBuffer')return typeof value==='string'?new TextEncoder().encode(value).buffer:value;return typeof value==='string'?value:new TextDecoder().decode(value);},put:async(key,value)=>{staged.set(key,value);}};
  let response;try{response=await this.handler.fetch(request,{...this.env,PAIDAN_KV:adapter});}catch(e){console.error('Booking request failed',e.name);return reply({ok:false,error:'保存未完成，请重试'},500);}
  if(response.ok&&staged.size){
   // Load the pre-change order before comparing; newly staged values must not hide it.
   for(const key of [...staged.keys()])if(/^e:[^/]+\/o:/.test(key)&&!readCache.has(key)){const value=staged.get(key);staged.delete(key);await load(key);staged.set(key,value);}
   const notices=await watchStage(storage,staged,readCache,load);
   await enforceCommitQuota(storage,staged,readCache,notices,true);
   await cleanImages(storage,this.env,this.ctx).catch(()=>{});
   const prepared=await prepareImages(storage,this.env,this.ctx,staged);
   try{await storage.transaction(async tx=>{await enforceCommitQuota(tx,staged,readCache,notices);await commitImages(tx,prepared);await watchCommit(tx,notices);});}
   catch(error){await cleanImages(storage,this.env,this.ctx).catch(()=>{});throw error;}
   await cleanImages(storage,this.env,this.ctx).catch(()=>{});}

  return response;
 }
}
