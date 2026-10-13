// Background notifications. No destination or credentials are bundled.
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const WATCH_CONFIG='watch:config', WATCH_QUEUE='watch:q:', WATCH_STATUS='watch:status';
const watchDefaults=()=>({revision:0,enabled:false,channel:'',events:['booking','cancel','payment'],endpoint:'',token:'',chatId:'',emailFrom:'',emailTo:''});
const emailAddress=v=>typeof v==='string'&&v.length<=254&&/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(v);
function watchValidate(c){
 if(typeof c.enabled!=='boolean'||!Array.isArray(c.events)||c.events.some(v=>!['booking','cancel','payment'].includes(v)))throw Error('值守设置无效');
 if(!['','webhook','wecom','feishu','telegram','email'].includes(c.channel))throw Error('请选择通知渠道');
 if(c.enabled&&(!c.channel||!c.events.length))throw Error('请选择通知渠道和提醒事项');
 for(const k of ['endpoint','token','chatId'])if(typeof c[k]!=='string'||c[k].length>2048)throw Error('通知配置过长');
 if(c.channel==='email'){
  if((c.enabled||c.token)&&!/^re_[A-Za-z0-9_-]{8,200}$/.test(c.token))throw Error('请填写 Resend API Key（不是邮箱密码）');
  if((c.enabled||c.emailFrom)&&!emailAddress(c.emailFrom))throw Error('请填写一个有效的发件邮箱地址');
  if((c.enabled||c.emailTo)&&!emailAddress(c.emailTo))throw Error('请填写一个有效的收件邮箱地址');
 }else if(c.channel==='telegram'){
  if((c.enabled||c.token)&&!/^\d{5,16}:[A-Za-z0-9_-]{20,100}$/.test(c.token))throw Error('请填写有效的 Bot Token');
  if((c.enabled||c.chatId)&&!/^(-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/.test(c.chatId))throw Error('请填写有效的 Chat ID');
 }else if(c.endpoint||c.enabled){
  let u;try{u=new URL(c.endpoint);}catch{throw Error('请填写通知地址');}
  const host=u.hostname.toLowerCase();
  // Restrict generic destinations to public DNS names; never forward redirects or admin credentials.
  if(u.protocol!=='https:'||u.username||u.password||u.hash||(u.port&&u.port!=='443')||!host.includes('.')||!/[a-z]$/.test(host)||/(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(host)||host.includes(':')||host.startsWith('['))throw Error('通知地址须为公网 HTTPS 域名');
  if(c.channel==='wecom'&&(host!=='qyapi.weixin.qq.com'||u.pathname!=='/cgi-bin/webhook/send'||!u.searchParams.get('key')))throw Error('请填写企业微信群机器人 Webhook');
  if(c.channel==='feishu'&&(host!=='open.feishu.cn'||!/^\/open-apis\/bot\/v2\/hook\/[a-zA-Z0-9-]+$/.test(u.pathname)))throw Error('请填写飞书自定义机器人 Webhook');
 }
}
function watchPublic(c){return {revision:c.revision,enabled:c.enabled,channel:c.channel,events:c.events,chatId:c.chatId,emailFrom:c.emailFrom||'',emailTo:c.emailTo||'',hasEndpoint:!!c.endpoint,hasToken:!!c.token};}
async function watchDeliver(c,item){
 const labels={booking:'新预约',cancel:'预约已取消',payment:'客人已提交付款通知（待核对）',test:'值守测试'};
 const text=['拍摄排单 · '+labels[item.type],item.eventName,item.cn?'CN：'+item.cn:'',item.date+' '+item.time,item.orderId?'订单：'+item.orderId:'','通知编号：'+item.id].filter(Boolean).join('\n');
 let url=c.endpoint,body,headers={'Content-Type':'application/json'};
 if(c.channel==='email'){url='https://api.resend.com/emails';headers.Authorization='Bearer '+c.token;headers['Idempotency-Key']='photo-booking/'+item.id;body={from:c.emailFrom,to:[c.emailTo],subject:'拍摄排单 · '+labels[item.type],text};}
 else if(c.channel==='telegram'){url='https://api.telegram.org/bot'+c.token+'/sendMessage';body={chat_id:c.chatId,text};}
 else if(c.channel==='wecom')body={msgtype:'text',text:{content:text}};
 else if(c.channel==='feishu')body={msg_type:'text',content:{text}};
 else {body={id:item.id,type:item.type,text,event:{name:item.eventName},order:{id:item.orderId,cn:item.cn,date:item.date,time:item.time}};if(c.token)headers.Authorization='Bearer '+c.token;}
 const r=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('通知渠道返回 HTTP '+r.status);
 if(c.channel!=='webhook'){
  const j=await r.json();
  if(c.channel==='email'?(!j||typeof j.id!=='string'||!j.id||j.error):c.channel==='telegram'?!j.ok:c.channel==='wecom'?j.errcode!==0:(j.code??j.StatusCode)!==0)throw Error('通知渠道拒绝消息，请检查发送权限及配置');
 }
}
export async function watchRoute(request,env,storage){
 const url=new URL(request.url);if(!['/admin/api/watch-settings','/admin/api/watch-test'].includes(url.pathname))return null;
 if((request.headers.get('X-Admin-Key')||url.searchParams.get('key'))!==env.ADMIN_KEY)return reply({ok:false,error:'unauthorized'},401);
 const c=await storage.get(WATCH_CONFIG)||watchDefaults();
 if(request.method==='GET'&&url.pathname.endsWith('watch-settings'))return reply({ok:true,config:watchPublic(c),status:await storage.get(WATCH_STATUS)||{},pending:(await storage.list({prefix:WATCH_QUEUE})).size});
 if(request.method!=='POST')return reply({ok:false,error:'method not allowed'},405);
 let d;try{d=await request.json();}catch{return reply({ok:false,error:'配置格式无效'},400);}
 if(!d||d.revision!==c.revision)return reply({ok:false,error:'设置已更新，请重新打开设置'},409);
 if(url.pathname.endsWith('watch-test')){
  if(!c.enabled)return reply({ok:false,error:'请先保存并开启值守'},400);
  const s=await storage.get(WATCH_STATUS)||{};if(Date.now()-(s.lastTest||0)<30000)return reply({ok:false,error:'请稍等 30 秒再测试'},429);
  await storage.put(WATCH_STATUS,{...s,lastTest:Date.now()});
  try{await watchDeliver(c,{id:crypto.randomUUID(),type:'test',eventName:'这是一条测试消息，收到即表示渠道可用。',date:'',time:''});return reply({ok:true});}catch{return reply({ok:false,error:c.channel==='email'?'邮件发送服务未确认接受，请检查 API Key、发件域名验证、收件地址和发送额度':'测试发送失败，请检查地址、凭据和机器人安全设置'},502);}
 }
 const next={...c,enabled:d.enabled,channel:d.channel,events:d.events,chatId:d.chatId||'',revision:c.revision+1};
 for(const field of ['emailFrom','emailTo']){
  if(d[field]!==undefined&&typeof d[field]!=='string')return reply({ok:false,error:'邮箱地址格式无效'},400);
  next[field]=next.channel==='email'?(d[field]===undefined?(c[field]||''):d[field].trim()):'';
 }
 for(const key of ['endpoint','token'])next[key]=typeof d[key]==='string'&&d[key]?d[key].trim():(d.clearSecrets||c.channel!==d.channel?'':c[key]);
 try{watchValidate(next);}catch(e){return reply({ok:false,error:e.message},400);}
 await storage.transaction(async tx=>{await tx.put(WATCH_CONFIG,next);const keys=[...(await tx.list({prefix:WATCH_QUEUE})).keys()];for(const key of keys)await tx.delete(key);await tx.deleteAlarm();await tx.put(WATCH_STATUS,{...await tx.get(WATCH_STATUS),lastError:'',changedAt:new Date().toISOString()});});
 return reply({ok:true,config:watchPublic(next)});
}
export async function watchStage(storage,staged,readCache,load){
 const c=await storage.get(WATCH_CONFIG)||watchDefaults();if(!c.enabled)return [];
 const items=[],events=JSON.parse(await load('events')||'[]');
 for(const [key,value] of staged){
  const m=key.match(/^e:([^/]+)\/o:(.+)$/);if(!m||typeof value!=='string')continue;
  const o=JSON.parse(value),old=JSON.parse(readCache.get(key)||'null');
  const type=!old&&!o.cancelled?'booking':old&&!old.cancelled&&o.cancelled?'cancel':old&&!old.paymentReportedAt&&o.paymentReportedAt?'payment':null;
  if(!type||!c.events.includes(type))continue;
  items.push({id:crypto.randomUUID(),revision:c.revision,type,eventName:events.find(e=>e.id===m[1])?.name||'拍摄预约',cn:String(o.cn||'').slice(0,30),date:String(o.date||''),time:String(o.timeSlot||o.slot||''),orderId:m[2],attempt:0,due:Date.now()});
 }
 return items;
}
export async function watchCommit(tx,items){
 if(!items.length)return;
 const pending=await tx.list({prefix:WATCH_QUEUE});let count=pending.size;
 for(const item of items){if(count>=500){const s=await tx.get(WATCH_STATUS)||{};await tx.put(WATCH_STATUS,{...s,dropped:(s.dropped||0)+1,lastError:'待发送队列已满，请检查通知渠道'});continue;}await tx.put(WATCH_QUEUE+item.id,item);count++;}
 const alarm=await tx.getAlarm(),soon=Date.now()+1000;if(!alarm||alarm>soon)await tx.setAlarm(soon);
}
export async function watchAlarm(storage){
 const c=await storage.get(WATCH_CONFIG)||watchDefaults();if(!c.enabled)return;
 const pending=await storage.list({prefix:WATCH_QUEUE}),now=Date.now();let sent=0;
 for(const [key,item] of pending){
  if(item.revision!==c.revision)continue;
  if(item.due>now||sent>=5)continue;sent++;
  const latest=await storage.get(WATCH_CONFIG);if(!latest?.enabled||latest.revision!==item.revision)break;
  let success=false;try{await watchDeliver(c,item);success=true;}catch{}
  await storage.transaction(async tx=>{
   const current=await tx.get(WATCH_CONFIG);if(!current?.enabled||current.revision!==item.revision||!await tx.get(key))return;
   const s=await tx.get(WATCH_STATUS)||{};
   if(success){await tx.delete(key);await tx.put(WATCH_STATUS,{...s,lastSuccess:new Date().toISOString(),lastError:''});}
   else{item.attempt++;await tx.put(WATCH_STATUS,{...s,lastFailure:new Date().toISOString(),lastError:item.attempt>=5?'消息发送失败，已停止重试；请检查通知渠道':'发送失败，稍后自动重试',failed:(s.failed||0)+(item.attempt>=5?1:0)});if(item.attempt>=5)await tx.delete(key);else{item.due=Date.now()+Math.min(3600000,30000*2**(item.attempt-1));await tx.put(key,item);}}
  });
 }
 await storage.transaction(async tx=>{const config=await tx.get(WATCH_CONFIG);if(!config?.enabled)return;const remaining=await tx.list({prefix:WATCH_QUEUE});if(remaining.size)await tx.setAlarm(Math.max(Date.now()+1000,Math.min(...[...remaining.values()].map(v=>v.due))));});
}
