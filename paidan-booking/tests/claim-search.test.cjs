// Synthetic fixtures only. No network, credentials, or production data.
const assert=require('node:assert/strict'),path=require('node:path'),{setup}=require('./harness.cjs');
(async()=>{
 const ctx=await setup(process.env.CLAIM_TEST_SOURCE?{sourceRoot:path.resolve(process.env.CLAIM_TEST_SOURCE)}:{}),{raw,storage,kv,event,old,env}=ctx;
 const origin='http://127.0.0.1:8151';
 const call=async(p,data,cookie='',headers={})=>{const r=await raw(p,data,{Origin:origin,...(cookie?{Cookie:cookie}:{}),...headers});return {status:r.status,cookie:r.headers.get('Set-Cookie')?.split(';')[0],...await r.json()};};
 const a=await call('/api/customer/auth/register',{username:'关联测试甲',password:'synthetic-password-a'}),b=await call('/api/customer/auth/register',{username:'关联测试乙',password:'synthetic-password-b'});
 const cn='同名 CN',phone='13800138000',archive={...event,id:'archive',name:'合成历史场次',status:'archived',imported:true},events=[event,archive];kv.set('events',JSON.stringify(events));
 old.cn=cn;old.phone=phone;kv.set('e:'+event.id+'/o:'+old.id,JSON.stringify(old));
 const record={cn,phone,date:'5月1日',time:'13:00-13:30',character:'历史角色',remark:'测试记录'},missing={cn,date:'5月1日',time:'14:00-14:30',character:'待补录角色'};
 kv.set('e:archive/records',JSON.stringify([record,missing]));
 assert((await call('/admin/api/watch-settings',{revision:0,enabled:true,channel:'webhook',events:['booking','cancel','payment'],endpoint:'https://notify.example.org/synthetic-only',token:'',chatId:''},'',{'X-Admin-Key':env.ADMIN_KEY})).ok);
 assert.equal((await call('/api/customer/claim-search',{cn,phone})).status,401);
 assert.equal((await call('/api/customer/claim-search',{cn:''},a.cookie)).status,400);
 let query=await call('/api/customer/claim-search',{cn,phone},a.cookie);assert.equal(query.results.length,2);assert(query.results.every(r=>!r.linked));
 for(const r of query.results){assert(r.eventName&&r.cn&&r.character);for(const key of ['phone','id','eventId','customerId','remark','payment','proof'])assert(!(key in r));}
 assert.equal((await call('/api/customer/claim',{searchId:query.searchId,selection:[query.results[0].token],confirmed:true},b.cookie)).status,409);
 assert.equal((await call('/api/customer/claim',{searchId:query.searchId,selection:[query.results[0].token],confirmed:false},a.cookie)).status,400);
 const selection=query.results.map(r=>r.token),claim={searchId:query.searchId,selection,confirmed:true};
 storage.fail=true;assert.equal((await call('/api/customer/claim',claim,a.cookie)).status,500);storage.fail=false;
 assert.equal((await call('/api/customer/orders',undefined,a.cookie)).orders.length,0);
 assert.equal((await call('/api/customer/claim',claim,a.cookie)).linked,2);
 assert.equal((await call('/api/customer/claim',claim,a.cookie)).alreadyLinked,2);
 const mine=await call('/api/customer/orders',undefined,a.cookie);assert.equal(mine.orders.length,2);assert(mine.orders.some(o=>o.isRecord&&o.character==='历史角色'));assert(mine.orders.some(o=>o.id===old.id));
 const linked=await call('/api/customer/claim-search',{cn,phone},b.cookie);assert.equal(linked.results.length,2);assert(linked.results.every(r=>r.linked));
 assert.equal((await call('/api/customer/claim',{searchId:linked.searchId,selection:[linked.results[0].token],confirmed:true},b.cookie)).status,409);
 // A photographer can supply a verified phone for a historical row, using the normal conflict guard.
 const imported=(await call('/admin/api/orders?ev=archive',{},'',{'X-Admin-Key':env.ADMIN_KEY})).records;
 const update={eventId:'archive',targetType:'record',recordIndex:1,expectedRecord:imported[1],expected:{phone:''},changes:{phone}};
 assert.equal((await call('/admin/api/order-update?ev=archive',update,a.cookie)).status,401);
 assert((await call('/admin/api/order-update?ev=archive',update,'',{'X-Admin-Key':env.ADMIN_KEY})).ok);
 const linkedOld=(await call('/admin/api/orders?ev=archive',{},'',{'X-Admin-Key':env.ADMIN_KEY})).records[0];assert.equal(linkedOld.customerId,a.user.id,'Phone edit must preserve previous ownership');
 query=await call('/api/customer/claim-search',{cn,phone},b.cookie);assert.equal(query.results.length,3);assert.equal(query.results.filter(r=>!r.linked).length,1);
 const second=query.results.find(r=>!r.linked);assert.equal((await call('/api/customer/claim',{searchId:query.searchId,selection:[second.token],confirmed:true},b.cookie)).linked,1);
 assert.deepEqual((await call('/api/customer/profile',undefined,b.cookie)).profile,{cn,phone});
 assert.equal((await call('/api/customer/orders',undefined,b.cookie)).orders[0].isRecord,true);
 assert.equal((await call('/api/customer/cancel',{eventId:'archive',id:'record-1'},b.cookie)).status,400);
 // Wrong contact details and optional wrong order numbers cannot reveal matching CNs.
 const extra=await call('/api/customer/auth/register',{username:'关联测试丙',password:'synthetic-password-c'});
 assert.equal((await call('/api/customer/claim-search',{cn,phone:'13800138001'},extra.cookie)).results.length,0);
 assert.equal((await call('/api/customer/claim-search',{cn:'同名',phone},extra.cookie)).results.length,0);
 assert.equal((await call('/api/customer/claim-search',{cn,phone,id:'abcdef99abcd'},extra.cookie)).results.length,0);
 const exact=await call('/api/customer/claim-search',{cn,phone,id:old.id},extra.cookie);assert.equal(exact.results.length,1);assert(exact.results[0].linked);
 assert.equal((await call('/api/customer/claim-search',{cn,phone,id:'<script>'},extra.cookie)).status,400);
 // Simulated expiry and distributed/global caps apply before scanning historical data.
 const now=Date.now;try{Date.now=()=>now()+6*60000;assert.equal((await call('/api/customer/claim',{searchId:exact.searchId,selection:[exact.results[0].token],confirmed:true},extra.cookie)).status,409);}finally{Date.now=now;}
 const d=await call('/api/customer/auth/register',{username:'关联测试丁',password:'synthetic-password-d'}),staleEvent={...event,id:'stale'},stale={...old,id:'abcdef77abcd',eventId:'stale',customerId:undefined};
 kv.set('events',JSON.stringify([...events,staleEvent]));kv.set('e:stale/orders',JSON.stringify([stale.id]));kv.set('e:stale/o:'+stale.id,JSON.stringify(stale));
 const staleSearch=await call('/api/customer/claim-search',{cn,phone},d.cookie),candidate=staleSearch.results.find(r=>!r.linked),owned=staleSearch.results.find(r=>r.linked);
 assert.equal((await call('/api/customer/claim',{searchId:staleSearch.searchId,selection:[candidate.token,owned.token],confirmed:true},d.cookie)).status,409);
 assert.equal((await call('/api/customer/orders',undefined,d.cookie)).orders.length,0,'A conflict cannot commit the earlier selected row');
 assert((await call('/admin/api/order-update?ev=stale',{eventId:'stale',id:stale.id,expected:{phone},changes:{phone:'13800138002'}},'',{'X-Admin-Key':env.ADMIN_KEY})).ok);
 assert.equal((await call('/api/customer/claim',{searchId:staleSearch.searchId,selection:[candidate.token],confirmed:true},d.cookie)).status,409,'Changed contact details invalidate a search ticket');
 while((await call('/api/customer/claim-search',{cn,phone},extra.cookie)).status!==429){}
 assert.equal((await storage.list({prefix:'watch:q:'})).size,0,'Linking/backfilling must not send new-booking/payment alerts');
 console.log('PASS CN+phone all-event search, minimal results, owned disabled state, imported phone backfill, selected atomic claim, retry, profile/history, mismatch/expiry/rate guards.');
})().catch(e=>{console.error(e.stack?.split('\n').slice(0,6).join('\n'));process.exit(1)});
