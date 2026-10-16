// Synthetic fixtures only; no production accounts or bookings are changed.
const assert=require('node:assert/strict'),path=require('node:path'),{setup}=require('./harness.cjs');
(async()=>{
 const {raw,kv,storage,event,old,env}=await setup(process.env.CLAIM_TEST_SOURCE?{sourceRoot:path.resolve(process.env.CLAIM_TEST_SOURCE)}:{});
 const call=async(p,d,cookie='',admin=false)=>{const r=await raw(p,d,{Origin:'http://127.0.0.1:8151',...(cookie?{Cookie:cookie}:{}),...(admin?{'X-Admin-Key':env.ADMIN_KEY}:{})});return {status:r.status,cookie:r.headers.get('Set-Cookie')?.split(';')[0],...await r.json()};};
 const a=await call('/api/customer/auth/register',{username:'取消订单合成客妹',password:'synthetic-password'}),cn='合成CN';old.cn=cn;
 const cancelled={...old,id:'abcdef22abcd',character:'已取消线上角色',cancelled:true},archive={...event,id:'archive',name:'合成旧届',status:'archived',imported:true};
 kv.set('events',JSON.stringify([event,archive]));kv.set('e:'+event.id+'/orders',JSON.stringify([old.id,cancelled.id]));kv.set('e:'+event.id+'/o:'+old.id,JSON.stringify(old));kv.set('e:'+event.id+'/o:'+cancelled.id,JSON.stringify(cancelled));
 const records=[{cn,character:'有效旧角色',date:'5月1日',time:'13:00-13:30'},{cn,character:'已取消旧角色',date:'5月1日',time:'14:00-14:30',cancelled:true}];kv.set('e:archive/records',JSON.stringify(records));
 let q=await call('/api/customer/claim-search',{cn},a.cookie);assert.equal(q.results.length,2);assert(q.results.every(r=>!r.character.includes('已取消')));
 assert.equal((await call('/api/customer/claim-search',{cn,id:cancelled.id,phone:old.phone},a.cookie)).results.length,0);
 assert.equal((await call('/api/customer/claim',{eventId:event.id,id:cancelled.id,phone:old.phone},a.cookie)).status,409);
 const ref=(o,isRecord=false)=>({eventId:isRecord?'archive':event.id,kind:isRecord?'record':'order',...(isRecord?{recordIndex:1}:{id:o.id}),expected:[o.cn,o.character,o.date,isRecord?o.time:o.timeSlot,o.customerId||null]});
 for(const target of [ref(cancelled),ref(records[1],true)]){
  assert.equal((await call('/admin/api/customer-link',{customerId:a.user.id,targets:[ref(old),target],confirmed:true},'',true)).status,409);
  assert.equal((await call('/api/customer/orders',undefined,a.cookie)).orders.length,0,'Cancelled selection must roll back all earlier staged links');
 }
 // A ticket created before a cancellation must fail without writing ownership.
 q=await call('/api/customer/claim-search',{cn,id:old.id},a.cookie);assert.equal(q.results.length,1);kv.set('e:'+event.id+'/o:'+old.id,JSON.stringify({...old,cancelled:true}));
 assert.equal((await call('/api/customer/claim',{searchId:q.searchId,selection:[q.results[0].token],confirmed:true},a.cookie)).status,409);
 // Even an unexpired ticket from the older buggy version, whose fingerprint
 // already says cancelled=true, must not authorize linking after the fix.
 const token='a'.repeat(32),searchId='b'.repeat(32),ticketKey='customer-claim-search:'+a.user.id;
 const fingerprint=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([cn.toLowerCase(),cancelled.phone,cancelled.date,cancelled.timeSlot,cancelled.character,true])))).toString('hex');
 await storage.delete('v:'+ticketKey);kv.set(ticketKey,JSON.stringify({searchId,expiresAt:Date.now()+300000,verified:true,targets:[{id:cancelled.id,eventId:event.id,token,fingerprint}]}));
 assert.equal((await call('/api/customer/claim',{searchId,selection:[token],confirmed:true},a.cookie)).status,409);
 assert.equal((await call('/api/customer/orders',undefined,a.cookie)).orders.length,0);
 console.log('PASS cancelled online/imported records excluded; optional filters, legacy and operator routes blocked; mixed batches atomic; post-search cancellation and pre-fix tickets rejected.');
})().catch(e=>{console.error(e.stack?.split('\n').slice(0,6).join('\n'));process.exit(1)});
