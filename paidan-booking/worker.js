// Self-service photography booking with customer accounts and administrator sessions.
import INDEX_HTML from "./index.html";
import ADMIN_HTML from "./admin.html";

import { extendedRoutes, TransactionalStore } from "./backend.js";
import { privateGuard, privateAuthorize, privateHarden, privateError } from "./private-security.js";
import { customerAuthorize, customerBusiness } from "./customer-accounts.js";
const KV_EVENTS = "events";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

// Treat the order number as a private lookup token; retain existing IDs unchanged.
function newOrderId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
}

function referenceImageType(buffer) {
  const b = new Uint8Array(buffer);
  if (b.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => b[i] === v)) return 'image/png';
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.length >= 12 && String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP') return 'image/webp';
  return null;
}

async function readReferenceForm(request) {
  const limit = 6 * 1024 * 1024; // 5 MiB image plus bounded multipart overhead.
  if (Number(request.headers.get('Content-Length')) > limit) throw new Error('too large');
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data;')) throw new Error('bad form');
  const reader = request.body?.getReader(), chunks = []; let size = 0;
  if (!reader) throw new Error('bad form');
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(new Blob(chunks), { headers: { 'Content-Type': request.headers.get('Content-Type') } }).formData();
}

async function getJSON(env, key, fallback) {
  const v = await env.PAIDAN_KV.get(key);
  if (!v) return fallback;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

async function putJSON(env, key, val) {
  await env.PAIDAN_KV.put(key, JSON.stringify(val));
}

// ---------- 届（event） helpers ----------

async function listEvents(env) {
  const list = await getJSON(env, KV_EVENTS, []);
  return Array.isArray(list) ? list : [];
}

async function getActiveEvent(env) {
  const events = await listEvents(env);
  return events.find(e => e.status === "active") || null;
}

async function getBooked(env, ev) {
  const b = await getJSON(env, "e:" + ev.id + "/booked", {});
  for (const d of ev.dates) if (!Array.isArray(b[d])) b[d] = [];
  return b;
}

async function getAllOrders(env, ev) {
  const ids = await getJSON(env, "e:" + ev.id + "/orders", []);
  const orders = [];
  for (const id of ids) {
    const o = await getJSON(env, "e:" + ev.id + "/o:" + id, null);
    if (o) orders.push(o);
  }
  return orders;
}

// archived 届导入的历史订单（records 数组，管理员导入）
async function getRecords(env, ev) {
  return await getJSON(env, "e:" + ev.id + "/records", []);
}

const handler = {
  async fetch(request, env) {
    const ADMIN_KEY = env.ADMIN_KEY;
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") return new Response(null, { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Methods": "GET,POST", "Access-Control-Allow-Headers": "Content-Type" } });

    if (path === "/" || path === "/index.html") {
      return new Response(INDEX_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
    }

    const customer = await customerBusiness(request,env);
    if(customer instanceof Request)return handler.fetch(customer,env);
    if(customer)return customer;
    // Legacy endpoints cannot act on another customer's order even if its ID/phone is known.
    if(['/api/paid','/api/cancel'].includes(path)&&request.headers.get('X-Admin-Key')!==env.ADMIN_KEY){
      let d;try{d=await request.clone().json();}catch{return json({ok:false,error:'提交格式无效'},400);}
      const ev=path==='/api/paid'?(await listEvents(env)).find(e=>e.id===d.eventId):await getActiveEvent(env);
      const o=ev?await getJSON(env,'e:'+ev.id+'/o:'+String(d.id||''),null):null;
      if(!o||!o.customerId||o.customerAccess==='limited'||o.customerId!==request.headers.get('X-Customer-Id'))return json({ok:false,error:'无法操作这条预约'},403);
    }
    const extension = await extendedRoutes(request,env);
    if(extension)return extension;

    // ---------- 前台：当前届配置 ----------
    if (path === "/api/event" && request.method === "GET") {
      const ev = await getActiveEvent(env);
      if (!ev) return json({ ok: true, event: null });
      return json({ ok: true, event: { id: ev.id, name: ev.name, dates: ev.dates, slots: ev.slots, year:ev.year, shootDates:ev.shootDates, price:ev.price, publicConfig:ev.publicConfig } });
    }

    if (path === "/api/events" && request.method === "GET") {
      const events = await listEvents(env);
      return json({ ok: true, events: events.map(e => ({ id: e.id, name: e.name, status: e.status })) });
    }

    if (path === "/api/booked" && request.method === "GET") {
      const ev = await getActiveEvent(env);
      if (!ev) return json({ ok: false, error: "no active event" }, 404);
      const booked = await getBooked(env, ev);
      return json({ ok: true, booked, eventId:ev.id });
    }

    // ---------- 前台：提交预约（active 届） ----------
    if (path === "/api/order" && request.method === "POST") {
      let data;
      try { data = await request.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
      const { date, timeSlot, cn, phone, character, remark } = data || {};
      const ev = await getActiveEvent(env);
      if (!ev) return json({ ok: false, error: "no active event" }, 404);
      if(data.eventId!==ev.id)return json({ok:false,eventChanged:true,error:"预约场次已更新，请刷新页面重新填写"},409);
      if (!ev.dates.includes(date) || !ev.slots.includes(timeSlot)) return json({ ok: false, error: "invalid date/slot" }, 400);
      if (!cn || !/^1[3-9]\d{9}$/.test(phone || "") || !character) return json({ ok: false, error: "invalid fields" }, 400);

      const reqId=data.requestId;
      if(typeof reqId!=="string"||!/^[a-f0-9-]{36}$/i.test(reqId))return json({ok:false,error:"请刷新页面后重新提交"},400);
      const prior=await getJSON(env,"order-request:"+reqId,null);
      const customerId=request.headers.get('X-Customer-Id')||null;
      if(prior)return prior.customerId===customerId&&JSON.stringify(prior.data)===JSON.stringify(data)?json({ok:true,id:prior.id}):json({ok:false,error:"提交内容或登录账号已变化，请重新提交"},409);
      const booked = await getBooked(env, ev);
      if (booked[date].includes(timeSlot)) return json({ ok: false, conflict: true, error: "slot taken" }, 409);

      const id = newOrderId();
      const order = { id, eventId: ev.id, customerId, date, timeSlot, cn: String(cn).slice(0, 30), phone: String(phone).slice(0, 11), character: String(character).slice(0, 50), remark: String(remark || "").slice(0, 100), paid: false, createdAt: new Date().toISOString() };
      await putJSON(env, "e:" + ev.id + "/o:" + id, order);
      const ids = await getJSON(env, "e:" + ev.id + "/orders", []);
      ids.push(id);
      await putJSON(env, "e:" + ev.id + "/orders", ids);

      booked[date].push(timeSlot);
      await putJSON(env, "e:" + ev.id + "/booked", booked);
      if(customerId){await putJSON(env,'customer-profile:'+customerId,{cn:order.cn,phone:order.phone});const key='customer-orders:'+customerId,refs=await getJSON(env,key,[]);refs.unshift({id,eventId:ev.id});await putJSON(env,key,refs);}
      await putJSON(env,"order-request:"+reqId,{id,data,customerId});
      return json({ ok: true, id });
    }

    if (path === "/api/paid" && request.method === "POST") {
      let data;
      try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
      const id = data && data.id;
      const o = id ? await getJSON(env, "o:" + id, null) : null;
      let ev = null;
      if (o) ev = (await listEvents(env)).find(e => e.id === o.eventId) || (await getActiveEvent(env));
      if (!ev) return json({ ok: false, error: "not found" }, 404);
      const cur = await getJSON(env, "e:" + ev.id + "/o:" + id, null);
      if (!cur) return json({ ok: false, error: "not found" }, 404);
      cur.paid = true;
      cur.paidAt = new Date().toISOString();
      await putJSON(env, "e:" + ev.id + "/o:" + id, cur);
      return json({ ok: true });
    }

    // ---------- 前台：我的预约查询（active 届；只接受订单号） ----------
    if (path === "/api/my-orders" && request.method === "POST") {
      let data;
      try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
      const q = typeof data?.query === 'string' ? data.query.trim().toLowerCase() : '';
      if (!/^[0-9a-z]{8,16}$/.test(q) || /^1[3-9]\d{9}$/.test(q)) return json({ ok: false, error: '请使用提交预约时获得的订单号查询，不支持手机号查询' }, 400);
      const ev = await getActiveEvent(env);
      if (!ev) return json({ ok: false, error: "no active event" }, 404);
      const order = await getJSON(env, 'e:' + ev.id + '/o:' + q, null);
      const mine = (order && !order.cancelled && (order.customerId===request.headers.get('X-Customer-Id')&&order.customerAccess!=='limited'||request.headers.get('X-Admin-Key')===env.ADMIN_KEY) ? [order] : [])
        .map(o => ({ id: o.id, date: o.date, timeSlot: o.timeSlot, cn: o.cn, character: o.character, createdAt: o.createdAt }));
      return json({ ok: true, orders: mine });
    }

    if (path === "/api/cancel" && request.method === "POST") {
      let data;
      try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
      const id = data && data.id, phone = String((data && data.phone) || "");
      const ev = await getActiveEvent(env);
      if (!ev) return json({ ok: false, error: "not found" }, 404);
      const o = id ? await getJSON(env, "e:" + ev.id + "/o:" + id, null) : null;
      if (!o || o.cancelled) return json({ ok: false, error: "not found" }, 404);
      if (o.phone !== phone) return json({ ok: false, error: "forbidden" }, 403);
      o.cancelled = true;
      o.cancelledAt = new Date().toISOString();
      await putJSON(env, "e:" + ev.id + "/o:" + id, o);
      const orders = await getAllOrders(env, ev);
      const stillHeld = orders.some(x => !x.cancelled && x.date === o.date && x.timeSlot === o.timeSlot && x.id !== o.id);
      if (!stillHeld) {
        const booked = await getBooked(env, ev);
        booked[o.date] = booked[o.date].filter(s => s !== o.timeSlot);
        await putJSON(env, "e:" + ev.id + "/booked", booked);
      }
      return json({ ok: true });
    }

    // ---------- 附件（active 届） ----------
    if (path === "/api/attach" && request.method === "POST") {
      let form;
      try { form = await readReferenceForm(request); } catch (e) { return json({ ok: false, error: e.message === 'too large' ? '上传内容过大' : '上传格式不正确' }, e.message === 'too large' ? 413 : 400); }
      const orderId = form.get("order_id") || "";
      const phone = String(form.get("phone") || "");
      const file = form.get("file");
      const ev = (await listEvents(env)).find(e=>e.id===(url.searchParams.get("ev")||form.get("eventId")));
      if (!ev) return json({ ok: false, error: "not found" }, 404);
      const o = orderId ? await getJSON(env, "e:" + ev.id + "/o:" + orderId, null) : null;
      if (!o) return json({ ok: false, error: "order not found" }, 404);
      const key = request.headers.get("X-Admin-Key");
      if (key !== ADMIN_KEY && (!o.customerId || o.customerAccess==='limited' || o.customerId !== request.headers.get('X-Customer-Id'))) return json({ ok: false, error: "forbidden" }, 403);
      if (!file || typeof file === "string") return json({ ok: false, error: "no file" }, 400);
      if (file.size > 5 * 1024 * 1024) return json({ ok: false, error: "too large (max 5MB)" }, 400);
      if (!['image/png','image/jpeg','image/webp'].includes(file.type)) return json({ ok: false, error: '参考图只支持 PNG、JPEG 或 WebP' }, 400);
      const buf = await file.arrayBuffer();
      const imageType = referenceImageType(buf);
      if (!imageType || imageType !== file.type) return json({ ok: false, error: '图片内容与类型不符' }, 400);
      await env.PAIDAN_KV.put("e:" + ev.id + "/ab:" + orderId, buf);
      await putJSON(env, "e:" + ev.id + "/a:" + orderId, { type: imageType, name: file.name || "attachment", size: file.size });
      o.hasAttach = true;
      await putJSON(env, "e:" + ev.id + "/o:" + orderId, o);
      return json({ ok: true });
    }

    if (path.startsWith("/api/attach/") && request.method === "GET") {
      const orderId = path.split("/")[3];
      const key = request.headers.get("X-Admin-Key");
      if (key !== ADMIN_KEY) return json({ ok: false, error: "unauthorized" }, 401);
      const ev = (await listEvents(env)).find(e=>e.id===url.searchParams.get("ev"))||await getActiveEvent(env);
      if (!ev) return json({ ok: false, error: "not found" }, 404);
      const meta = await getJSON(env, "e:" + ev.id + "/a:" + orderId, null);
      if (!meta) return json({ ok: false, error: "none" }, 404);
      const buf = await env.PAIDAN_KV.get("e:" + ev.id + "/ab:" + orderId, { type: "arrayBuffer" });
      if (!buf) return json({ ok: false, error: "missing" }, 404);
      // Check old attachments too; never serve stored HTML/SVG under this origin.
      const imageType = referenceImageType(buf);
      if (!imageType) return json({ ok: false, error: '附件不是支持的图片格式，请重新上传 PNG、JPEG 或 WebP' }, 415);
      return new Response(buf, { headers: { 'Content-Type': imageType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Disposition': 'inline; filename="reference.' + ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[imageType]) + '"' } });
    }

    // ---------- 管理接口 ----------
    const key = url.searchParams.get("key") || request.headers.get("X-Admin-Key");
    if (path.startsWith("/admin")) {
      if (key !== ADMIN_KEY) return json({ ok: false, error: "unauthorized" }, 401);
      if (path === "/admin" && request.method === "GET") {
        return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      }
      // Management API selects an event with ?ev=<eventId>; authentication stays in headers/cookies.
      async function adminEvent() {
        const evId = url.searchParams.get("ev");
        const events = await listEvents(env);
        if (evId) return events.find(e => e.id === evId) || null;
        return events.find(e => e.status === "active") || events[0] || null;
      }

      if (path === "/admin/api/events" && request.method === "POST") {
        const events = await listEvents(env);
        return json({ ok: true, events });
      }

      if (path === "/admin/api/orders" && request.method === "POST") {
        const ev = await adminEvent();
        if (!ev) return json({ ok: true, empty: true, event: null, count: 0, orders: [], records: [], booked: {}, config: {} });
        const orders = await getAllOrders(env, ev);
        const booked = await getBooked(env, ev);
        const config = await getJSON(env, "e:" + ev.id + "/config", {});
        const records = await getRecords(env, ev);
        return json({ ok: true, event: ev, count: orders.length, orders, booked, records, config });
      }

      if (path === "/admin/api/event-new" && request.method === "POST") {
        let data;
        try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
        const name = String((data && data.name) || "").trim();
        const dates = Array.isArray(data && data.dates) ? data.dates.map(s => String(s).trim()).filter(Boolean) : [];
        const slots = Array.isArray(data && data.slots) ? data.slots.map(s => String(s).trim()).filter(Boolean) : [];
        const price = (data && typeof data.price === "number" && data.price >= 0) ? data.price : 0;
        if (!name || !dates.length || !slots.length) return json({ ok: false, error: "需要漫展名、至少一个日期和时段" }, 400);
        const events = await listEvents(env);
        const id = "ev-" + crypto.randomUUID().slice(0, 8);
        // 新届成为 active，旧 active 归档
        for (const e of events) if (e.status === "active") e.status = "archived";
        const ev = { id, name, status: "active", dates, slots, price, createdAt: new Date().toISOString() };
        events.unshift(ev);
        await putJSON(env, KV_EVENTS, events);
        await putJSON(env, "e:" + id + "/booked", {});
        await putJSON(env, "e:" + id + "/config", { price });
        return json({ ok: true, event: ev });
      }

      if (path === "/admin/api/event-archive" && request.method === "POST") {
        let data;
        try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
        const evId = data && data.id;
        const events = await listEvents(env);
        const ev = events.find(e => e.id === evId);
        if (!ev) return json({ ok: false, error: "not found" }, 404);
        ev.status = "archived";
        await putJSON(env, KV_EVENTS, events);
        return json({ ok: true });
      }

      if (path === "/admin/api/event-import" && request.method === "POST") {
        // 导入历史届（Excel 里那 3 次）：records 只读展示
        let data;
        try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
        const name = String((data && data.name) || "").trim();
        const dates = Array.isArray(data && data.dates) ? data.dates.filter(Boolean) : [];
        const records = Array.isArray(data && data.records) ? data.records : [];
        if (!name || !dates.length || !records.length) return json({ ok: false, error: "需要名称、日期和记录" }, 400);
        const events = await listEvents(env);
        const id = "ev-" + crypto.randomUUID().slice(0, 8);
        events.unshift({ id, name, status: "archived", dates, slots: [], price: 0, createdAt: new Date().toISOString(), imported: true });
        await putJSON(env, KV_EVENTS, events);
        await putJSON(env, "e:" + id + "/records", records);
        return json({ ok: true, id });
      }

      if (path === "/admin/api/release" && request.method === "POST") {
        let data;
        try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
        const { date, slot } = data || {};
        const ev = await adminEvent();
        if (!ev) return json({ ok: false, error: "no event" }, 404);
        if(ev.status!=="active")return json({ok:false,error:"归档届不能更改排期"},409);
        if (!ev.dates.includes(date) || !ev.slots.includes(slot)) return json({ ok: false, error: "invalid" }, 400);
        const orders = await getAllOrders(env, ev);
        for (const o of orders) {
          if (!o.cancelled && o.date === date && o.timeSlot === slot) {
            o.cancelled = true;
            o.cancelledAt = new Date().toISOString();
            o.adminReleased = true;
            await putJSON(env, "e:" + ev.id + "/o:" + o.id, o);
          }
        }
        const booked = await getBooked(env, ev);
        booked[date] = booked[date].filter(s => s !== slot);
        await putJSON(env, "e:" + ev.id + "/booked", booked);
        return json({ ok: true });
      }

      if (path === "/admin/api/book" && request.method === "POST") {
        let data;
        try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
        const { date, slot, cn, phone, character, remark } = data || {};
        const ev = await adminEvent();
        if (!ev) return json({ ok: false, error: "no event" }, 404);
        if(ev.status!=="active")return json({ok:false,error:"归档届不能更改排期"},409);
        if (!ev.dates.includes(date) || !ev.slots.includes(slot)) return json({ ok: false, error: "invalid date/slot" }, 400);
        if (!cn || !/^1[3-9]\d{9}$/.test(phone || "") || !character) return json({ ok: false, error: "invalid fields" }, 400);
        const booked = await getBooked(env, ev);
        if (booked[date].includes(slot)) return json({ ok: false, conflict: true, error: "slot taken" }, 409);
        const id = newOrderId();
        const order = { id, eventId: ev.id, date, timeSlot: slot, cn: String(cn).slice(0, 30), phone: String(phone).slice(0, 11), character: String(character).slice(0, 50), remark: String(remark || "").slice(0, 100), paid: false, manual: true, createdAt: new Date().toISOString() };
        await putJSON(env, "e:" + ev.id + "/o:" + id, order);
        const ids = await getJSON(env, "e:" + ev.id + "/orders", []);
        ids.push(id);
        await putJSON(env, "e:" + ev.id + "/orders", ids);
        booked[date].push(slot);
        await putJSON(env, "e:" + ev.id + "/booked", booked);
        return json({ ok: true, id });
      }

      if (path === "/admin/api/paid-toggle" && request.method === "POST") {
        let data;
        try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
        const ev = await adminEvent();
        if (!ev) return json({ ok: false, error: "no event" }, 404);
        const o = data && data.id ? await getJSON(env, "e:" + ev.id + "/o:" + data.id, null) : null;
        if (!o) return json({ ok: false, error: "not found" }, 404);
        o.paid = !!(data && data.paid);
        if (o.paid) {
          o.paidAt = new Date().toISOString();
          if (data && typeof data.amount === "number" && data.amount >= 0) o.amount = data.amount;
        } else {
          delete o.paidAt;
          delete o.amount;
        }
        await putJSON(env, "e:" + ev.id + "/o:" + data.id, o);
        return json({ ok: true, paid: o.paid, amount: o.amount || 0 });
      }

      if (path === "/admin/api/attach-meta" && request.method === "POST") {
        let data;
        try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
        const ev = await adminEvent();
        if (!ev) return json({ ok: false, error: "no event" }, 404);
        const meta = data && data.id ? await getJSON(env, "e:" + ev.id + "/a:" + data.id, null) : null;
        return json({ ok: true, meta });
      }

      if (path === "/admin/api/config" && request.method === "POST") {
        let data;
        try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
        const ev = await adminEvent();
        if (!ev) return json({ ok: false, error: "no event" }, 404);
        const config = await getJSON(env, "e:" + ev.id + "/config", {});
        if (data && typeof data.price === "number" && data.price >= 0) config.price = data.price;
        await putJSON(env, "e:" + ev.id + "/config", config);
        if (ev) {
          const events = await listEvents(env);
          const me = events.find(e => e.id === ev.id);
          if (me) { me.price = config.price; await putJSON(env, KV_EVENTS, events); }
        }
        return json({ ok: true, config });
      }

      if (path === "/admin/api/slot" && request.method === "POST") {
        let data;
        try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
        const { date, slot, booked: want } = data || {};
        const ev = await adminEvent();
        if (!ev) return json({ ok: false, error: "no event" }, 404);
        if(ev.status!=="active")return json({ok:false,error:"归档届不能更改排期"},409);
        if (!ev.dates.includes(date) || !ev.slots.includes(slot)) return json({ ok: false, error: "invalid" }, 400);
        const booked = await getBooked(env, ev);
        if (want && !booked[date].includes(slot)) booked[date].push(slot);
        if (!want) booked[date] = booked[date].filter(s => s !== slot);
        await putJSON(env, "e:" + ev.id + "/booked", booked);
        return json({ ok: true, booked });
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  }
};

export class BookingStore extends TransactionalStore {
 constructor(ctx,env){super(ctx,env,handler);}
 async run(request){
  try{
   const authorized=await privateAuthorize(request,this.env,this.ctx.storage);
   if(authorized instanceof Response)return authorized;
   const customer=await customerAuthorize(authorized,this.env,this.ctx.storage);
   return customer instanceof Response?customer:await super.run(customer);
  }catch(error){return privateError(error);}
 }
}
export default {
 async fetch(request,env){
  try{
   if(!env.ADMIN_KEY)return privateHarden(json({ok:false,error:'Service not configured'},503));
   const guarded=await privateGuard(request,env);
   if(guarded instanceof Response)return privateHarden(guarded);
   const path=new URL(guarded.url).pathname;
   const response=(path==='/'||path==='/index.html')?await handler.fetch(guarded,env):await env.BOOKING_STORE.get(env.BOOKING_STORE.idFromName('booking-v1')).fetch(guarded);
   return privateHarden(response);
  }catch(error){return privateHarden(privateError(error));}
 }
};
