// All records and credentials are synthetic. No outbound notifications.
const assert=require('node:assert/strict'),path=require('node:path'),{setup}=require('./harness.cjs');
const hash=o=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(o))).then(b=>Buffer.from(b).toString('hex'));
(async()=>{
 const {raw,kv,storage,event,old,env}=await setup(process.env.CLAIM_TEST_SOURCE?{sourceRoot:path.resolve(process.env.CLAIM_TEST_SOURCE)}:{});
 const call=async(p,d,admin=true)=>{const r=await raw(p,d,{Origin:'http://127.0.0.1:8151',...(admin?{'X-Admin-Key':env.ADMIN_KEY}:{})});return {status:r.status,...await r.json()};};
 const archive={...event,id:'archive',name:'Synthetic archived event',status:'archived',imported:true};kv.set('events',JSON.stringify([event,archive]));kv.set('e:archive/config',JSON.stringify({price:35}));
 const proof={name:'synthetic.png',type:'image/png',data:Buffer.from([137,80,78,71,13,10,26,10,0,0]).toString('base64')};
 const a={cn:'合成客人甲',character:'角色甲',date:'5月1日',time:'13:00-13:30',remark:'original',customerId:'synthetic-owner',payment:{mode:'discount',status:'deposit',amount:88,depositAmount:27,reason:'合成优惠原因',proof,updatedAt:'2026-01-01T00:00:00Z'}},b={cn:'合成客人乙',character:'角色乙',date:'5月1日',time:'14:00-14:30',payment:{mode:'normal',status:'unpaid',amount:35}},cancelled={...b,cn:'合成已取消客人',cancelled:true};
 kv.set('e:archive/records',JSON.stringify([a,b,cancelled]));
 const rows=async()=> (await call('/admin/api/orders?ev=archive',{})).records;
 const update=async(o,i,p={})=>({targetType:'record',recordIndex:i,expectedFingerprint:await hash(o),payment:{mode:o.payment?.mode||'normal',amount:o.payment?.amount??35,reason:o.payment?.reason||'',...p}});
 const initial=await rows(),updates=[await update(initial[0],0),await update(initial[1],1)],payload={confirmed:true,status:'paid',requestId:crypto.randomUUID(),updates};
 assert.equal((await call('/admin/api/payment-batch?ev=archive',payload,false)).status,401);
 assert.equal((await call('/admin/api/payment-batch?ev=archive',{...payload,confirmed:false})).status,400);
 assert.equal((await call('/admin/api/payment-batch?ev=archive',{...payload,updates:[updates[0],await update(initial[2],2)]})).status,409);assert.deepEqual(await rows(),initial,'Cancelled row rolls back earlier staged receipt');
 assert.equal((await call('/admin/api/payment-batch?ev=archive',{...payload,updates:[updates[0],{...updates[1],expectedFingerprint:'a'.repeat(64)}]})).status,409);assert.deepEqual(await rows(),initial);
 storage.fail=true;assert.equal((await call('/admin/api/payment-batch?ev=archive',payload)).status,500);storage.fail=false;assert.deepEqual(await rows(),initial);
 assert.equal((await call('/admin/api/payment-batch?ev=archive',payload)).count,2);
 let result=await rows();assert(result.slice(0,2).every(o=>o.payment.status==='paid'));assert.equal(result[0].payment.amount,88);assert.equal(result[0].payment.reason,a.payment.reason);assert.deepEqual(result[0].payment.proof,proof);assert.equal(result[0].remark,a.remark);assert.equal(result[0].customerId,a.customerId);assert.equal(result[0].time,a.time);
 const saved=structuredClone(result);assert.equal((await call('/admin/api/payment-batch?ev=archive',payload)).count,2);assert.deepEqual(await rows(),saved,'Retry returns earlier result, without a second receipt');
 assert.equal((await call('/admin/api/payment-batch?ev=archive',{...payload,status:'unpaid'})).status,409);
 // A later unit-price change must not rewrite an existing normal-price receipt.
 kv.set('e:archive/config',JSON.stringify({price:40}));
 let next={confirmed:true,status:'unpaid',requestId:crypto.randomUUID(),updates:[await update(result[0],0),await update(result[1],1)]};assert((await call('/admin/api/payment-batch?ev=archive',next)).ok);
 result=await rows();assert.equal(result[0].payment.amount,88);assert.equal(result[0].payment.status,'unpaid');assert.deepEqual(result[0].payment.proof,proof);assert.equal(result[1].payment.mode,'normal');assert.equal(result[1].payment.amount,35);
 next={confirmed:true,status:'deposit',requestId:crypto.randomUUID(),updates:[await update(result[0],0,{depositAmount:25}),await update(result[1],1,{depositAmount:36})]};assert.equal((await call('/admin/api/payment-batch?ev=archive',next)).status,400);assert.deepEqual(await rows(),result);
 next.updates[1].payment.depositAmount=10;assert((await call('/admin/api/payment-batch?ev=archive',next)).ok);result=await rows();assert.equal(result[0].payment.depositAmount,25);assert.equal(result[1].payment.depositAmount,10);
 next={confirmed:true,status:'free',requestId:crypto.randomUUID(),updates:[await update(result[1],1)]};assert((await call('/admin/api/payment-batch?ev=archive',next)).ok);result=await rows();assert.equal(result[1].payment.mode,'free');assert.equal(result[1].payment.amount,0);
 // Online orders use the same validation and keep the original schedule/owner.
 const online=(await call('/admin/api/orders?ev='+event.id,{})).orders[0];kv.set('e:'+event.id+'/config',JSON.stringify({price:35}));
 assert((await call('/admin/api/payment-batch?ev='+event.id,{confirmed:true,status:'paid',requestId:crypto.randomUUID(),updates:[{targetType:'order',id:online.id,expectedFingerprint:await hash(online),payment:{mode:'normal',amount:35}}]})).ok);
 const onlineAfter=(await call('/admin/api/orders?ev='+event.id,{})).orders[0];assert(onlineAfter.paid);assert.equal(onlineAfter.timeSlot,online.timeSlot);assert.equal(onlineAfter.cn,online.cn);
 assert.equal((await storage.list({prefix:'watch:q:'})).size,0);
 console.log('PASS bulk paid/unpaid/deposit/free; online/imported/archived; amounts/reasons/evidence preserved; auth, cancellation/conflict/rollback, idempotent retry and schedule/owner protection.');
})().catch(e=>{console.error(e.stack?.split('\n').slice(0,6).join('\n'));process.exit(1)});
