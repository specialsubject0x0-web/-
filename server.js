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
let cache={t:0,data:null},inflight=null,nextOk=0;const rows=new Map();
async function sync(){
 let list;
 if(MOCK)list=JSON.parse(fs.readFileSync(path.join(__dirname,'data/mock.json'),'utf8'));
 else{
  if(!E.BIZFORM_API_KEY)throw new Error('尚未設定 BIZFORM_API_KEY');
  const q=await bf('/documents/query',{method:'POST',body:JSON.stringify({formId:CFG.formId,pageIndex:0,pageSize:200})});
  const items=Array.isArray(q)?q:(q.items||q.documents||Object.values(q).filter(x=>x&&x.id));
  const now=Date.now(),seen=new Set(),todo=[];
  for(const d of items){seen.add(d.id);const sig=JSON.stringify(d),r=rows.get(d.id);if(!r||r.sig!==sig||now-r.t>60000)todo.push([d,sig]);}
  for(const k of [...rows.keys()])if(!seen.has(k))rows.delete(k);
  await pool(todo,3,async([d,sig])=>{rows.set(d.id,{sig,t:Date.now(),p:shape(await bf('/documents/'+d.id))})});
  list=items.map(d=>rows.get(d.id)&&rows.get(d.id).p).filter(Boolean);
 }
 list=list.map(p=>({risk:[],proj:[],cust:[],...p})).filter(p=>p.name&&!/^\d+$/.test(p.name));
 cache={t:Date.now(),data:{syncedAt:new Date().toISOString(),mock:MOCK,people:list}};return cache.data;}
async function load(force){
 const now=Date.now(),age=now-cache.t;
 if(cache.data&&age<(force?1500:4000))return cache.data;
 if(cache.data&&now<nextOk)return {...cache.data,stale:true};
 if(!inflight)inflight=sync().then(d=>{nextOk=0;return d}).finally(()=>{inflight=null});
 try{return await inflight}catch(e){
  if(cache.data){nextOk=Date.now()+(/ 429 /.test(e.message)?60000:15000);return {...cache.data,stale:true}}
  throw e}}

// ---- Vital CRM（Authorization: ApiKey <金鑰>；路徑 /{服務識別碼}/api/<資源>）----
const CRM={base:(E.CRM_BASE||'https://crm.vitalyun.com').replace(/\/$/,''),id:E.CRM_SERVICE_ID||'e1771937af72548c58e0f5ae0aa75397',key:E.CRM_API_KEY||''};
const pick=(o,ks)=>{if(!o||typeof o!=='object')return '';const m={};for(const k of Object.keys(o))m[k.toLowerCase()]=o[k];for(const k of ks){let v=m[k.toLowerCase()];if(v&&typeof v==='object')v=v.name||v.displayName||v.title||v.value||JSON.stringify(v);if(v!==undefined&&v!==null&&v!=='')return v;}return '';};
const findArr=j=>{if(Array.isArray(j))return j;if(j&&j.data&&!Array.isArray(j.data)&&typeof j.data==='object'&&Object.keys(j.data).length>3)return [j.data];if(!j||typeof j!=='object')return [];for(const k of ['items','data','value','results','records','list','rows','opportunities','customers','companies']){const v=j[k];if(Array.isArray(v))return v;if(v&&typeof v==='object'){const r=findArr(v);if(r.length)return r;}}for(const v of Object.values(j))if(Array.isArray(v))return v;return [];};
async function crmGet(res){
 const out=[],seen=new Set();let shape='';
 for(let page=1;page<=20;page++){
  const r=await fetch(`${CRM.base}/${CRM.id}/api/${res}?page=${page}&pageIndex=${page}&pageSize=100&$top=100`,{headers:{Authorization:'ApiKey '+CRM.key,Accept:'application/json'}});
  if(!r.ok)throw new Error('CRM '+res+' '+r.status+' '+(await r.text()).slice(0,120));
  const j=await r.json();if(page===1)shape=Array.isArray(j)?'array':'object{'+Object.keys(j||{}).join(',')+'}';
  const arr=findArr(j);let fresh=0;
  for(const x of arr){const k=JSON.stringify(x);if(!seen.has(k)){seen.add(k);out.push(x);fresh++;}}
  if(!fresh||arr.length<100)break;
 }
 out.shape=shape;return out;}
const normOpp=o=>({id:pick(o,['id','opportunityId','companyId','customerId']),name:pick(o,['name','title','subject','opportunityName']),customer:pick(o,['customerName','customer','companyName','company','account','accountName','contactName']),stage:pick(o,['statusName','closeStatus','status','stage','stageName','opportunityStatus']),amount:Number(pick(o,['amount','subtotal','expectedAmount','estimatedAmount','totalAmount','value']))||0,owner:pick(o,['salesRepresentativeName','ownerName','owner','salesperson','assignedTo','responsible','createdByName']),close:String(pick(o,['expectedCloseDate','closeDate','estimatedCloseDate','dueDate','endDate'])).slice(0,10),product:pick(o,['productName','product','products']),created:String(pick(o,['createdDate','createdOn','createDate','createdAt'])).slice(0,10)});
const normCust=o=>({id:pick(o,['id','customerId','companyId']),name:pick(o,['name','fullName','companyName','displayName','customerName']),phone:pick(o,['phone','mobile','telephone','tel','contactPhone']),email:pick(o,['email','mail','emailAddress']),owner:pick(o,['ownerName','owner','salesperson'])});
let ccache={t:0,data:null};
async function loadCrm(force){
 if(!force&&ccache.data&&Date.now()-ccache.t<5000)return ccache.data;
 if(MOCK){ccache={t:Date.now(),data:{mock:true,opps:[{id:1,name:'宏遠精密 年度維護續約',customer:'宏遠精密工業',stage:'報價中',amount:480000,owner:'王小明',close:'2026-11-20',product:'年度維護'},{id:2,name:'聯晟資訊 ERP 擴充模組',customer:'聯晟資訊',stage:'需求確認',amount:1200000,owner:'王小明',close:'2026-12-05',product:'ERP 模組'}],customers:[{id:1,name:'宏遠精密工業'},{id:2,name:'聯晟資訊'}],companies:[],sample:null}};return ccache.data;}
 if(!CRM.key)throw new Error('尚未設定 CRM_API_KEY');
 const [o,c,co]=await Promise.all([crmGet('opportunities'),crmGet('customers').catch(()=>[]),crmGet('companies').catch(()=>[])]);
 ccache={t:Date.now(),data:{opps:o.map(normOpp),customers:c.map(normCust),companies:co.map(normCust),sample:{shape:{opportunities:o.shape,customers:c.shape,companies:co.shape},opportunity:o[0]||null,customer:c[0]||null,company:co[0]||null}}};return ccache.data;}
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
// ---- 零相依 .xlsx 產生器（匯出交接明細）----
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc32=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0};
function zip(files){const loc=[],cen=[];let off=0;
 for(const [name,data] of files){const nb=Buffer.from(name),d=Buffer.from(data),c=crc32(d);
  const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x0800,6);h.writeUInt16LE(0x21,12);h.writeUInt32LE(c,14);h.writeUInt32LE(d.length,18);h.writeUInt32LE(d.length,22);h.writeUInt16LE(nb.length,26);
  loc.push(h,nb,d);
  const e=Buffer.alloc(46);e.writeUInt32LE(0x02014b50,0);e.writeUInt16LE(20,4);e.writeUInt16LE(20,6);e.writeUInt16LE(0x0800,8);e.writeUInt16LE(0x21,14);e.writeUInt32LE(c,16);e.writeUInt32LE(d.length,20);e.writeUInt32LE(d.length,24);e.writeUInt16LE(nb.length,28);e.writeUInt32LE(off,42);
  cen.push(e,nb);off+=30+nb.length+d.length}
 const cb=Buffer.concat(cen),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cb.length,12);end.writeUInt32LE(off,16);
 return Buffer.concat([...loc,cb,end]);}
const xe=s=>String(s==null?'':s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const colName=i=>{let s='';for(i++;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s};
function sheetXml(head,rows){
 const wid=v=>[...String(v==null?'':v)].reduce((a,ch)=>a+(ch.charCodeAt(0)>255?2:1),0);
 const cols=head.map((h,i)=>Math.min(48,Math.max(9,wid(h)+4,...rows.map(r=>wid(r[i])+2))));
 const cell=(v,i,r,hd)=>typeof v==='number'&&isFinite(v)?`<c r="${colName(i)}${r}"><v>${v}</v></c>`:`<c r="${colName(i)}${r}" t="inlineStr"${hd?' s="1"':''}><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
 const body=[head,...rows].map((r,ri)=>`<row r="${ri+1}">${r.map((v,i)=>cell(v,i,ri+1,ri===0)).join('')}</row>`).join('');
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${colName(head.length-1)}${rows.length+1}"/></worksheet>`;}
function buildXlsx(sheets){
 const hdr='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 const files=[
  ['[Content_Types].xml',hdr+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+'</Types>'],
  ['_rels/.rels',hdr+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
  ['xl/workbook.xml',hdr+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheets.map((s,i)=>`<sheet name="${xe(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+'</sheets></workbook>'],
  ['xl/_rels/workbook.xml.rels',hdr+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+`<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
  ['xl/styles.xml',hdr+'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft JhengHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft JhengHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F2A3C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
  ...sheets.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(s.head,s.rows)])];
 return zip(files);}
function sheetsOf(people){
 const today=new Date();today.setHours(0,0,0,0);
 const days=p=>Math.round((new Date(String(p.last||'').replace(/\//g,'-'))-today)/864e5);
 const who=p=>[p.name,p.dept,p.recv];
 const num=v=>{const n=parseFloat(v);return isNaN(n)?(v||''):n};
 return [
  {name:'交接總覽',head:['BizForm 文件編號','員工編號','移交人','部門','職稱','接交人','監交人','交接原因','最後工作日','剩餘天數','交接起始日','交接完成日','狀態','7 大項確認（項）','完成度（%）','簽名數（/3）','專案數','客戶窗口數','未結事項數'],
   rows:people.map(p=>[p.id,p.emp,p.name,p.dept,p.title,p.recv,p.boss,p.reason,p.last,days(p),p.start,p.end,status(p),p.ck,Math.round(p.ck/7*100),p.sg,p.proj.length,p.cust.length,p.risk.length])},
  {name:'待移轉專案',head:['移交人','部門','接交人','專案／案件名稱','客戶／需求單位','目前進度（%）','截止日','下一里程碑','已知問題與風險'],
   rows:people.flatMap(p=>p.proj.map(x=>[...who(p),x.n,x.c,num(x.p),x.d,x.nx,x.r]))},
  {name:'客戶窗口',head:['移交人','部門','接交人','單位名稱','聯絡人／職稱','類別'],rows:people.flatMap(p=>p.cust.map(x=>[...who(p),x.n,x.c,x.t]))},
  {name:'未結事項與風險',head:['移交人','部門','接交人','未結事項','風險等級','負責人','追蹤日期'],rows:people.flatMap(p=>p.risk.map(x=>[...who(p),x.n,x.l,x.o,x.d]))}];}
function exportXlsx(people){return buildXlsx(sheetsOf(people));}
const csvCell=v=>{const s=String(v==null?'':v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
const toCsv=sh=>'\ufeff'+[sh.head,...sh.rows].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
const FEEDS={handovers:0,projects:1,customers:2,risks:3};
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const body=req=>new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch(e){r({})}})});
const authed=req=>!PASS||(req.headers.cookie||'').includes('hs='+tok());
const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o));};
http.createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://x');
  if(u.pathname==='/api/login'&&req.method==='POST'){const b=await body(req);if(!PASS||b.code===PASS){res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'hs='+tok()+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400'});return res.end('{"ok":true}');}return send(res,401,{error:'存取碼錯誤'});}
  if(u.pathname==='/api/config')return send(res,200,{needLogin:!!PASS&&!authed(req),formUrl:CFG.formUrl,powerbi:CFG.powerbi,caiEmbed:CFG.caiEmbed,caiHost:CFG.caiHost,caiBot:CFG.caiBot,caiHome:CFG.caiHome,mock:MOCK});
  if(u.pathname.startsWith('/api/')&&!authed(req))return send(res,401,{error:'請先登入'});
  if(u.pathname.startsWith('/feed/')){try{
   const ok=!PASS||authed(req)||u.searchParams.get('key')===PASS||req.headers['x-feed-key']===PASS;
   if(!ok){res.writeHead(401,{'Content-Type':'text/plain; charset=utf-8'});return res.end('需要存取碼：請在網址加上 ?key=存取碼，或加上標頭 x-feed-key');}
   const m=u.pathname.match(/^\/feed\/(\w+)\.(csv|json)$/);if(!m||!(m[1] in FEEDS)){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('可用：/feed/handovers.csv、projects.csv、customers.csv、risks.csv（也支援 .json）');}
   const d=await load(false),sh=sheetsOf(d.people)[FEEDS[m[1]]];
   if(m[2]==='json'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(JSON.stringify(sh.rows.map(r=>Object.fromEntries(sh.head.map((h,i)=>[h,r[i]==null?'':r[i]])))));}
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Cache-Control':'no-store'});return res.end(toCsv(sh));
  }catch(e){res.writeHead(502,{'Content-Type':'text/plain; charset=utf-8'});return res.end('BizForm 連線失敗：'+e.message);}}
  if(u.pathname==='/api/export.xlsx'){try{const d=await load(u.searchParams.get('refresh')==='1');const f=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date()).replace(/[-: ]/g,'').replace(/^(\d{8})(\d{4})$/,'$1_$2');const fn='交接明細_'+f+'.xlsx';res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="handover_'+f+'.xlsx"; filename*=UTF-8\'\''+encodeURIComponent(fn),'Cache-Control':'no-store'});return res.end(exportXlsx(d.people));}catch(e){return send(res,502,{error:e.message});}}
  if(u.pathname==='/api/handovers'){try{return send(res,200,await load(u.searchParams.get('refresh')==='1'));}catch(e){return send(res,502,{error:e.message});}}
  if(u.pathname==='/api/crm'){try{const d=await loadCrm(u.searchParams.get('refresh')==='1');return send(res,200,{syncedAt:new Date().toISOString(),...d,sample:u.searchParams.get('debug')==='1'?d.sample:undefined});}catch(e){return send(res,502,{error:e.message});}}
  if(u.pathname==='/api/chat'&&req.method==='POST'){const b=await body(req);return send(res,200,await chat(String(b.q||'').slice(0,500),String(b.sid||'web')));}
  let f=path.join(__dirname,'public',u.pathname==='/'?'index.html':u.pathname);
  if(!f.startsWith(path.join(__dirname,'public'))||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
 }catch(e){send(res,500,{error:e.message});}
}).listen(+(E.PORT||3000),()=>console.log('交接不斷線 running on :'+(E.PORT||3000)+(MOCK?' (MOCK)':'')));
