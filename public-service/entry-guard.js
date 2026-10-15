import {bad,cookies} from './security.js';

// Reject unknown routes and cheap malformed requests before touching a Durable Object.
const serviceMethods=new Map([
 ['/service/api/register','POST'],['/service/api/login','POST'],['/service/api/owner-login','POST'],
 ['/service/api/logout','POST'],['/service/api/me','GET'],['/service/api/quota-request','POST'],
 ['/service/api/owner/list','GET'],['/service/api/owner/policy','POST'],['/service/api/owner/review','POST'],
 ['/service/api/owner/remove-application','POST'],['/service/api/owner/revoke-owner-sessions','POST'],
]);
const guestMethods=new Map([['/api/event','GET'],['/api/events','GET'],['/api/booked','GET'],
 ['/api/order','POST'],['/api/paid','POST'],['/api/my-orders','POST'],['/api/cancel','POST'],['/api/attach','POST']]);
const adminPosts=new Set(['events','orders','event-publish','event-archive','release','book','paid-toggle',
 'attach-meta','config','slot','payment-proof','order-update','payment-record','watch-test']);
const unavailable=new Set(['event-new','event-import','records-merge','mark-paid']);
export function classifyEntry(request){
 const url=new URL(request.url),path=url.pathname;
 if(url.pathname.length+url.search.length>2048)bad('请求地址过长',414);
 let method,group='',maxBody=12000;
 if(['/','/app','/owner','/health','/favicon.ico'].includes(path))method='GET';
 else if(path==='/download/app.apk'){method='GET';group='download';}
 else if(serviceMethods.has(path)){method=serviceMethods.get(path);if(['/service/api/register','/service/api/login','/service/api/owner-login'].includes(path))group='auth';}
 else{
  const match=path.match(/^\/t\/[a-z][a-z0-9_-]{3,23}(\/.*)?$/);if(!match)bad('页面不存在',404);
  const local=match[1]||'/';
  if(['/','/index.html','/admin'].includes(local))method='GET';
  else if(guestMethods.has(local)){
   method=guestMethods.get(local);group=local==='/api/my-orders'?'query':method==='POST'?'write':'';
   if(local==='/api/attach')maxBody=8*1024*1024;
  }else if(/^\/api\/attach\/[a-z0-9-]{1,80}$/i.test(local))method='GET';
  else if(local==='/admin/api/watch-settings'){method=request.method==='GET'?'GET':'POST';}
  else if(local.startsWith('/admin/api/')){
   const action=local.slice('/admin/api/'.length);if(unavailable.has(action))bad('公共服务不开放该接口',403);
   if(!adminPosts.has(action))bad('页面不存在',404);method='POST';maxBody=action==='payment-record'?8*1024*1024:64000;
  }else bad('页面不存在',404);
 }
 if(request.method!==method)throw Object.assign(Error('请求方式不支持'),{status:405,allow:method});
 if(method==='POST'){
  const type=(request.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  const expected=path.endsWith('/api/attach')?'multipart/form-data':'application/json';
  if(type!==expected)bad('提交格式不支持',415);
  if(Number(request.headers.get('Content-Length')||0)>maxBody)bad('提交内容过大',413);
 }
 // This is only a cheap rejection. A syntactically valid cookie still needs server-side authorization.
 const owner=path.startsWith('/service/api/owner/');
 const member=['/service/api/me','/service/api/quota-request'].includes(path)||/^\/t\/[^/]+\/(admin(?:\/|$)|api\/attach\/)/.test(path);
 if((owner||member)&&! /^[a-f0-9]{64}$/.test(cookies(request).pb_session||''))bad(owner?'仅运营者可操作':'请先登录',owner?403:401);
 return {group,maxBody};
}
const bindings={auth:'ENTRY_AUTH_RATE',query:'ENTRY_QUERY_RATE',write:'ENTRY_WRITE_RATE',download:'ENTRY_DOWNLOAD_RATE'};
export async function limitEntry(env,ip,group){
 const binding=bindings[group];if(!binding)return;
 // Production has EDGE_RATE. Missing the narrower limiter must not silently disable it.
 if(!env[binding]){if(env.EDGE_RATE)bad('入口防护暂不可用，请稍后再试',503);return;}
 const result=await env[binding].limit({key:ip});
 if(!result.success)bad('操作过于频繁，请一分钟后再试',429);
}
