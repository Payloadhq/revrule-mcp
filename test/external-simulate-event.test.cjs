'use strict';
// Independent consumer acceptance test. Mock rail only; no external network,
// real credentials, mutations or financial settlement. Run with node --test.
const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),{spawn}=require('node:child_process');
const readline=require('node:readline'),path=require('node:path');

test('RevRule MCP simulate_event sends {event} envelope to existing rail',async()=>{
 const calls=[];
 const server=http.createServer((req,res)=>{
   let raw='';req.on('data',d=>raw+=d);
   req.on('end',()=>{
     calls.push({url:req.url,method:req.method,body:raw?JSON.parse(raw):undefined,
       authorization:req.headers.authorization});
     res.setHeader('content-type','application/json');
     if(req.method==='POST'&&req.url==='/v1/graphs/test-graph/simulate'){
       const body=JSON.parse(raw);
       if(!body.event||typeof body.event!=='object'){res.statusCode=400;res.end('{"error":"event envelope required"}');return;}
       res.end(JSON.stringify({ok:true,accepted:body.event}));return;
     }
     if(req.method==='GET'&&req.url==='/v1/graphs/test-graph'){
       res.end(JSON.stringify({id:'test-graph'}));return;
     }
     if(req.method==='GET'&&req.url==='/v1/graphs/test-graph/payout-evidence'){
       res.end(JSON.stringify({items:[]}));return;
     }
     res.statusCode=404;res.end('{}');
   });
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const proc=spawn(process.execPath,[path.join(__dirname,'..','mcp','index.js')],{
   env:{...process.env,PAYLOAD_RAIL_URL:'http://127.0.0.1:'+server.address().port,
     PAYLOAD_RAIL_API_KEY:'mock-key'},stdio:['pipe','pipe','pipe']});
 let rid=0,stderr='';const pending=new Map();
 proc.stderr.on('data',d=>stderr+=d);
 readline.createInterface({input:proc.stdout}).on('line',line=>{
   try{const resp=JSON.parse(line),fn=pending.get(resp.id);if(fn){pending.delete(resp.id);fn(resp);}}catch{}
 });
 const rpc=(method,params)=>new Promise((resolve,reject)=>{
   const id=++rid,timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP timeout '+stderr.slice(0,200)));},4000);
   pending.set(id,value=>{clearTimeout(timer);resolve(value);});
   proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
 });
 try{
   assert.ok((await rpc('initialize',{protocolVersion:'2024-11-05'})).result);
   const list=await rpc('tools/list',{});
   for(const name of ['revrule_get_graph','revrule_list_payout_evidence','revrule_simulate_event'])
     assert.ok(list.result?.tools?.some(t=>t.name===name),'missing '+name);
   const event={eventId:'test-event',graphId:'test-graph',amountMicros:1000000,
     currency:'USD',occurredAt:'2026-10-16T00:00:00Z'};
   const result=await rpc('tools/call',{name:'revrule_simulate_event',
     arguments:{graph_id:'test-graph',event}});
   assert.equal(result.result?.isError,false,JSON.stringify(result));
   const call=calls.at(-1);
   assert.equal(call.authorization,'Bearer mock-key');
   assert.equal(call.method,'POST');
   assert.deepEqual(call.body,{event},'rail requires event object wrapped in {event}');
 } finally{proc.kill('SIGTERM');await new Promise(r=>server.close(r));}
});