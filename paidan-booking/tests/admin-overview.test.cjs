// Actual UI aggregation functions with synthetic values only; no network or stored user records.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.CLAIM_TEST_SOURCE?path.resolve(process.env.CLAIM_TEST_SOURCE):path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
function fn(name){const start=html.indexOf('function '+name+'(');assert(start>=0);let depth=0,opened=false,end=start;for(;end<html.length;end++){if(html[end]==='{'){depth++;opened=true;}if(html[end]==='}'&&!--depth&&opened){end++;break;}}return html.slice(start,end);}
const start=html.indexOf('// Recorded money only:'),end=html.indexOf('// /Recorded money',start),context=vm.createContext({});
vm.runInContext(['recordState','paymentState','normalizedRecordDate','eventYear'].map(fn).join('\n')+'\nfunction entryState(e){return paymentState(e.item,e.isRecord);}\n'+html.slice(start,end)+'\n'+fn('overviewSummary')+'\nglobalThis.summary=overviewSummary;',context);
const summary=data=>JSON.parse(JSON.stringify(context.summary(data))),event=(id,year)=>({id,name:'Synthetic event',year,shootDates:{'5月1日':year+'-05-01'}});
const result=summary([
 {event:event('one',2026),orders:[{cn:'Ａlice',date:'5月1日',payment:{mode:'normal',status:'paid',amount:35}},{cn:'Bob',date:'5月1日',payment:{mode:'normal',status:'deposit',amount:88,depositAmount:27}},{cn:'Ignore',cancelled:true,date:'5月1日',payment:{mode:'normal',status:'paid',amount:999}}],records:[]},
 {event:event('two',2025),orders:[],records:[{cn:'alice ',date:'5.1',remark:'免'},{cn:'Other',date:'5月1日',payment:{mode:'discount',status:'unpaid',amount:12.5,reason:'Synthetic reason'}}]}
]);
assert.deepEqual({orders:result.orders,cancelled:result.cancelled,customers:result.customers,paid:result.paid,free:result.free,deposit:result.deposit,unpaid:result.unpaid,received:result.received,outstanding:result.outstanding},{orders:4,cancelled:1,customers:3,paid:1,free:1,deposit:1,unpaid:1,received:6200,outstanding:7350});
assert.deepEqual(result.months,{'2026-05':{orders:2,received:6200},'2025-05':{orders:2,received:0}});
assert.equal(result.events.reduce((sum,e)=>sum+e.received,0),result.received);
assert.equal(result.events.reduce((sum,e)=>sum+e.outstanding,0),result.outstanding);
const missing=summary([{event:event('missing',2026),orders:[{cn:'Unknown',date:'not a date',createdAt:'2030-06-01T00:00:00Z',paid:true}],records:[{cn:'Unknown 2',date:'5月1日',remark:'old 66 paid'}],config:{price:35}}]);
assert.equal(missing.orders,2);assert.equal(missing.received,0);assert.equal(missing.outstanding,0);assert.equal(missing.missingReceived,1);assert.equal(missing.missingOutstanding,1);assert.deepEqual(missing.months,{'2026-05':{orders:1,received:0}},'Do not substitute created/import dates for shoot dates');
const empty=summary([]);assert.equal(empty.orders,0);assert.equal(empty.customers,0);assert.equal(empty.received,0);assert.equal(empty.outstanding,0);assert.deepEqual(empty.events,[]);assert.deepEqual(empty.months,{});
const partial=summary([{event:event('partial',2026),orders:[{cn:'Synthetic partial receipt',date:'5月1日',paid:true}],records:[]}]);assert.equal(partial.months['2026-05'].missingReceived,1,'Monthly chart values retain missing-receipt indicators');assert.equal(partial.months['2026-05'].received,0);assert.equal(partial.missingReceived,1);
console.log('PASS admin overview: all-event counts, cancellations, normalized CN deduplication, receipts/deposits/balances/free, monthly shoot dates, missing amounts and empty install.');
