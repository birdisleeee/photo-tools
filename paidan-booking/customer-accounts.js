// Customer identities are separate from the administrator and from contact phone numbers.
const customerTTL=30*86400,customerPrefix='customer-auth:',customerCookie='__Host-photo_booking_customer';
const customerJSON=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}});
const customerHex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const customerRandom=n=>customerHex(crypto.getRandomValues(new Uint8Array(n)));
const customerHash=async value=>customerHex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const customerCookieHeader=(token,age=customerTTL)=>customerCookie+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+age;
function customerToken(request){return (request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-photo_booking_customer=([a-f0-9]{64})(?:;|$)/)?.[1]||'';}
function customerOrigin(request){if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('Sec-Fetch-Site')==='cross-site')throw Object.assign(Error('请从本站页面操作'),{status:403});}
function customerUsername(value){return typeof value==='string'?value.trim().normalize('NFKC').toLowerCase():'';}
const customerValidUsername=value=>/^[\p{Script=Han}a-z][\p{Script=Han}a-z0-9_]{1,23}$/u.test(value);
const customerValidPassword=value=>typeof value==='string'&&Array.from(value).length>=12&&value.length<=128;
async function customerPassword(password,salt,secret){
 const pepper=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const input=await crypto.subtle.sign('HMAC',pepper,new TextEncoder().encode(password));
 const key=await crypto.subtle.importKey('raw',input,'PBKDF2',false,['deriveBits']);
 return customerHex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256));
}
function customerEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
async function customerBudget(storage,name,max,period){const now=Date.now(),key=customerPrefix+'limit:'+name;let c=await storage.get(key);if(!c||c.until<=now)c={count:0,until:now+period};if(c.count>=max)throw Object.assign(Error('操作过于频繁，请稍后再试'),{status:429,retryAfter:Math.ceil((c.until-now)/1000)});await storage.put(key,{...c,count:c.count+1});}
async function customerSession(request,storage){
 const token=customerToken(request);if(!token)return null;
 const session=await storage.get(customerPrefix+'s:'+await customerHash(token));if(!session||session.expires<=Date.now())return null;
 const user=await storage.get(customerPrefix+'u:'+session.userId);if(!user||user.version!==session.version)return null;return user;
}
async function customerLoginCookie(storage,user,previous='',change=null){
 const token=customerRandom(32),hash=await customerHash(token),prior=previous?await customerHash(previous):'',now=Date.now();
 await storage.transaction(async tx=>{
  if(change?.register){if(await tx.get(change.nameKey))throw Object.assign(Error('这个用户名暂不可用'),{status:409});await tx.put(change.nameKey,user.id);await tx.put(customerPrefix+'u:'+user.id,user);}
  if(change?.recover){const current=await tx.get(customerPrefix+'u:'+user.id);if(!current||current.version!==user.version-1)throw Object.assign(Error('账号已更新，请重新操作'),{status:409});await tx.put(customerPrefix+'u:'+user.id,user);}
  const ids=await tx.get(customerPrefix+'sessions:'+user.id)||[],keep=[];
  for(const id of ids){const s=await tx.get(customerPrefix+'s:'+id);if(s&&s.expires>now&&s.version===user.version&&id!==prior)keep.push(id);else await tx.delete(customerPrefix+'s:'+id);}
  while(keep.length>=5)await tx.delete(customerPrefix+'s:'+keep.shift());
  await tx.put(customerPrefix+'s:'+hash,{userId:user.id,version:user.version,expires:now+customerTTL*1000});await tx.put(customerPrefix+'sessions:'+user.id,[...keep,hash]);
 });return customerCookieHeader(token);
}
export async function customerAuthorize(request,env,storage){
 const path=new URL(request.url).pathname,auth=path.startsWith('/api/customer/auth/');
 if(['/admin/api/customer-search','/admin/api/customer-link'].includes(path)){
  if(request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return customerJSON({ok:false,error:'unauthorized'},401);
  let data;try{data=await request.clone().json();}catch{return customerJSON({ok:false,error:'提交格式无效'},400);}if(!data||typeof data!=='object')return customerJSON({ok:false,error:'提交格式无效'},400);
  if(path.endsWith('/customer-search')){
   const query=customerUsername(data.query);if(!query||query.length>24)return customerJSON({ok:false,error:'请输入客妹的注册用户名'},400);
   const entries=await storage.list({prefix:customerPrefix+'name:'+query,limit:20}),users=[];
   for(const id of entries.values()){const user=await storage.get(customerPrefix+'u:'+id);if(user)users.push({id:user.id,username:user.username});}
   return customerJSON({ok:true,users});
  }
  if(typeof data.customerId!=='string'||!await storage.get(customerPrefix+'u:'+data.customerId))return customerJSON({ok:false,error:'请选择已经注册的客妹账号'},400);
  return request;
 }
 const need=path.startsWith('/api/customer/')||['/api/order','/api/paid','/api/my-orders','/api/cancel','/api/attach'].includes(path);
 if(!auth&&!need)return request;
 if(!env.CUSTOMER_SECRET)return customerJSON({ok:false,error:'客人账号服务尚未配置'},503);
 if(auth){
  if(path==='/api/customer/auth/me'){const user=await customerSession(request,storage);return customerJSON({ok:true,user:user?{id:user.id,username:user.username}:null});}
  customerOrigin(request);let data;try{data=await request.json();}catch{return customerJSON({ok:false,error:'提交格式无效'},400);}
  if(path==='/api/customer/auth/logout'){
   const token=customerToken(request);if(token){const hash=await customerHash(token),record=await storage.get(customerPrefix+'s:'+hash);await storage.transaction(async tx=>{await tx.delete(customerPrefix+'s:'+hash);if(record){const ids=await tx.get(customerPrefix+'sessions:'+record.userId)||[];await tx.put(customerPrefix+'sessions:'+record.userId,ids.filter(id=>id!==hash));}});}
   return customerJSON({ok:true},200,{'Set-Cookie':customerCookieHeader('',0)});
  }
  // Fixed global counters keep distributed login/registration attempts bounded.
  await customerBudget(storage,'auth',30,60000);
  const username=customerUsername(data?.username);
  if(!customerValidUsername(username))return customerJSON({ok:false,error:'用户名为 2–24 位中文、字母、数字或下划线，以中文或字母开头'},400);
  const nameKey=customerPrefix+'name:'+username,id=await storage.get(nameKey),user=id?await storage.get(customerPrefix+'u:'+id):null;
  if(path==='/api/customer/auth/register'){
   if(username===customerUsername(env.ADMIN_USERNAME||'admin'))return customerJSON({ok:false,error:'这个用户名暂不可用，请更换'},409);
   await customerBudget(storage,'register',30,3600000);
   if(user)return customerJSON({ok:false,error:'这个用户名暂不可用，请更换'},409);
   if(!customerValidPassword(data.password))return customerJSON({ok:false,error:'请设置至少 12 个字符、最多 128 字符的密码'},400);
   const salt=customerRandom(16),recoveryCode=customerRandom(24),newUser={id:customerRandom(16),username,salt,password:await customerPassword(data.password,salt,env.CUSTOMER_SECRET),recoveryHash:await customerHash(recoveryCode),version:1,createdAt:new Date().toISOString()};
   return customerJSON({ok:true,user:{id:newUser.id,username},recoveryCode},200,{'Set-Cookie':await customerLoginCookie(storage,newUser,customerToken(request),{register:true,nameKey})});
  }
  if(path==='/api/customer/auth/recover'){
   const valid=typeof data.recoveryCode==='string'&&/^[a-f0-9]{48}$/i.test(data.recoveryCode.trim());
   const hash=await customerHash(valid?data.recoveryCode.trim().toLowerCase():'invalid');
   if(!user||!valid||!customerEqual(user.recoveryHash,hash))return customerJSON({ok:false,error:'用户名或恢复码不正确'},403);
   if(!customerValidPassword(data.password))return customerJSON({ok:false,error:'新密码至少 12 个字符，最多 128 字符'},400);
   const recoveryCode=customerRandom(24),salt=customerRandom(16),next={...user,salt,password:await customerPassword(data.password,salt,env.CUSTOMER_SECRET),recoveryHash:await customerHash(recoveryCode),version:user.version+1};
   return customerJSON({ok:true,user:{id:next.id,username},recoveryCode},200,{'Set-Cookie':await customerLoginCookie(storage,next,customerToken(request),{recover:true})});
  }
  if(path==='/api/customer/auth/login'){
   if(typeof data.password!=='string'||data.password.length>128)return customerJSON({ok:false,error:'用户名或密码不正确'},401);
   // The same KDF is performed for an unknown name; there is no phone lookup or recovery shortcut.
   const hash=await customerPassword(data.password,user?.salt||'00000000000000000000000000000000',env.CUSTOMER_SECRET);
   if(!user||!customerEqual(user.password,hash))return customerJSON({ok:false,error:'用户名或密码不正确'},401);
   return customerJSON({ok:true,user:{id:user.id,username}},200,{'Set-Cookie':await customerLoginCookie(storage,user,customerToken(request))});
  }
  return customerJSON({ok:false,error:'接口不存在'},404);
 }
 if(!need)return request;
 const user=await customerSession(request,storage);
 if(!user){
  if(request.headers.get('X-Admin-Key')===env.ADMIN_KEY)return request;
  return customerJSON({ok:false,error:'请先登录客人账号'},401,{'Set-Cookie':customerCookieHeader('',0)});
 }
 if(request.method!=='GET')customerOrigin(request);
 if(path==='/api/customer/claim-search'){await customerBudget(storage,'claim-search-global',30,60000);await customerBudget(storage,'claim-search:'+user.id,8,60000);}
 if(path==='/api/customer/claim'){await customerBudget(storage,'claim-global',30,60000);await customerBudget(storage,'claim:'+user.id,10,60000);}
 const headers=new Headers(request.headers);headers.set('X-Customer-Id',user.id);return new Request(request,{headers});
}

// Called with the same transactional storage adapter as bookings. Ownership and its index commit together.
export async function customerBusiness(request,env){
 const url=new URL(request.url),path=url.pathname,uid=request.headers.get('X-Customer-Id');
 if(path==='/admin/api/customer-link'){
  if(request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return customerJSON({ok:false,error:'unauthorized'},401);
  const data=await request.json(),read=async(k,f=null)=>{const v=await env.PAIDAN_KV.get(k);return v===null?f:JSON.parse(v);},write=(k,v)=>env.PAIDAN_KV.put(k,JSON.stringify(v));
  if(data.confirmed!==true||!Array.isArray(data.targets)||!data.targets.length||data.targets.length>50)return customerJSON({ok:false,error:'请选择预约并二次确认'},400);
  const events=await read('events',[]),lists=new Map(),indexes=new Map(),seen=new Set();
  const index=async id=>{if(!indexes.has(id))indexes.set(id,await read('customer-orders:'+id,[]));return indexes.get(id);};
  for(const ref of data.targets){
   if(!ref||!['record','order'].includes(ref.kind)||typeof ref.eventId!=='string')return customerJSON({ok:false,error:'预约选择无效'},400);
   const isRecord=ref.kind==='record',key='e:'+ref.eventId+'/'+(isRecord?'records':'o:'+ref.id),identity=ref.eventId+':'+(isRecord?'record-'+ref.recordIndex:ref.id);
   if(seen.has(identity)||!events.some(e=>e.id===ref.eventId)||isRecord&&(!Number.isInteger(ref.recordIndex)||ref.recordIndex<0)||!isRecord&&!/^[a-z0-9]{8,16}$/.test(ref.id||''))return customerJSON({ok:false,error:'预约选择无效'},400);seen.add(identity);
   let order;if(isRecord){if(!lists.has(key))lists.set(key,await read(key,[]));order=lists.get(key)[ref.recordIndex];}else order=await read(key);
   if(order?.cancelled)return customerJSON({ok:false,error:'已取消的预约不能新增关联，请刷新列表'},409);
   if(!order||JSON.stringify([order.cn,order.character,order.date,isRecord?order.time:order.timeSlot,order.customerId||null])!==JSON.stringify(ref.expected))return customerJSON({ok:false,error:'预约已更新，请刷新后重新关联'},409);
   const id=isRecord?'record-'+ref.recordIndex:ref.id,matches=r=>r.eventId===ref.eventId&&r.id===id&&(r.kind||'order')===(isRecord?'record':'order');
   if(order.customerId&&order.customerId!==data.customerId){const old=await index(order.customerId);indexes.set(order.customerId,old.filter(r=>!matches(r)));}
   const next=await index(data.customerId);if(!next.some(matches))next.unshift({eventId:ref.eventId,id,...(isRecord?{kind:'record',recordIndex:ref.recordIndex}:{})});
   await write('e:'+ref.eventId+'/audit:'+crypto.randomUUID(),{at:new Date().toISOString(),action:'customer-link',id,beforeCustomerId:order.customerId||null,customerId:data.customerId});
   order.customerId=data.customerId;delete order.customerAccess;
   if(!isRecord)await write(key,order);
  }
  for(const [k,v] of lists)await write(k,v);for(const [id,v] of indexes)await write('customer-orders:'+id,v);
  return customerJSON({ok:true,linked:data.targets.length});
 }
 if(!path.startsWith('/api/customer/')||path.startsWith('/api/customer/auth/'))return null;
 if(!uid)return customerJSON({ok:false,error:'请先登录客人账号'},401);
 const read=async(key,fallback=null)=>{const value=await env.PAIDAN_KV.get(key);return value===null?fallback:JSON.parse(value);};
 const write=(key,value)=>env.PAIDAN_KV.put(key,JSON.stringify(value));
 const events=await read('events',[]),indexKey='customer-orders:'+uid,refs=await read(indexKey,[]);
 // Profiles share the booking transaction. Existing accounts fall back only to their own indexed orders.
 if(path==='/api/customer/profile'){
  const saved=await read('customer-profile:'+uid);
  if(saved)return customerJSON({ok:true,profile:{cn:saved.cn||'',phone:saved.phone||''}});
  for(const ref of refs){const order=ref.kind==='record'?(await read('e:'+ref.eventId+'/records',[]))[ref.recordIndex]:await read('e:'+ref.eventId+'/o:'+ref.id);if(order?.customerId===uid&&order.customerAccess!=='limited')return customerJSON({ok:true,profile:{cn:order.cn||'',phone:order.phone||''}});}
  return customerJSON({ok:true,profile:{cn:'',phone:''}});
 }
 if(path==='/api/customer/orders'){
  const eventFilter=url.searchParams.get('eventId'),filtered=eventFilter?refs.filter(r=>r.eventId===eventFilter):refs;
  const cursor=Number(url.searchParams.get('cursor')||0);if(!Number.isSafeInteger(cursor)||cursor<0||cursor>filtered.length)return customerJSON({ok:false,error:'页码无效'},400);
  const list=[],recordLists=new Map();for(const ref of filtered.slice(cursor,cursor+25)){let order;if(ref.kind==='record'){if(!recordLists.has(ref.eventId))recordLists.set(ref.eventId,await read('e:'+ref.eventId+'/records',[]));order=recordLists.get(ref.eventId)[ref.recordIndex];}else order=await read('e:'+ref.eventId+'/o:'+ref.id);if(!order||order.customerId!==uid)continue;const event=events.find(e=>e.id===ref.eventId);if(order.customerAccess==='limited'){list.push({id:'linked-'+(await customerHash(uid+':'+ref.eventId+':'+ref.id)).slice(0,16),limited:true,isRecord:ref.kind==='record',eventId:ref.eventId,eventName:event?.name||'历史拍摄',cn:order.cn,character:order.character});continue;}list.push({id:ref.kind==='record'?'record-'+ref.recordIndex:order.id,isRecord:ref.kind==='record',eventId:ref.eventId,eventName:event?.name||'历史拍摄',eventStatus:event?.status||'archived',date:order.date,timeSlot:ref.kind==='record'?order.time:order.timeSlot,cn:order.cn,character:order.character,remark:order.remark,paid:order.paid,cancelled:!!order.cancelled,paymentReportedAt:order.paymentReportedAt||null,createdAt:order.createdAt,payment:order.payment?{mode:order.payment.mode,status:order.payment.status,amount:order.payment.amount,updatedAt:order.payment.updatedAt}:null});}
  return customerJSON({ok:true,orders:list,total:filtered.length,nextCursor:cursor+25<filtered.length?cursor+25:null,events:events.filter(e=>refs.some(r=>r.eventId===e.id)).map(e=>({id:e.id,name:e.name}))});
 }
 let data;try{data=await request.json();}catch{return customerJSON({ok:false,error:'提交格式无效'},400);}
 // Search is exact CN across events, with optional original phone/order filters. Results contain no phone,
 // order number, notes, payment details, owner id, or attachment data.
 const normalizeCN=v=>typeof v==='string'?v.trim().normalize('NFKC').toLowerCase():'';
 const fingerprint=o=>customerHash(JSON.stringify([normalizeCN(o.cn),o.phone,o.date,o.timeSlot??o.time,o.character,!!o.cancelled]));
 const ticketKey='customer-claim-search:'+uid;
 if(path==='/api/customer/claim-search'){
  const cn=normalizeCN(data.cn),phone=typeof data.phone==='string'?data.phone.trim():'',id=typeof data.id==='string'?data.id.trim().toLowerCase():'';
  if(!cn||cn.length>30||phone&&!/^1[3-9]\d{9}$/.test(phone)||id&&!/^[a-z0-9]{8,16}$/.test(id))return customerJSON({ok:false,error:'请填写 CN；手机号和订单号可选填，填写时请核对格式'},400);
  const results=[],targets=[];let scanned=0,truncated=false;
  async function match(order,event,ref){
   if(!order||order.cancelled||normalizeCN(order.cn)!==cn||phone&&order.phone!==phone)return;
   if(results.length>=50){truncated=true;return;}
   const token=customerRandom(16),linked=!!order.customerId;
   results.push({token,eventName:event.name,cn:order.cn,character:order.character||'未填写角色',linked});
   targets.push({...ref,eventId:event.id,token,fingerprint:await fingerprint(order)});
  }
  for(const event of events){
   if(id){const order=await read('e:'+event.id+'/o:'+id);if(order)await match(order,event,{id});continue;}
   const ids=await read('e:'+event.id+'/orders',[]);
   for(const orderId of ids){if(++scanned>2000){truncated=true;break;}await match(await read('e:'+event.id+'/o:'+orderId),event,{id:orderId});}
   if(scanned>2000)break;
   const records=await read('e:'+event.id+'/records',[]);
   for(let i=0;i<records.length;i++){if(++scanned>2000){truncated=true;break;}await match(records[i],event,{kind:'record',recordIndex:i,id:'record-'+i});}
   if(scanned>2000)break;
  }
  const searchId=customerRandom(16),expiresAt=Date.now()+5*60000;
  await write(ticketKey,{searchId,expiresAt,targets,verified:!!(phone||id)});return customerJSON({ok:true,searchId,expiresAt,results,truncated});
 }
 if(path==='/api/customer/claim'&&Array.isArray(data.selection)){
  const ticket=await read(ticketKey),selection=data.selection;
  if(data.confirmed!==true||!selection.length||selection.length>50||new Set(selection).size!==selection.length||selection.some(t=>typeof t!=='string'||!/^[a-f0-9]{32}$/.test(t)))return customerJSON({ok:false,error:'请选择预约并确认关联'},400);
  if(!ticket||ticket.searchId!==data.searchId||ticket.expiresAt<Date.now())return customerJSON({ok:false,error:'搜索结果已过期，请重新搜索'},409);
  const updatedRefs=[...refs],recordsByEvent=new Map();let linked=0,alreadyLinked=0;
  for(const token of selection){
   const ref=ticket.targets.find(t=>t.token===token);if(!ref)return customerJSON({ok:false,error:'搜索结果不匹配，请重新搜索'},409);
   let order,key;if(ref.kind==='record'){key='e:'+ref.eventId+'/records';if(!recordsByEvent.has(key))recordsByEvent.set(key,await read(key,[]));order=recordsByEvent.get(key)[ref.recordIndex];}else{key='e:'+ref.eventId+'/o:'+ref.id;order=await read(key);}
   if(!order||order.cancelled||await fingerprint(order)!==ref.fingerprint||order.customerId&&order.customerId!==uid)return customerJSON({ok:false,error:'预约已更新、已取消或已关联，请重新搜索'},409);
   if(order.customerId===uid){alreadyLinked++;continue;}
   order.customerId=uid;if(!ticket.verified)order.customerAccess='limited';else delete order.customerAccess;
   if(ref.kind!=='record')await write(key,order);
   if(!updatedRefs.some(r=>r.eventId===ref.eventId&&r.id===ref.id&&(r.kind||'order')===(ref.kind||'order')))updatedRefs.unshift({eventId:ref.eventId,id:ref.id,...(ref.kind==='record'?{kind:'record',recordIndex:ref.recordIndex}:{})});
   linked++;
  }
  for(const [key,records] of recordsByEvent)await write(key,records);
  if(linked)await write(indexKey,updatedRefs);
  return customerJSON({ok:true,linked,alreadyLinked});
 }
 const event=events.find(e=>e.id===data?.eventId),id=typeof data?.id==='string'?data.id.trim().toLowerCase():'';
 if(!event||!/^[a-z0-9]{8,16}$/.test(id))return customerJSON({ok:false,error:'预约信息不正确'},400);
 const key='e:'+event.id+'/o:'+id,order=await read(key);
 if(path==='/api/customer/claim'){
  if(order?.cancelled)return customerJSON({ok:false,error:'已取消的预约不能新增关联'},409);
  if(!/^1[3-9]\d{9}$/.test(data.phone||'')||!order||order.phone!==data.phone||(order.customerId&&order.customerId!==uid))return customerJSON({ok:false,error:'订单号或原预约手机号不正确，或订单已关联其他账号'},403);
  if(!order.customerId||order.customerAccess==='limited'){order.customerId=uid;delete order.customerAccess;await write(key,order);}
  if(!refs.some(r=>r.id===id&&r.eventId===event.id)){refs.unshift({id,eventId:event.id});await write(indexKey,refs);}
  return customerJSON({ok:true});
 }
 if(!order||order.customerId!==uid)return customerJSON({ok:false,error:'无法操作这条预约'},403);
 if(order.customerAccess==='limited')return customerJSON({ok:false,error:'CN 关联只展示基本信息，请联系摄影师确认后操作'},403);
 if(path==='/api/customer/cancel'&&event.status!=='active')return customerJSON({ok:false,error:'归档场次仅供查看，请联系摄影师处理'},409);
 if(!['/api/customer/cancel','/api/customer/paid'].includes(path))return customerJSON({ok:false,error:'接口不存在'},404);
 const target=new URL(request.url);target.pathname=path.endsWith('/cancel')?'/api/cancel':'/api/paid';
 const headers=new Headers(request.headers);headers.set('Content-Type','application/json');
 return new Request(target,{method:'POST',headers,body:JSON.stringify({id,eventId:event.id,phone:order.phone})});
}
