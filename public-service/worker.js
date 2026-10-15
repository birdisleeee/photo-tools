import APP_HTML from './app.html';
import INDEX_HTML from './core/index.html';
import ADMIN_HTML from './core/admin.html';
import {Registry} from './registry.js';
import {TenantStore} from './tenant.js';
import {json,bad,digest,limitedBody,checkOrigin,harden} from './security.js';
import {classifyEntry,limitEntry} from './entry-guard.js';
export {Registry,TenantStore};
const html=s=>new Response(s,{headers:{'Content-Type':'text/html; charset=utf-8'}});
function page(source,slug,admin){
 const prefix='/t/'+slug;
 let s=source.replace(/(['"])\/(api(?:\/|\?|['"])|admin(?:\/|\?|['"])|\?event-preview)/g,(_,q,rest)=>q+prefix+'/'+rest);
 s=s.replace("const KEY = new URLSearchParams(location.search).get('key') || '';","const KEY = 'session';");
 const inject=`<style>.service-toolbar{position:fixed;right:14px;bottom:14px;z-index:250;display:flex;gap:8px;flex-wrap:wrap;background:#f7f4fcf0;border:1px solid #ded7e9;border-radius:16px;padding:8px;font:13px sans-serif}.service-toolbar a{color:#63556f;text-decoration:none;padding:8px}.ui-locked .service-toolbar{display:none}@media(max-width:899px){.service-toolbar{bottom:8px;right:8px;font-size:12px}}</style><div class="service-toolbar"><a href="/app">账户与额度</a>${admin?`<a data-booking-link="${prefix}/" href="${prefix}/" target="_blank" rel="noopener">客人预约链接 ↗</a><button style="border:0;background:transparent;color:#63556f" onclick="navigator.clipboard.writeText(location.origin+${JSON.stringify(prefix+'/')}).then(()=>{this.textContent='已复制预约链接'}).catch(()=>{prompt('复制预约链接',location.origin+${JSON.stringify(prefix+'/')})})">复制链接</button>`:''}</div>`;
 const proofScript=admin?`<script>
async function hostedProof(item){if(!item.payment?.proof?.remote)return item;const r=await fetch(${JSON.stringify(prefix+'/admin/api/payment-proof')}+'?'+new URLSearchParams({ev:currentViewEvent().id}),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id})});const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'凭证读取失败');return {...item,payment:{...item.payment,proof:j.proof}};}
const hostedDetail=showDetail,hostedPayment=editPayment;
showDetail=async function(item){try{hostedDetail(await hostedProof(item));}catch(e){alert(e.message)}};
editPayment=async function(item,isRecord=false){try{hostedPayment(await hostedProof(item),isRecord);}catch(e){alert(e.message)}};
</script>`:'';
return s.replace('</body>',inject+proofScript+'</body>');
}
export default {
 async fetch(request,env){
  try{
   if(!env.INTERNAL_KEY||!env.OWNER_KEY)return harden(json({ok:false,error:'公共服务尚未配置'},503));checkOrigin(request);
   const url=new URL(request.url),path=url.pathname;
   if(env.EDGE_RATE){const result=await env.EDGE_RATE.limit({key:request.headers.get('CF-Connecting-IP')||'unknown'});if(!result.success)return harden(json({ok:false,error:'访问过于频繁，请稍后再试'},429));}
   const entry=classifyEntry(request);
   await limitEntry(env,request.headers.get('CF-Connecting-IP')||'unknown',entry.group);
   if(path==='/health')return harden(json({ok:true,service:'photo-booking-public',version:'1.0.0'}));
   if(path==='/favicon.ico')return new Response(null,{status:204});
   if(path==='/download/app.apk'&&request.method==='GET'){const bytes=await env.PUBLIC_META.get('android:apk',{type:'arrayBuffer'});return bytes?new Response(bytes,{headers:{'Content-Type':'application/vnd.android.package-archive','Content-Disposition':'attachment; filename=photo-booking-public.apk','Cache-Control':'public, max-age=3600'}}):json({ok:false,error:'安装包尚未发布'},404);}
   if(request.method==='GET'&&['/','/app','/owner'].includes(path))return harden(html(APP_HTML));
   const registry=env.REGISTRY.get(env.REGISTRY.idFromName('registry-v1'));
   const headers=new Headers(request.headers);headers.delete('X-Admin-Key');headers.delete('X-Service-Key');headers.delete('X-Ip-Hash');headers.set('X-Service-Key',env.INTERNAL_KEY);headers.set('X-Ip-Hash',await digest(env.INTERNAL_KEY+':'+(request.headers.get('CF-Connecting-IP')||'local')));
   const proxy=async(path,body)=>registry.fetch(new Request(url.origin+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:body}));
   if(path==='/service/api/owner-login')return harden(await proxy('/internal/owner-login',await limitedBody(request,12000)));
   const ownerRoute=path.startsWith('/service/api/owner/')||['/service/api/me','/service/api/logout'].includes(path);
   if(!ownerRoute){const admit=await proxy('/internal/admit');if(!admit.ok)return harden(admit);}
   if(path.startsWith('/service/api/')){
    let r=await proxy(path,request.method==='GET'?undefined:await limitedBody(request,12000));
    if(path==='/service/api/me'&&r.ok){const d=await r.clone().json();if(!d.owner){const admitted=await proxy('/internal/admit');if(!admitted.ok)return harden(admitted);}if(d.user?.status==='active'){const stub=env.TENANTS.get(env.TENANTS.idFromName(d.user.id));const usage=await stub.fetch(new Request(url.origin+'/service/usage',{headers}));if(usage.ok)d.accountUsage=await usage.json();r=json(d);}}
    return harden(r);
   }
   const match=path.match(/^\/t\/([a-z][a-z0-9_-]{3,23})(\/.*)?$/);if(!match)bad('页面不存在',404);const slug=match[1],localPath=match[2]||'/',admin=localPath.startsWith('/admin')||(localPath.startsWith('/api/attach/')||localPath==='/api/attach'&&url.searchParams.has('key'));
   const resolution=await proxy('/internal/resolve?'+new URLSearchParams({slug,admin:admin?'1':'0'}));if(!resolution.ok)return harden(resolution);const {user}=await resolution.json();
   if(request.method==='GET'&&(localPath==='/'||localPath==='/index.html'||localPath==='/admin'))return harden(html(page(localPath==='/admin'?ADMIN_HTML:INDEX_HTML,slug,localPath==='/admin')));
   if(!localPath.startsWith('/api/')&&!localPath.startsWith('/admin/api/'))bad('页面不存在',404);
   // Scope is derived from the URL and verified session, never from client-provided tenant IDs or admin keys.
   const internalUrl=new URL(request.url);internalUrl.pathname=localPath;internalUrl.searchParams.delete('key');if(admin){headers.set('X-Admin-Key',env.INTERNAL_KEY);internalUrl.searchParams.set('key',env.INTERNAL_KEY);}headers.delete('Content-Length');
   const body=request.method==='GET'||request.method==='HEAD'?undefined:await limitedBody(request,entry.maxBody);
   const stub=env.TENANTS.get(env.TENANTS.idFromName(user.id));return harden(await stub.fetch(new Request(internalUrl,{method:request.method,headers,body})));
  }catch(e){return harden(json({ok:false,error:e.status?e.message:'公共服务暂时不可用'},e.status||500,e.allow?{Allow:e.allow}:{}));}
 }
};
