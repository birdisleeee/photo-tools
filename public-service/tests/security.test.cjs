const {test}=require('node:test'),assert=require('node:assert/strict'),{setup}=require('./harness.cjs');
const config=JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'../wrangler.jsonc'),'utf8'));
function installRates(env){
 const counters=new Map();
 for(const b of config.ratelimits)env[b.name]={async limit({key}){const id=b.name+':'+key,n=(counters.get(id)||0)+1;counters.set(id,n);return {success:n<=b.simple.limit};}};
 return counters;
}
test('cheap malformed and unauthenticated requests never reach business storage',async()=>{
 const {env,call}=await setup();installRates(env);let reads=0;env.REGISTRY.get=()=>{reads++;throw Error('Unexpected storage access')};
 const cases=[['/random-scan',{},404],['/service/api/owner/not-real',{},404],['/service/api/login',{},405],['/app',{method:'POST',data:{}},405],['/service/api/register',{data:{},headers:{'Content-Type':'text/plain'}},415],['/service/api/register',{data:{},headers:{'Content-Length':'12001'}},413],['/t/demo/api/order',{data:{},headers:{'Content-Length':'12001'}},413],['/service/api/owner/list',{},403],['/t/demo/admin/api/orders',{data:{},headers:{'X-Admin-Key':env.INTERNAL_KEY,'X-Service-Key':env.INTERNAL_KEY}},401],['/t/demo/api/attach/abcdef1234567890',{},401],['/app?'+ 'a'.repeat(2049),{},414]];
 for(const [p,o,status] of cases){const r=await call(p,o);assert.equal(r.status,status,p);if(status===405)assert(r.headers.get('Allow'));}
 assert.equal(reads,0);
});
test('route rate gates stop excess work before Registry/KV; groups and IPs are separate',async()=>{
 const {env,call}=await setup();installRates(env);let registry=0,kv=0;
 env.REGISTRY.get=()=>({async fetch(){registry++;return new Response('{"ok":false}',{status:401});}});env.PUBLIC_META.get=async()=>{kv++;return null};
 for(const [p,limit,options] of [['/service/api/login',10,{data:{}}],['/t/demo/api/my-orders',30,{data:{}}],['/t/demo/api/order',20,{data:{}}],['/download/app.apk',6,{}]]){
  for(let i=0;i<limit;i++)assert.notEqual((await call(p,options)).status,429);
  const before=registry+kv,r=await call(p,options);assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'60');assert.equal(registry+kv,before);
  assert.notEqual((await call(p,{...options,ip:'192.0.2.2'})).status,429);
 }
 const {env:missing,call:missingCall}=await setup();missing.EDGE_RATE={async limit(){return {success:true}}};assert.equal((await missingCall('/service/api/login',{data:{}})).status,503);
});
test('login account throttle spans IPs and expires without persistent lockout',async()=>{
 const {call}=await setup();
 for(let i=0;i<10;i++)assert.equal((await call('/service/api/login',{data:{username:'test-person',password:'wrong-password'},ip:'192.0.2.'+(i+1)})).status,401);
 assert.equal((await call('/service/api/login',{data:{username:'test-person',password:'wrong-password'},ip:'192.0.2.90'})).status,429);
 const now=Date.now;try{Date.now=()=>now()+61000;assert.equal((await call('/service/api/login',{data:{username:'test-person',password:'wrong-password'},ip:'192.0.2.90'})).status,401);}finally{Date.now=now;}
});
test('distributed auth ceiling does not lock the owner out of an existing session',async()=>{
 const {call,env}=await setup();const login=await call('/service/api/owner-login',{data:{key:env.OWNER_KEY}}),cookie=login.headers.get('Set-Cookie').split(';')[0];
 for(let i=0;i<60;i++)assert.equal((await call('/service/api/login',{data:{username:'invalid!'},ip:'192.0.2.'+(i+1)})).status,401);
 assert.equal((await call('/service/api/login',{data:{username:'invalid!'},ip:'192.0.2.200'})).status,429);
 assert.equal((await call('/service/api/owner/list',{cookie})).status,200);
});
test('cross-site writes are denied and login cookies have security flags',async()=>{
 const {call,env}=await setup();assert.equal((await call('/service/api/owner-login',{data:{key:env.OWNER_KEY},headers:{Origin:'https://elsewhere.test'}})).status,403);
 assert.equal((await call('/service/api/owner-login',{data:{key:env.OWNER_KEY},headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 const r=await call('/service/api/owner-login',{data:{key:env.OWNER_KEY}}),cookie=r.headers.get('Set-Cookie');for(const flag of ['HttpOnly','Secure','SameSite=Strict'])assert(cookie.includes(flag));assert(!cookie.includes('Domain='));
 assert.equal(r.headers.get('X-Content-Type-Options'),'nosniff');assert.match(r.headers.get('Content-Security-Policy'),/object-src 'none'/);
});
test('tenant isolation, private lookup, upload validation, and payment declaration',async()=>{
 const {call,env,tenants,mod}=await setup();
 const owner=(await call('/service/api/owner-login',{data:{key:env.OWNER_KEY}})).headers.get('Set-Cookie').split(';')[0];
 const users=[];
 for(let i=0;i<2;i++){
  const r=await call('/service/api/register',{ip:'192.0.2.'+(i+2),data:{username:'photographer'+i,password:'synthetic-password',name:'Example',contact:'Example',reason:'Security test'}}),u=(await r.json()).user,cookie=r.headers.get('Set-Cookie').split(';')[0];
  assert.equal((await call('/service/api/owner/review',{cookie:owner,data:{id:u.id,expectedRevision:0,status:'active',quota:{events:20,orders:200,bytes:104857600,notifications:600,requestsPerDay:1000},note:''}})).status,200);users.push({u,cookie});
 }
 const prefix='/t/photographer0',cookie=users[0].cookie,other=users[1].cookie;
 const event={name:'Example event',year:2027,dates:['5月1日'],shootDates:{'5月1日':'2027-05-01'},slots:['12:30-13:00'],price:35,publicConfig:{},requestId:crypto.randomUUID(),expectedActiveId:null};
 const published=await(await call(prefix+'/admin/api/event-publish',{cookie,data:event})).json();assert(published.ok);
 const booking={eventId:published.event.id,date:'5月1日',timeSlot:'12:30-13:00',cn:'Example',phone:'13800138000',character:'Example',requestId:crypto.randomUUID()};
 const created=await(await call(prefix+'/api/order',{data:booking})).json();assert(created.ok);
 assert.equal((await call(prefix+'/admin/api/orders',{cookie:other,data:{}})).status,401);
 assert.equal((await call('/service/api/owner/list',{cookie})).status,403);
 assert.equal((await call(prefix+'/admin/api/orders',{data:{},headers:{'X-Service-Key':env.INTERNAL_KEY,'X-Admin-Key':env.INTERNAL_KEY}})).status,401);
 assert.equal((await call(prefix+'/api/my-orders',{data:{query:booking.phone}})).status,400);
 const store=tenants.get(users[0].u.id).ctx.storage,get=store.get.bind(store),keys=[];store.get=async k=>{keys.push(k);return get(k)};
 const mine=await(await call(prefix+'/api/my-orders',{data:{query:created.id}})).json();assert.equal(mine.orders.length,1);assert.equal(mine.orders[0].phone,undefined);assert.equal(mine.orders[0].payment,undefined);assert(!keys.some(k=>k.endsWith('/orders')),'Lookup must not scan the complete orders list');store.get=get;
 assert.equal((await(await call('/t/photographer1/api/my-orders',{data:{query:created.id}})).json()).orders?.length||0,0);
 assert.equal((await call(prefix+'/api/cancel',{data:{id:created.id,phone:'13800138001'}})).status,403);
 assert.equal((await call(prefix+'/api/paid',{data:{id:created.id,eventId:published.event.id,phone:'13800138001'}})).status,403);
 assert.equal((await call(prefix+'/api/paid',{data:{id:created.id,eventId:published.event.id,phone:booking.phone}})).status,200);
 const orders=await(await call(prefix+'/admin/api/orders',{cookie,data:{}})).json();assert.equal(orders.orders[0].paid,false,'Customer declaration must not mark money received');
 for(const [type,content] of [['image/svg+xml','<svg onload="alert(1)"/>'],['image/png','<html>not an image</html>']]){
  const form=new FormData();form.set('eventId',published.event.id);form.set('order_id',created.id);form.set('phone',booking.phone);form.set('file',new Blob([content],{type}),'example');
  const response=await mod.default.fetch(new Request('https://booking.test'+prefix+'/api/attach',{method:'POST',headers:{Origin:'https://booking.test','CF-Connecting-IP':'192.0.2.10'},body:form}),env);assert.equal(response.status,400);
 }
 const form=new FormData();form.set('eventId',published.event.id);form.set('order_id',created.id);form.set('phone',booking.phone);form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'example.png');
 assert.equal((await mod.default.fetch(new Request('https://booking.test'+prefix+'/api/attach',{method:'POST',headers:{Origin:'https://booking.test','CF-Connecting-IP':'192.0.2.10'},body:form}),env)).status,200);
 assert.equal((await call(prefix+'/api/attach/'+created.id,{cookie:other})).status,401);assert.equal((await call(prefix+'/api/attach/'+created.id)).status,401);
 const image=await call(prefix+'/api/attach/'+created.id,{cookie});assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/png');assert.equal(image.headers.get('X-Content-Type-Options'),'nosniff');
 const watch={revision:0,enabled:true,channel:'webhook',events:['booking'],endpoint:'http://127.0.0.1/',token:'user-supplied-notification-token',chatId:''};
 assert.equal((await call(prefix+'/admin/api/watch-settings',{cookie,data:watch})).status,400);
 assert.equal((await call(prefix+'/admin/api/watch-settings',{cookie,data:{...watch,endpoint:'https://notify.example.org/test-only'}})).status,200,'Generic HTTPS webhook remains available by user decision');
 const originalFetch=global.fetch;let outgoing;
 try{global.fetch=async(url,options)=>{outgoing={url,options};return new Response('{}',{status:200});};assert.equal((await call(prefix+'/admin/api/watch-test',{cookie,data:{revision:1}})).status,200);}finally{global.fetch=originalFetch;}
 assert.equal(outgoing.options.redirect,'error');assert.equal(outgoing.options.headers.Authorization,'Bearer user-supplied-notification-token');assert(!JSON.stringify(outgoing).includes(env.INTERNAL_KEY));assert(!JSON.stringify(outgoing).includes(env.OWNER_KEY));
});
