// Synthetic data only. Exercises the real request/auth/transaction pipeline.
const assert=require('node:assert/strict'),path=require('node:path'),{setup}=require('./harness.cjs');
(async()=>{
 const {raw,kv,storage,event,old,env}=await setup(process.env.CLAIM_TEST_SOURCE?{sourceRoot:path.resolve(process.env.CLAIM_TEST_SOURCE)}:{}),origin='http://127.0.0.1:8151';
 const call=async(p,d,cookie='',headers={})=>{const r=await raw(p,d,{Origin:origin,...(cookie?{Cookie:cookie}:{}),...headers});return {status:r.status,cookie:r.headers.get('Set-Cookie')?.split(';')[0],...await r.json()};};
 const admin=(p,d)=>call(p,d,'',{'X-Admin-Key':env.ADMIN_KEY}),register=username=>call('/api/customer/auth/register',{username,password:'synthetic-password'});
 const a=await register('合成客妹甲'),b=await register('合成客妹乙'),cn='合成客妹',archive={...event,id:'archive',name:'合成历史场次',status:'archived',imported:true};
 kv.set('events',JSON.stringify([event,archive]));old.cn=cn;old.remark='private synthetic note';old.paid=true;kv.set('e:'+event.id+'/o:'+old.id,JSON.stringify(old));
 kv.set('e:archive/records',JSON.stringify([{cn,character:'旧表格角色',date:'5月1日',time:'13:00-13:30',remark:'private synthetic note',payment:{status:'paid',amount:35}}]));
 assert.equal((await call('/admin/api/customer-search',{query:'合成'},a.cookie)).status,401);
 assert.equal((await call('/admin/api/customer-link',{customerId:a.user.id,targets:[]},a.cookie)).status,401);
 const users=(await admin('/admin/api/customer-search',{query:'合成客妹'})).users;assert.equal(users.length,2);assert.deepEqual(Object.keys(users[0]).sort(),['id','username']);
 let q=await call('/api/customer/claim-search',{cn},a.cookie);assert.equal(q.results.length,2);for(const row of q.results)assert.deepEqual(Object.keys(row).sort(),['character','cn','eventName','linked','token']);
 assert.equal((await call('/api/customer/claim',{searchId:q.searchId,selection:q.results.map(r=>r.token),confirmed:true},a.cookie)).linked,2);
 let mine=(await call('/api/customer/orders',undefined,a.cookie)).orders;assert.equal(mine.length,2);for(const row of mine){assert(row.limited);assert.notEqual(row.id,old.id);assert.deepEqual(Object.keys(row).sort(),['character','cn','eventId','eventName','id','isRecord','limited']);}
 assert.deepEqual((await call('/api/customer/profile',undefined,a.cookie)).profile,{cn:'',phone:''});
 for(const p of ['/api/customer/paid','/api/customer/cancel','/api/paid','/api/cancel'])assert.equal((await call(p,{eventId:event.id,id:old.id,phone:old.phone},a.cookie)).status,403,p);
 const legacy=await call('/api/my-orders',{query:old.id},a.cookie);assert.equal(legacy.orders.length,0);
 const attachment=new FormData();attachment.set('order_id',old.id);attachment.set('eventId',event.id);attachment.set('file',new Blob(['test'],{type:'image/png'}),'fixture.png');assert.equal((await call('/api/attach',attachment,a.cookie)).status,403);
 q=await call('/api/customer/claim-search',{cn},b.cookie);assert(q.results.every(r=>r.linked));assert.equal((await call('/api/customer/claim',{searchId:q.searchId,selection:[q.results[0].token],confirmed:true},b.cookie)).status,409);
 const snapshot=async()=>await admin('/admin/api/orders?ev=archive',{});
 const r=(await snapshot()).records[0],target={eventId:'archive',kind:'record',recordIndex:0,expected:[r.cn,r.character,r.date,r.time,r.customerId||null]};
 assert.equal((await admin('/admin/api/customer-link',{customerId:b.user.id,targets:[target]})).status,400);
 assert.equal((await admin('/admin/api/customer-link',{customerId:'nonexistent',targets:[target],confirmed:true})).status,400);
 const before=(await snapshot()).records;
 assert.equal((await admin('/admin/api/customer-link',{customerId:b.user.id,targets:[target,{...target,recordIndex:99}],confirmed:true})).status,409);
 assert.deepEqual((await snapshot()).records,before,'Conflict rolls back the earlier row');
 storage.fail=true;assert.equal((await admin('/admin/api/customer-link',{customerId:b.user.id,targets:[target],confirmed:true})).status,500);storage.fail=false;
 assert.deepEqual((await snapshot()).records,before,'Storage failure rolls back ownership');
 assert.equal((await admin('/admin/api/customer-link',{customerId:b.user.id,targets:[target],confirmed:true})).linked,1);
 const assigned=(await snapshot()).records[0];assert.equal(assigned.customerId,b.user.id);assert.equal(assigned.customerAccess,undefined);assert.equal(assigned.phone,undefined);assert.equal(assigned.date,r.date);
 mine=(await call('/api/customer/orders',undefined,b.cookie)).orders;assert.equal(mine.length,1);assert(!mine[0].limited);assert.equal(mine[0].remark,'private synthetic note');assert.equal((await call('/api/customer/orders',undefined,a.cookie)).orders.length,1);
 assert.equal((await admin('/admin/api/customer-link',{customerId:a.user.id,targets:[target],confirmed:true})).status,409,'Old owner snapshot is stale');
 assert.equal((await call('/api/customer/claim',{eventId:event.id,id:old.id},a.cookie)).status,403,'Missing phone cannot upgrade limited ownership');
 assert((await call('/api/customer/claim',{eventId:event.id,id:old.id,phone:old.phone},a.cookie)).ok);assert(!(await call('/api/customer/orders',undefined,a.cookie)).orders[0].limited);
 assert.equal((await storage.list({prefix:'watch:q:'})).size,0);
 console.log('PASS CN-only claim, three-field redaction, limited operation guards, operator search/confirmation, atomic assignment/reassignment, stale and rollback checks, verified upgrade.');
})().catch(e=>{console.error(e.stack?.split('\n').slice(0,6).join('\n'));process.exit(1)});
