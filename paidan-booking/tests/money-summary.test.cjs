// Financial display calculations from real HTML. Synthetic values, no network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.CLAIM_TEST_SOURCE?path.resolve(process.env.CLAIM_TEST_SOURCE):path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
function fn(name){const start=html.indexOf('function '+name+'(');assert(start>=0);let depth=0,opened=false,end=start;for(;end<html.length;end++){if(html[end]==='{'){depth++;opened=true;}if(html[end]==='}'&&!--depth&&opened){end++;break;}}return html.slice(start,end);}
const start=html.indexOf('// Recorded money only:'),end=html.indexOf('// /Recorded money',start),context=vm.createContext({});
vm.runInContext(fn('recordState')+'\n'+fn('paymentState')+'\nfunction entryState(e){return paymentState(e.item,e.isRecord);}\n'+html.slice(start,end)+'\nglobalThis.money={recordedMoney,orderMoneySummary,formatRecordedMoney};',context);const {recordedMoney,orderMoneySummary,formatRecordedMoney}=context.money;
const entry=(item,isRecord=false)=>({item,isRecord}),summary=entries=>JSON.parse(JSON.stringify(orderMoneySummary(entries)));
assert.deepEqual(summary([entry({payment:{mode:'normal',status:'paid',amount:35}}),entry({payment:{mode:'normal',status:'deposit',amount:88,depositAmount:27}}),entry({payment:{mode:'discount',status:'unpaid',amount:20,reason:'synthetic'}}),entry({payment:{mode:'free',status:'paid',amount:0}}),entry({cancelled:true,payment:{mode:'normal',status:'paid',amount:999}})]),{received:6200,outstanding:8100,missingReceived:0,missingOutstanding:0,deposit:2700,free:1});
assert.deepEqual(summary([entry({deposit:27,balance:61,depositStatus:'√'},true)]),{received:2700,outstanding:6100,missingReceived:0,missingOutstanding:0,deposit:2700,free:0});
assert.deepEqual(summary([entry({deposit:27,balance:61,depositStatus:'√',balanceStatus:'尾已收'},true)]),{received:8800,outstanding:0,missingReceived:0,missingOutstanding:0,deposit:0,free:0});
assert.equal(summary([entry({deposit:27,balance:61,depositStatus:'未收'},true)]).received,0);
assert.equal(summary([entry({deposit:27,balance:61,depositStatus:'未收'},true)]).outstanding,8800);
assert.equal(summary([entry({remark:'旧66已付完'},true)]).missingReceived,1,'Do not infer money from text');
assert.equal(summary([entry({paid:true})]).missingReceived,1);
assert.equal(summary([entry({paid:false})]).missingOutstanding,1,'Do not substitute current unit price for missing totals');
assert.equal(summary([entry({remark:'免'},true)]).free,1);
assert.equal(summary([entry({paid:true,amount:35}),entry({paid:true,amount:0})]).received,3500);
const partial=summary([entry({deposit:27,depositStatus:'√'},true)]);assert.equal(partial.received,2700);assert.equal(partial.missingOutstanding,1);
const overpaid=summary([entry({payment:{mode:'normal',status:'deposit',amount:35,depositAmount:40}})]);assert.equal(overpaid.outstanding,0);assert.equal(overpaid.missingOutstanding,1);
assert.equal(summary([entry({payment:{mode:'normal',status:'paid',amount:0.1}}),entry({payment:{mode:'normal',status:'unpaid',amount:0.2}})]).received,10);
assert.equal(summary([entry({paid:true,amount:-35})]).missingReceived,1);
assert.equal(summary([entry({paid:true,amount:NaN})]).missingReceived,1);
assert.equal(formatRecordedMoney(3500),'¥35.00');assert.equal(formatRecordedMoney(0,1),'待补金额');assert.equal(formatRecordedMoney(3500,1),'¥35.00 +');
console.log('PASS financial totals: receipts/deposits/balances/free/cancelled; imported and online; missing/invalid amounts; no current-price/note guesses; decimal cents and unknown totals.');
