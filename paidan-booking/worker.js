// 拍摄排单：客人填写预约，后台管理排期与收款。
import INDEX_HTML from "./index.html";
import ADMIN_HTML from "./admin.html";

import { extendedRoutes, TransactionalStore } from "./backend.js";
const KV_EVENTS = "events";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
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
      if(prior)return JSON.stringify(prior.data)===JSON.stringify(data)?json({ok:true,id:prior.id}):json({ok:false,error:"提交内容已变化，请重试"},409);
      const booked = await getBooked(env, ev);
      if (booked[date].includes(timeSlot)) return json({ ok: false, conflict: true, error: "slot taken" }, 409);

      const id = crypto.randomUUID().slice(0, 8) + Date.now().toString(36).slice(-4);
      const order = { id, eventId: ev.id, date, timeSlot, cn: String(cn).slice(0, 30), phone: String(phone).slice(0, 11), character: String(character).slice(0, 50), remark: String(remark || "").slice(0, 100), paid: false, createdAt: new Date().toISOString() };
      await putJSON(env, "e:" + ev.id + "/o:" + id, order);
      const ids = await getJSON(env, "e:" + ev.id + "/orders", []);
      ids.push(id);
      await putJSON(env, "e:" + ev.id + "/orders", ids);

      booked[date].push(timeSlot);
      await putJSON(env, "e:" + ev.id + "/booked", booked);
      await putJSON(env,"order-request:"+reqId,{id,data});
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

    // ---------- 前台：我的预约查询（active 届；支持手机号或订单号） ----------
    if (path === "/api/my-orders" && request.method === "POST") {
      let data;
      try { data = await request.json(); } catch (e) { return json({ ok: false }, 400); }
      const q = String((data && (data.phone || data.query)) || "").trim();
      if (!q) return json({ ok: false, error: "empty query" }, 400);
      const isPhone = /^1[3-9]\d{9}$/.test(q);
      const isId = /^[0-9a-z]{8,16}$/i.test(q);
      if (!isPhone && !isId) return json({ ok: false, error: "invalid phone/order id" }, 400);
      const ev = await getActiveEvent(env);
      if (!ev) return json({ ok: false, error: "no active event" }, 404);
      const orders = await getAllOrders(env, ev);
      const mine = orders.filter(o => !o.cancelled && (isPhone ? o.phone === q : o.id === q.toLowerCase()))
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
      try { form = await request.formData(); } catch (e) { return json({ ok: false, error: "bad form" }, 400); }
      const orderId = form.get("order_id") || "";
      const phone = String(form.get("phone") || "");
      const file = form.get("file");
      const ev = (await listEvents(env)).find(e=>e.id===(url.searchParams.get("ev")||form.get("eventId")));
      if (!ev) return json({ ok: false, error: "not found" }, 404);
      const o = orderId ? await getJSON(env, "e:" + ev.id + "/o:" + orderId, null) : null;
      if (!o) return json({ ok: false, error: "order not found" }, 404);
      const key = url.searchParams.get("key");
      if (key !== ADMIN_KEY && o.phone !== phone) return json({ ok: false, error: "forbidden" }, 403);
      if (!file || typeof file === "string") return json({ ok: false, error: "no file" }, 400);
      if (file.size > 5 * 1024 * 1024) return json({ ok: false, error: "too large (max 5MB)" }, 400);
      const buf = await file.arrayBuffer();
      await env.PAIDAN_KV.put("e:" + ev.id + "/ab:" + orderId, buf);
      await putJSON(env, "e:" + ev.id + "/a:" + orderId, { type: file.type || "application/octet-stream", name: file.name || "attachment", size: file.size });
      o.hasAttach = true;
      await putJSON(env, "e:" + ev.id + "/o:" + orderId, o);
      return json({ ok: true });
    }

    if (path.startsWith("/api/attach/") && request.method === "GET") {
      const orderId = path.split("/")[3];
      const key = url.searchParams.get("key");
      if (key !== ADMIN_KEY) return json({ ok: false, error: "unauthorized" }, 401);
      const ev = (await listEvents(env)).find(e=>e.id===url.searchParams.get("ev"))||await getActiveEvent(env);
      if (!ev) return json({ ok: false, error: "not found" }, 404);
      const meta = await getJSON(env, "e:" + ev.id + "/a:" + orderId, null);
      if (!meta) return json({ ok: false, error: "none" }, 404);
      const buf = await env.PAIDAN_KV.get("e:" + ev.id + "/ab:" + orderId, { type: "arrayBuffer" });
      if (!buf) return json({ ok: false, error: "missing" }, 404);
      return new Response(buf, { headers: { "Content-Type": meta.type, "Cache-Control": "no-store" } });
    }

    // ---------- 管理接口 ----------
    const key = url.searchParams.get("key") || request.headers.get("X-Admin-Key");
    if (path.startsWith("/admin")) {
      if (key !== ADMIN_KEY) return json({ ok: false, error: "unauthorized" }, 401);
      if (path === "/admin" && request.method === "GET") {
        return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
      }
      // 管理端可指定届：?key=xxx&ev=<eventId>；不指定 = active 届
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
        const id = crypto.randomUUID().slice(0, 8) + Date.now().toString(36).slice(-4);
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
}
export default {
 async fetch(request,env){
  const path=new URL(request.url).pathname;
  if(!env.ADMIN_KEY)return json({ok:false,error:'Service not configured'},503);
  if(path==='/'||path==='/index.html'||path==='/admin'||request.method==='OPTIONS')return handler.fetch(request,env);
  return env.BOOKING_STORE.get(env.BOOKING_STORE.idFromName('booking-v1')).fetch(request);
 }
};
