module.exports=class Store{
 constructor(){this.map=new Map();this.fail=false;this.alarm=null;}
 async get(k){return structuredClone(this.map.get(k));}
 async put(k,v){this.map.set(k,structuredClone(v));}
 async delete(k){this.map.delete(k);}
 async list({prefix=''}){return new Map([...this.map].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
 async getAlarm(){return this.alarm;}
 async setAlarm(t){this.alarm=t;}
 async deleteAlarm(){this.alarm=null;}
 async transaction(fn){const old=structuredClone(this.map),alarm=this.alarm;try{const r=await fn(this);if(this.fail)throw Error('injected transaction failure');return r;}catch(e){this.map=old;this.alarm=alarm;throw e;}}
};
