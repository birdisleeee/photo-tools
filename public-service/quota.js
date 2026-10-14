import {bad} from './security.js';
export const QUOTA_FIELDS=['events','orders','bytes','notifications','requestsPerDay'];
export const emptyQuota=()=>Object.fromEntries(QUOTA_FIELDS.map(k=>[k,0]));
export function validateQuota(q){if(!q||QUOTA_FIELDS.some(k=>!Number.isSafeInteger(q[k])||q[k]<0))bad('请填写每项非负整数额度');const ceilings={events:1000,orders:100000,bytes:1024*1024*1024,notifications:1000000,requestsPerDay:1000000};if(QUOTA_FIELDS.some(k=>q[k]>ceilings[k]))bad('额度超过单账户技术上限');return Object.fromEntries(QUOTA_FIELDS.map(k=>[k,q[k]]));}
export async function enforceCommitQuota(tx,staged,readCache,notices){
 const grant=await tx.get('service:grant');if(grant?.status!=='active')bad('账户尚未获准使用',403);
 const used=await tx.get('service:usage')||{events:0,orders:0,bytes:0,notifications:0};let bytes=used.bytes,orders=used.orders,events=used.events;
 for(const [key,value] of staged){const old=await tx.get('v:'+key);const size=typeof value==='string'?new TextEncoder().encode(value).length:value.byteLength;bytes+=size-(old?.size||0)+(old?0:256);if(/^e:[^/]+\/o:/.test(key)&&!old)orders++;if(key==='events')events=JSON.parse(value).length;if(/^e:[^/]+\/records$/.test(key)){const before=JSON.parse(readCache.get(key)||'[]');orders+=Math.max(0,JSON.parse(value).length-before.length);}}
 const pending=(await tx.list({prefix:'watch:q:'})).size;
 if(events>grant.quota.events||orders>grant.quota.orders||bytes+pending*2048+notices.length*2048>grant.quota.bytes)bad('本账户额度不足，请在账户页向运营者申请额度',429);
 await tx.put('service:usage',{...used,events,orders,bytes});
}
export async function canNotify(tx){const g=await tx.get('service:grant'),u=await tx.get('service:usage')||{};return g?.status==='active'&&(u.notifications||0)<g.quota.notifications;}
export async function permitNotificationAttempt(storage){return storage.transaction(async tx=>{if(!await canNotify(tx))return false;const u=await tx.get('service:usage')||{events:0,orders:0,bytes:0,notifications:0};await tx.put('service:usage',{...u,notifications:(u.notifications||0)+1});return true;});}
