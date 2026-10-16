import {handler} from './core/worker.js';
import {TransactionalStore} from './core/backend.js';
import {json,bad,same,readJSON} from './security.js';
export class TenantStore extends TransactionalStore {
 constructor(ctx,env){super(ctx,{...env,ADMIN_KEY:env.INTERNAL_KEY,PAIDAN_KV:{async get(){return null;}}},handler);}
 fetch(request){const p=this.queue.then(()=>this.process(request)).catch(e=>json({ok:false,error:e.status?e.message:'保存未完成，请重试'},e.status||500));this.queue=p.catch(()=>{});return p;}
 async process(request){
  if(!same(request.headers.get('X-Service-Key'),this.env.INTERNAL_KEY))bad('unauthorized',401);const path=new URL(request.url).pathname,s=this.ctx.storage;
  if(path==='/service/grant'){
   const g=await readJSON(request);const old=await s.get('service:grant');if(old&&g.revision<=old.revision)bad('账户授权版本已变化',409);await s.put('service:grant',g);if(g.status==='active'&&(await s.list({prefix:'watch:q:'})).size)await s.setAlarm(Date.now()+1000);if(g.status!=='active')await s.deleteAlarm();return json({ok:true});
  }
  if(path==='/service/images')return this.run(request);
  const grant=await s.get('service:grant');
  if(path==='/service/usage')return json({ok:true,quota:grant?.quota||{},usage:await s.get('service:usage')||{events:0,orders:0,bytes:0,notifications:0},daily:await s.get('service:daily')||{count:0},physicalBytes:s.sql?.databaseSize??null});
  if(grant?.status!=='active')bad('账户尚未获准使用或已停用',403);
  const day=new Date().toISOString().slice(0,10),daily=await s.get('service:daily'),count=daily?.day===day?daily.count:0;if(count>=grant.quota.requestsPerDay)bad('本账户今日请求额度已用完，请向运营者申请额度',429);await s.put('service:daily',{day,count:count+1});
  // Old import/admin endpoints were not designed for hostile public input; use the validated publish flow.
  if(['/admin/api/event-new','/admin/api/event-import','/admin/api/records-merge','/admin/api/mark-paid'].includes(path))bad('公共服务不开放该接口',403);
  if(path==='/admin/api/book'){
   const d=await readJSON(request);if(typeof d.cn!=='string'||!d.cn.trim()||d.cn.length>30||typeof d.character!=='string'||!d.character.trim()||d.character.length>50||!/^1[3-9]\d{9}$/.test(d.phone||''))bad('请填写有效预约信息');request=new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify(d)});
  }
  return this.run(request);
 }
}
