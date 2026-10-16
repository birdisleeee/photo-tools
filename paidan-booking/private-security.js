// Self-hosted installation boundary. Never embed the administrator credential in HTML or URLs.
const privateCookieName = '__Host-photo_booking_admin';
const privateAdminName=env=>(env.ADMIN_USERNAME||'admin').trim().normalize('NFKC').toLowerCase();
const privateAdminPassword=env=>env.ADMIN_LOGIN_PASSWORD||env.ADMIN_KEY;
const privateSessionTTL = 8 * 60 * 60;
const privateReply = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8',...headers}});
const privateFail = (message, status = 400, extra = {}) => { throw Object.assign(new Error(message), {status,...extra}); };
const privateGuestRoutes = new Map([['/','GET'],['/index.html','GET'],['/favicon.ico','GET'],['/api/event','GET'],['/api/events','GET'],['/api/booked','GET'],['/api/order','POST'],['/api/paid','POST'],['/api/my-orders','POST'],['/api/cancel','POST'],['/api/attach','POST'],['/admin','GET'],['/admin/auth/login','POST'],['/admin/auth/logout','POST']]);
for(const action of ['register','login','logout','recover'])privateGuestRoutes.set('/api/customer/auth/'+action,'POST');
privateGuestRoutes.set('/api/auth/login','POST');privateGuestRoutes.set('/api/auth/me','GET');
privateGuestRoutes.set('/api/customer/auth/me','GET');privateGuestRoutes.set('/api/customer/orders','GET');privateGuestRoutes.set('/api/customer/profile','GET');
privateGuestRoutes.set('/api/customer/claim-search','POST');
for(const action of ['claim','cancel','paid'])privateGuestRoutes.set('/api/customer/'+action,'POST');
const privateAdminPosts = new Set(['events','orders','event-new','event-archive','event-import','release','book','paid-toggle','attach-meta','config','slot','event-publish','order-update','payment-record','records-merge','watch-test','image-storage','customer-search','customer-link']);
const privateProtected = path => path === '/admin' || path.startsWith('/admin/api/') || path.startsWith('/api/attach/');
function privateCookie(request) {
  const match=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)__Host-photo_booking_admin=([a-f0-9]{64})(?:;|$)/);
  return match?.[1] || '';
}
function privateSetCookie(token, age = privateSessionTTL) {
  return privateCookieName+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+age;
}
async function privateHash(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))), b=>b.toString(16).padStart(2,'0')).join('');
}
async function privateKeyMatches(candidate, expected) {
  if(typeof candidate!=='string'||!candidate||candidate.length>512)return false;
  const a=await privateHash(candidate),b=await privateHash(expected);let diff=0;
  for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
function privateSameOrigin(request, required=false) {
  const origin=request.headers.get('Origin');
  if(request.headers.get('Sec-Fetch-Site')==='cross-site'||(origin&&origin!==new URL(request.url).origin)||(required&&!origin))privateFail('请从本站页面操作',403);
}
async function privateReadBytes(request,max) {
  if(Number(request.headers.get('Content-Length')||0)>max)privateFail('提交内容过大',413);
  if(!request.body)return new Uint8Array();
  const reader=request.body.getReader(),chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();privateFail('提交内容过大',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}
export function privateHarden(response) {
  const headers=new Headers(response.headers);
  headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(!headers.has('Content-Security-Policy'))headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
  return new Response(response.body,{status:response.status,headers});
}
export function privateError(error) {
  const status=error.status||500,headers={};
  if(status===429)headers['Retry-After']=String(error.retryAfter||60);
  if(error.allow)headers.Allow=error.allow;
  return privateReply({ok:false,error:status===500?'服务暂时不可用，请稍后再试':error.message},status,headers);
}
export async function privateGuard(request,env) {
  const url=new URL(request.url),path=url.pathname;
  if(url.pathname.length+url.search.length>2048)privateFail('请求地址过长',414);
  // Old bookmarks land on the clean login URL, but query credentials no longer authenticate.
  if(url.searchParams.has('key')){
    if(path==='/admin'&&request.method==='GET')return new Response(null,{status:303,headers:{Location:'/admin'}});
    privateFail('请使用后台登录或请求头认证，网址密钥已停用',400);
  }
  let method=privateGuestRoutes.get(path),max=12000,group='';
  if(path==='/admin/api/watch-settings')method=request.method==='GET'?'GET':'POST';
  else if(path.startsWith('/admin/api/')&&privateAdminPosts.has(path.slice(11)))method='POST';
  else if(/^\/api\/attach\/[a-z0-9-]{1,80}$/i.test(path)){method='GET';group='UPLOAD';}
  if(!method)privateFail('页面不存在',404);
  if(request.method!==method)privateFail('请求方式不支持',405,{allow:method});
  if(path.startsWith('/admin/api/'))max=['/admin/api/payment-record','/admin/api/records-merge','/admin/api/event-import'].includes(path)?8*1024*1024:64000;
  if(path==='/api/attach'){max=6*1024*1024;group='UPLOAD';}
  else if(path==='/admin/auth/login'){max=2048;group='AUTH';}
  else if(['/api/auth/login','/api/customer/auth/login','/api/customer/auth/register','/api/customer/auth/recover'].includes(path)){max=4096;group='CUSTOMER_AUTH';}
  else if(['/api/customer/orders','/api/customer/profile','/api/customer/claim-search'].includes(path))group='QUERY';
  else if(['/api/customer/claim','/api/customer/cancel','/api/customer/paid'].includes(path))group='WRITE';
  else if(path==='/api/my-orders')group='QUERY';
  else if(['/api/order','/api/paid','/api/cancel'].includes(path))group='WRITE';
  // Only the authenticated Durable Object may attach a customer identity.
  const cleanHeaders=new Headers(request.headers);cleanHeaders.delete('X-Customer-Id');request=new Request(request,{headers:cleanHeaders});
  if(method==='POST'){
    privateSameOrigin(request);
    const type=(request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
    if(type!==(path==='/api/attach'?'multipart/form-data':'application/json'))privateFail('提交格式不支持',415);
    if(Number(request.headers.get('Content-Length')||0)>max)privateFail('提交内容过大',413);
  }
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  for(const name of ['PRIVATE_EDGE_RATE',...(group?['PRIVATE_'+group+'_RATE']:[])]){
    if(!env[name])privateFail('入口防护暂不可用',503);
    if(!(await env[name].limit({key:ip})).success)privateFail('操作过于频繁，请一分钟后再试',429);
  }
  if(path==='/favicon.ico')return new Response(null,{status:204});
  if(privateProtected(path)&&!request.headers.get('X-Admin-Key')&&!privateCookie(request)){
    if(path==='/admin')return privateLoginPage();
    return privateReply({ok:false,error:'请先登录管理后台'},401,{'Set-Cookie':privateSetCookie('',0)});
  }
  // Bound the actual body, including chunked requests, before it reaches business storage.
  if(method==='POST'){
    const bytes=await privateReadBytes(request,max),headers=new Headers(request.headers);headers.delete('Content-Length');
    request=new Request(request.url,{method,headers,body:bytes});
  }
  return request;
}
export async function privateAuthorize(request,env,storage) {
  const path=new URL(request.url).pathname;
  if(path==='/api/auth/me'){
    const token=privateCookie(request),record=token?await storage.get('private-auth:s:'+await privateHash(token)):null;
    if(record&&record.expires>Date.now()&&record.keyVersion===await privateHash(env.ADMIN_KEY+'\0'+privateAdminPassword(env)))return privateReply({ok:true,role:'admin',redirect:'/admin'});
    const target=new URL(request.url);target.pathname='/api/customer/auth/me';return new Request(target,request);
  }
  if(path==='/api/auth/login'){
    privateSameOrigin(request,true);let body;try{body=await request.clone().json();}catch{privateFail('登录信息格式无效');}
    const username=typeof body?.username==='string'?body.username.trim().normalize('NFKC').toLowerCase():'';
    if(username!==privateAdminName(env)){const target=new URL(request.url);target.pathname='/api/customer/auth/login';return new Request(target,request);}
  }
  if(path==='/admin/auth/login'||path==='/api/auth/login'){

    privateSameOrigin(request,true);
    let body;try{body=await request.json();}catch{privateFail('登录信息格式无效');}
    // One bounded counter prevents rotating IPs from creating unlimited login attempts/state.
    const now=Date.now();let attempts=await storage.get('private-auth:attempts');
    if(!attempts||attempts.until<=now)attempts={count:0,until:now+60000};
    if(attempts.count>=20)privateFail('登录尝试过多，请稍后再试',429,{retryAfter:Math.ceil((attempts.until-now)/1000)});
    attempts.count++;await storage.put('private-auth:attempts',attempts);
    if(!await privateKeyMatches(body?.password,privateAdminPassword(env)))return privateReply({ok:false,error:'用户名或密码不正确'},401);
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    const hash=await privateHash(token),previous=privateCookie(request),previousHash=previous?await privateHash(previous):'';
    const keyVersion=await privateHash(env.ADMIN_KEY+'\0'+privateAdminPassword(env)),expires=now+privateSessionTTL*1000;
    await storage.transaction(async tx=>{
      const ids=await tx.get('private-auth:sessions')||[],keep=[];
      for(const id of ids){const record=await tx.get('private-auth:s:'+id);if(record&&record.expires>now&&id!==previousHash)keep.push(id);else await tx.delete('private-auth:s:'+id);}
      while(keep.length>=8)await tx.delete('private-auth:s:'+keep.shift());
      await tx.put('private-auth:s:'+hash,{expires,keyVersion});await tx.put('private-auth:sessions',[...keep,hash]);
    });
    return privateReply({ok:true,role:'admin',redirect:'/admin'},200,{'Set-Cookie':privateSetCookie(token)});
  }
  if(path==='/admin/auth/logout'){
    privateSameOrigin(request,true);const token=privateCookie(request);
    if(token){const hash=await privateHash(token);await storage.transaction(async tx=>{await tx.delete('private-auth:s:'+hash);const ids=await tx.get('private-auth:sessions')||[];await tx.put('private-auth:sessions',ids.filter(id=>id!==hash));});}
    return privateReply({ok:true},200,{'Set-Cookie':privateSetCookie('',0)});
  }
  const machineKey=request.headers.get('X-Admin-Key'),token=privateCookie(request);
  // Guest attachment uploads can also be made by the logged-in administrator.
  if(!privateProtected(path)&&path!=='/api/attach')return request;
  if(machineKey){if(await privateKeyMatches(machineKey,env.ADMIN_KEY))return request;return privateReply({ok:false,error:'认证失败'},401);}
  if(!token&&!privateProtected(path))return request;
  const record=token?await storage.get('private-auth:s:'+await privateHash(token)):null;
  if(!record||record.expires<=Date.now()||record.keyVersion!==await privateHash(env.ADMIN_KEY+'\0'+privateAdminPassword(env))){
    if(path==='/admin')return privateLoginPage();
    return privateReply({ok:false,error:'登录已失效，请重新登录'},401,{'Set-Cookie':privateSetCookie('',0)});
  }
  if(request.method!=='GET')privateSameOrigin(request,true);
  // Only server-side code adds this header after validating the session.
  const headers=new Headers(request.headers);headers.set('X-Admin-Key',env.ADMIN_KEY);
  return new Request(request,{headers});
}
function privateLoginPage() {
  return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':privateSetCookie('',0)}});
}
