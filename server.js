// 交接不斷線 — 後端：代理 BizForm（金鑰留在伺服器）、C.ai 轉送、提供靜態網頁。零相依，Node 18+。
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
try{for(const l of fs.readFileSync(path.join(__dirname,'.env'),'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);if(m&&!l.trim().startsWith('#')&&!(m[1] in process.env))process.env[m[1]]=m[2];}}catch(e){}
const E=process.env,MOCK=E.MOCK==='1';
const CFG={base:(E.BIZFORM_BASE||'https://bizform.vitalyun.com').replace(/\/$/,''),depot:E.DEPOT_ID||'0891fc9e6a5146ee9adc53245f835cd2',formId:+(E.FORM_ID||14),
 formUrl:E.FORM_URL||'https://bizform.vitalyun.com/#/write/14?depotId=0891fc9e6a5146ee9adc53245f835cd2',
 powerbi:E.POWERBI_URL||'https://app.powerbi.com/view?r=eyJrIjoiOTkxM2Q4YmMtMGYyNi00YjkyLWExZGYtNmI1MGUzZjU2NmNhIiwidCI6IjM5OTIzMmZiLTE3ZDEtNDVjYS1iZGE2LTViNTQwNDQxYmQ2MiIsImMiOjEwfQ%3D%3D',
 caiEmbed:E.CAI_EMBED_URL||'',caiEndpoint:E.CAI_CHAT_ENDPOINT||'',caiHome:'https://cai-innoserve.gss.com.tw',caiHost:(E.CAI_HOST||'https://cai-innoserve.gss.com.tw').replace(/\/$/,''),caiBot:E.CAI_BOT_ID||'handover_bot_003'};
const PASS=E.SITE_PASSCODE||'',SECRET=crypto.randomBytes(16).toString('hex');
const tok=()=>crypto.createHmac('sha256',SECRET).update('ok').digest('hex');
const H={'x-api-key':E.BIZFORM_API_KEY||'',depotId:CFG.depot,'Content-Type':'application/json'};
const val=a=>Array.isArray(a.value)?a.value.join('、'):(a.value==null?'':String(a.value));
const nm=a=>a.displayName||a.name||'';
const find=(m,k)=>{const e=Object.keys(m).find(x=>x.startsWith(k));return e?m[e]:''};
async function bf(p,opt){const r=await fetch(CFG.base+'/Backend/api'+p,{...opt,headers:H});if(!r.ok)throw new Error('BizForm '+r.status+' '+p);return r.json();}
async function pool(arr,n,fn){const out=[];let i=0;await Promise.all(Array.from({length:n},async()=>{while(i<arr.length){const k=i++;out[k]=await fn(arr[k]);}}));return out;}
function shape(g){
 const A={};for(const a of g.attributes||[])A[nm(a)]=val(a);
 const checks=(find(A,'交接完整度')||'').match(/[一二三四五六七]、/g)||[];
 const P={id:g.id,name:find(A,'移交人姓名'),emp:find(A,'員工編號'),dept:find(A,'部門'),title:find(A,'職稱'),last:find(A,'最後工作日'),recv:find(A,'接交人姓名'),boss:find(A,'直屬主管'),reason:find(A,'交接原因'),start:find(A,'交接起始日'),end:find(A,'交接完成日'),
  ck:checks.length,sg:['移交人簽名','接交人簽名','監交人簽名'].filter(k=>A[k]).length,proj:[],cust:[],risk:[]};
 for(const s of g.subDocuments||[]){const m={};for(const a of s.attributes||[])m[nm(a)]=val(a);
  if('專案／案件名稱' in m)P.proj.push({n:m['專案／案件名稱'],c:m['客戶／需求單位'],p:m['目前進度（%）'],d:m['截止日'],nx:m['下一里程碑'],r:m['已知問題與風險']});
  else if('單位名稱' in m)P.cust.push({n:m['單位名稱'],c:m['聯絡人／職稱'],t:m['類別']});
  else if('未結事項' in m)P.risk.push({n:m['未結事項'],l:m['風險等級'],o:m['負責人'],d:m['追蹤日期']});}
 return P;}
let cache={t:0,data:null};
async function load(force){
 if(!force&&cache.data&&Date.now()-cache.t<5000)return cache.data;
 let list;
 if(MOCK)list=JSON.parse(fs.readFileSync(path.join(__dirname,'data/mock.json'),'utf8'));
 else{
  if(!E.BIZFORM_API_KEY)throw new Error('尚未設定 BIZFORM_API_KEY');
  const q=await bf('/documents/query',{method:'POST',body:JSON.stringify({formId:CFG.formId,pageIndex:0,pageSize:200})});
  const items=Array.isArray(q)?q:(q.items||q.documents||Object.values(q).filter(x=>x&&x.id));
  list=await pool(items,5,async d=>shape(await bf('/documents/'+d.id)));
 }
 list=list.map(p=>({risk:[],proj:[],cust:[],...p})).filter(p=>p.name&&!/^\d+$/.test(p.name));
 cache={t:Date.now(),data:{syncedAt:new Date().toISOString(),mock:MOCK,people:list}};return cache.data;}

// ---- Vital CRM（Authorization: ApiKey <金鑰>；路徑 /{服務識別碼}/api/<資源>）----
const CRM={base:(E.CRM_BASE||'https://crm.vitalyun.com').replace(/\/$/,''),id:E.CRM_SERVICE_ID||'e1771937af72548c58e0f5ae0aa75397',key:E.CRM_API_KEY||''};
const pick=(o,ks)=>{if(!o||typeof o!=='object')return '';const m={};for(const k of Object.keys(o))m[k.toLowerCase()]=o[k];for(const k of ks){let v=m[k.toLowerCase()];if(v&&typeof v==='object')v=v.name||v.displayName||v.title||v.value||JSON.stringify(v);if(v!==undefined&&v!==null&&v!=='')return v;}return '';};
async function crmGet(res){
 const out=[];let page=1;
 for(;page<=20;page++){
  const r=await fetch(`${CRM.base}/${CRM.id}/api/${res}?page=${page}&pageIndex=${page}&pageSize=100&$top=100`,{headers:{Authorization:'ApiKey '+CRM.key,Accept:'application/json'}});
  if(!r.ok)throw new Error('CRM '+res+' '+r.status+' '+(await r.text()).slice(0,120));
  const j=await r.json();const arr=Array.isArray(j)?j:(j.items||j.data||j.value||j.results||j.records||[]);
  out.push(...arr);
  const total=j.totalCount??j.total??j.totalItems??null;
  if(!arr.length||arr.length<100||(total!==null&&out.length>=total))break;
 }
 return out;}
const normOpp=o=>({id:pick(o,['id','opportunityId']),name:pick(o,['name','title','subject','opportunityName']),customer:pick(o,['customerName','customer','companyName','company','account','accountName','contactName']),stage:pick(o,['statusName','status','stage','stageName','opportunityStatus']),amount:Number(pick(o,['amount','expectedAmount','estimatedAmount','totalAmount','value']))||0,owner:pick(o,['ownerName','owner','salesperson','assignedTo','responsible','createdByName']),close:String(pick(o,['expectedCloseDate','closeDate','estimatedCloseDate','dueDate','endDate'])).slice(0,10),product:pick(o,['productName','product','products']),created:String(pick(o,['createdDate','createdOn','createDate','createdAt'])).slice(0,10)});
const normCust=o=>({id:pick(o,['id','customerId','companyId']),name:pick(o,['name','fullName','companyName','displayName','customerName']),phone:pick(o,['phone','mobile','telephone','tel','contactPhone']),email:pick(o,['email','mail','emailAddress']),owner:pick(o,['ownerName','owner','salesperson'])});
let ccache={t:0,data:null};
async function loadCrm(force){
 if(!force&&ccache.data&&Date.now()-ccache.t<5000)return ccache.data;
 if(MOCK){ccache={t:Date.now(),data:{mock:true,opps:[{id:1,name:'宏遠精密 年度維護續約',customer:'宏遠精密工業',stage:'報價中',amount:480000,owner:'王小明',close:'2026-11-20',product:'年度維護'},{id:2,name:'聯晟資訊 ERP 擴充模組',customer:'聯晟資訊',stage:'需求確認',amount:1200000,owner:'王小明',close:'2026-12-05',product:'ERP 模組'}],customers:[{id:1,name:'宏遠精密工業'},{id:2,name:'聯晟資訊'}],companies:[],sample:null}};return ccache.data;}
 if(!CRM.key)throw new Error('尚未設定 CRM_API_KEY');
 const [o,c,co]=await Promise.all([crmGet('opportunities'),crmGet('customers').catch(()=>[]),crmGet('companies').catch(()=>[])]);
 ccache={t:Date.now(),data:{opps:o.map(normOpp),customers:c.map(normCust),companies:co.map(normCust),sample:{opportunity:o[0]||null,customer:c[0]||null,company:co[0]||null}}};return ccache.data;}
// 本機快答（C.ai 未設定或失敗時的備援，資料同為即時 BizForm）
function status(p){const t=new Date();t.setHours(0,0,0,0);const d=Math.round((new Date(p.last.replace(/\//g,'-'))-t)/864e5);return (p.ck===7&&p.sg===3)?'已完成':d<0?'逾期未完成':d<=14?'即將到期':'進行中';}
function localAnswer(q,list){const by=s=>list.filter(p=>status(p)===s);const hit=list.find(p=>q.includes(p.name));
 if(/多少人|幾人|幾位|人數|狀況|狀態/.test(q)&&!hit)return `目前共 ${list.length} 位辦理交接：已完成 ${by('已完成').length}、進行中 ${by('進行中').length}、即將到期 ${by('即將到期').length}、逾期 ${by('逾期未完成').length}。`;
 if(/逾期/.test(q))return '逾期未完成：'+(by('逾期未完成').map(p=>`${p.name}（接交人 ${p.recv}，完成度 ${Math.round(p.ck/7*100)}%）`).join('；')||'無');
 if(/到期|快/.test(q))return '即將到期：'+(by('即將到期').map(p=>`${p.name}（${p.last}）`).join('；')||'無');
 if(hit)return `${hit.name}（${hit.dept}${hit.title}）：${status(hit)}，完成度 ${Math.round(hit.ck/7*100)}%，接交人 ${hit.recv}，最後工作日 ${hit.last}。專案：${hit.proj.map(x=>x.n).join('、')||'無'}。`;
 return '可以問我：「目前交接多少人？」「哪些逾期？」「王小明的交接狀況」。';}
async function chat(q,sid){
 const list=(await load()).people;
 if(CFG.caiEndpoint){try{const r=await fetch(CFG.caiEndpoint,{method:'POST',headers:{'Content-Type':'application/json',...(E.CAI_API_KEY?{Authorization:'Bearer '+E.CAI_API_KEY}:{})},body:JSON.stringify({sessionId:sid,message:q,text:q})});
  if(r.ok){const j=await r.json();const t=j.reply||j.text||j.answer||(j.messages&&j.messages.map(m=>m.text||'').join('\n'))||JSON.stringify(j);return {source:'C.ai',text:t};}}catch(e){}}
 return {source:'BizForm 快查',text:localAnswer(q,list)};}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const body=req=>new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch(e){r({})}})});
const authed=req=>!PASS||(req.headers.cookie||'').includes('hs='+tok());
const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o));};
http.createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://x');
  if(u.pathname==='/api/login'&&req.method==='POST'){const b=await body(req);if(!PASS||b.code===PASS){res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'hs='+tok()+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400'});return res.end('{"ok":true}');}return send(res,401,{error:'存取碼錯誤'});}
  if(u.pathname==='/api/config')return send(res,200,{needLogin:!!PASS&&!authed(req),formUrl:CFG.formUrl,powerbi:CFG.powerbi,caiEmbed:CFG.caiEmbed,caiHost:CFG.caiHost,caiBot:CFG.caiBot,caiHome:CFG.caiHome,mock:MOCK});
  if(u.pathname.startsWith('/api/')&&!authed(req))return send(res,401,{error:'請先登入'});
  if(u.pathname==='/api/handovers'){try{return send(res,200,await load(u.searchParams.get('refresh')==='1'));}catch(e){return send(res,502,{error:e.message});}}
  if(u.pathname==='/api/crm'){try{const d=await loadCrm(u.searchParams.get('refresh')==='1');return send(res,200,{syncedAt:new Date().toISOString(),...d,sample:u.searchParams.get('debug')==='1'?d.sample:undefined});}catch(e){return send(res,502,{error:e.message});}}
  if(u.pathname==='/api/chat'&&req.method==='POST'){const b=await body(req);return send(res,200,await chat(String(b.q||'').slice(0,500),String(b.sid||'web')));}
  let f=path.join(__dirname,'public',u.pathname==='/'?'index.html':u.pathname);
  if(!f.startsWith(path.join(__dirname,'public'))||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
 }catch(e){send(res,500,{error:e.message});}
}).listen(+(E.PORT||3000),()=>console.log('交接不斷線 running on :'+(E.PORT||3000)+(MOCK?' (MOCK)':'')));
