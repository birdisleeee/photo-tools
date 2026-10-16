// Synthetic credentials only. Shared UI does not merge client and admin privileges.
const assert=require('node:assert/strict'),path=require('node:path'),{setup}=require('./harness.cjs');
(async()=>{
 const {raw,env,storage}=await setup(process.env.CLAIM_TEST_SOURCE?{sourceRoot:path.resolve(process.env.CLAIM_TEST_SOURCE)}:{});
 env.ADMIN_LOGIN_PASSWORD='synthetic-browser-login';
 const call=async(p,d,cookie='',headers={})=>{const r=await raw(p,d,{Origin:'http://127.0.0.1:8151',...(cookie?{Cookie:cookie}:{}),...headers});return {status:r.status,cookie:r.headers.get('Set-Cookie')?.split(';')[0],...await r.json()};};
 const redirect=await raw('/admin');assert.equal(redirect.status,303);assert.equal(redirect.headers.get('Location'),'/');
 assert.equal((await call('/api/auth/me')).user,null);
 assert.equal((await call('/api/auth/login',{username:'admin',password:env.ADMIN_KEY})).status,401,'Machine key is independent of browser password');
 assert.equal((await call('/api/auth/login',{username:'admin',password:'wrong'})).status,401);
 assert.equal((await raw('/api/auth/login',{username:'admin',password:env.ADMIN_LOGIN_PASSWORD},{Origin:'https://evil.example'})).status,403);
 assert.equal((await call('/api/customer/auth/register',{username:'ADMIN',password:'synthetic-client-password'})).status,409,'Reserved operator name cannot become a guest');
 const admin=await call('/api/auth/login',{username:' ＡＤＭＩＮ ',password:env.ADMIN_LOGIN_PASSWORD});assert.equal(admin.role,'admin');assert.equal(admin.redirect,'/admin');assert.match(admin.cookie,/__Host-.*_admin=/);
 assert.equal((await call('/api/auth/me',undefined,admin.cookie)).role,'admin');assert((await call('/admin/api/events',{},admin.cookie)).ok);
 const html=await(await raw('/admin',undefined,{Cookie:admin.cookie})).text();assert(html.includes('orderRows'));assert(!html.includes(env.ADMIN_LOGIN_PASSWORD));assert(!html.includes(env.ADMIN_KEY));
 assert((await call('/admin/api/events',{},'',{'X-Admin-Key':env.ADMIN_KEY})).ok,'Existing monitor authentication still works');
 const guest=await call('/api/customer/auth/register',{username:'共享登录客妹',password:'synthetic-client-password'});
 const login=await call('/api/auth/login',{username:'共享登录客妹',password:'synthetic-client-password'});assert.equal(login.user.id,guest.user.id);assert.notEqual(login.role,'admin');assert.equal((await call('/api/auth/me',undefined,login.cookie)).user.id,guest.user.id);
 assert.equal((await call('/admin/api/events',{},login.cookie)).status,401);
 assert.equal((await call('/api/auth/login',{username:'其他名字',password:env.ADMIN_LOGIN_PASSWORD})).status,401);
 // Password changes invalidate browser sessions without rotating the script key.
 env.ADMIN_LOGIN_PASSWORD='synthetic-updated-browser-login';assert.equal((await raw('/admin',undefined,{Cookie:admin.cookie})).status,303);assert.notEqual((await call('/api/auth/me',undefined,admin.cookie)).role,'admin');assert((await call('/admin/api/events',{},'',{'X-Admin-Key':env.ADMIN_KEY})).ok);
 const replacement=await call('/api/auth/login',{username:'admin',password:env.ADMIN_LOGIN_PASSWORD});assert.equal(replacement.role,'admin');assert((await call('/admin/auth/logout',{},replacement.cookie)).ok);assert.notEqual((await call('/api/auth/me',undefined,replacement.cookie)).role,'admin');
 // Both unified and legacy admin login share the same bounded global counter.
 for(let i=0;i<21;i++)await call(i%2?'/api/auth/login':'/admin/auth/login',{username:'admin',password:'wrong'});
 assert.equal((await call('/api/auth/login',{username:'admin',password:env.ADMIN_LOGIN_PASSWORD})).status,429);
 console.log('PASS shared admin/client login, clean admin redirect, reserved name, CSRF, role isolation, private password, script-key continuity, session rotation/logout and global rate guard.');
})().catch(e=>{console.error(e.stack?.split('\n').slice(0,6).join('\n'));process.exit(1)});
