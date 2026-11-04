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
 const ckTxt=find(A,'交接完整度')||'',checks=ckTxt.match(/[一二三四五六七]、/g)||[];
 const cki=[];for(const seg of ckTxt.split(/(?=[一二三四五六七]、)/)){const m=seg.match(/^([一二三四五六七])、/);if(m){const i='一二三四五六七'.indexOf(m[1]);if(!cki.includes(i))cki.push(i);CKL[i]=seg.slice(2).replace(/[、,，;；\s]+$/,'').trim()||CKL[i];}}
 const P={id:g.id,name:find(A,'移交人姓名'),emp:find(A,'員工編號'),dept:find(A,'部門'),title:find(A,'職稱'),last:find(A,'最後工作日'),recv:find(A,'接交人姓名'),boss:find(A,'直屬主管'),reason:find(A,'交接原因'),start:find(A,'交接起始日'),end:find(A,'交接完成日'),
  recvMail:(()=>{const k=Object.keys(A).find(k=>/接交人/.test(k)&&/(e-?mail|信箱|郵件)/i.test(k));return k?String(A[k]).trim():''})(),cki,sgi:{移交:!!A['移交人簽名'],接交:!!A['接交人簽名'],監交:!!A['監交人簽名']},ck:checks.length,sg:['移交人簽名','接交人簽名','監交人簽名'].filter(k=>A[k]).length,proj:[],cust:[],risk:[]};
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
 cache={t:Date.now(),data:{syncedAt:new Date().toISOString(),mock:MOCK,people:enrich(list)}};return cache.data;}
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
const WEATHER_CODES={0:'晴朗',1:'大致晴朗',2:'局部多雲',3:'陰天',45:'有霧',48:'霧淞',51:'毛毛雨',53:'毛毛雨',55:'較強毛毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'短暫陣雨',81:'陣雨',82:'強陣雨',95:'雷雨',96:'雷雨伴冰雹',99:'強雷雨伴冰雹'};
// 外部服務偶爾回傳簡體地名或摘要；交接小幫手一律以繁體中文顯示。
const SIMP_TO_TRAD={万:'萬',与:'與',个:'個',为:'為',么:'麼',义:'義',乌:'烏',乐:'樂',乔:'喬',习:'習',乡:'鄉',书:'書',买:'買',乱:'亂',争:'爭',于:'於',亏:'虧',云:'雲',亚:'亞',产:'產',亩:'畝',亲:'親',亿:'億',仅:'僅',从:'從',仓:'倉',仪:'儀',们:'們',价:'價',众:'眾',优:'優',伙:'夥',会:'會',伞:'傘',伟:'偉',传:'傳',伤:'傷',伦:'倫',伪:'偽',体:'體',余:'餘',佛:'佛',作:'作',侦:'偵',侧:'側',侨:'僑',侬:'儂',债:'債',倾:'傾',偿:'償',儿:'兒',党:'黨',兰:'蘭',关:'關',兴:'興',养:'養',兽:'獸',冈:'岡',册:'冊',军:'軍',农:'農',冲:'沖',冻:'凍',凉:'涼',减:'減',几:'幾',凤:'鳳',凭:'憑',凯:'凱',击:'擊',划:'劃',刘:'劉',则:'則',刚:'剛',创:'創',剧:'劇',办:'辦',务:'務',动:'動',劲:'勁',劳:'勞',势:'勢',勋:'勳',匀:'勻',华:'華',协:'協',单:'單',卖:'賣',卫:'衛',却:'卻',厅:'廳',历:'歷',厉:'厲',压:'壓',厌:'厭',厦:'廈',县:'縣',参:'參',双:'雙',发:'發',变:'變',叙:'敘',叶:'葉',号:'號',叹:'嘆',台:'臺',后:'後',听:'聽',吴:'吳',员:'員',启:'啟',呐:'吶',呛:'嗆',唤:'喚',问:'問',啓:'啟',喽:'嘍',喷:'噴',器:'器',团:'團',园:'園',围:'圍',国:'國',图:'圖',圆:'圓',场:'場',坏:'壞',块:'塊',坚:'堅',坛:'壇',坝:'壩',壮:'壯',声:'聲',处:'處',备:'備',够:'夠',头:'頭',夹:'夾',夺:'奪',奋:'奮',奖:'獎',奥:'奧',妇:'婦',妈:'媽',孙:'孫',学:'學',宁:'寧',宝:'寶',实:'實',审:'審',写:'寫',宽:'寬',宾:'賓',对:'對',寻:'尋',导:'導',将:'將',尔:'爾',尘:'塵',尝:'嘗',尧:'堯',尴:'尷',层:'層',属:'屬',岁:'歲',岚:'嵐',岛:'島',岭:'嶺',岳:'嶽',峡:'峽',巅:'巔',币:'幣',帮:'幫',带:'帶',帐:'帳',帘:'簾',师:'師',帧:'幀',库:'庫',应:'應',庙:'廟',废:'廢',广:'廣',庄:'莊',庆:'慶',库:'庫',开:'開',异:'異',弃:'棄',张:'張',弹:'彈',强:'強',归:'歸',录:'錄',当:'當',彻:'徹',怀:'懷',态:'態',总:'總',恋:'戀',恒:'恆',恶:'惡',恼:'惱',悦:'悅',悬:'懸',惊:'驚',惩:'懲',惯:'慣',愿:'願',戏:'戲',户:'戶',执:'執',扩:'擴',扫:'掃',扬:'揚',扰:'擾',抚:'撫',抢:'搶',护:'護',报:'報',担:'擔',择:'擇',据:'據',拟:'擬',拥:'擁',挤:'擠',挥:'揮',损:'損',换:'換',挥:'揮',摄:'攝',摆:'擺',摇:'搖',摊:'攤',敌:'敵',数:'數',斋:'齋',断:'斷',无:'無',旧:'舊',时:'時',晋:'晉',晓:'曉',暂:'暫',术:'術',机:'機',杀:'殺',杂:'雜',权:'權',条:'條',来:'來',杨:'楊',杰:'傑',极:'極',构:'構',枪:'槍',标:'標',栋:'棟',栏:'欄',树:'樹',样:'樣',档:'檔',桥:'橋',梦:'夢',检:'檢',楼:'樓',欧:'歐',欢:'歡',岁:'歲',残:'殘',毁:'毀',毕:'畢',气:'氣',汇:'匯',汉:'漢',汤:'湯',沟:'溝',没:'沒',沪:'滬',泪:'淚',泽:'澤',洁:'潔',济:'濟',浓:'濃',涛:'濤',润:'潤',涨:'漲',渐:'漸',湾:'灣',湿:'濕',灭:'滅',灯:'燈',灵:'靈',灾:'災',炉:'爐',点:'點',炼:'煉',热:'熱',爱:'愛',爷:'爺',爸:'爸',状:'狀',独:'獨',猎:'獵',现:'現',环:'環',玛:'瑪',玺:'璽',琼:'瓊',环:'環',画:'畫',畅:'暢',疗:'療',疯:'瘋',监:'監',盘:'盤',着:'著',矫:'矯',矿:'礦',码:'碼',砖:'磚',礼:'禮',祸:'禍',种:'種',积:'積',稳:'穩',穷:'窮',窗:'窗',竞:'競',笔:'筆',筑:'築',签:'簽',简:'簡',粮:'糧',红:'紅',纪:'紀',约:'約',级:'級',终:'終',练:'練',组:'組',细:'細',织:'織',统:'統',绝:'絕',绿:'綠',缓:'緩',编:'編',缘:'緣',罚:'罰',罗:'羅',职:'職',联:'聯',聪:'聰',肃:'肅',肠:'腸',肤:'膚',脸:'臉',腾:'騰',艺:'藝',节:'節',苏:'蘇',药:'藥',蓝:'藍',虑:'慮',虚:'虛',虽:'雖',虫:'蟲',补:'補',袭:'襲',装:'裝',见:'見',观:'觀',规:'規',觉:'覺',览:'覽',触:'觸',订:'訂',计:'計',认:'認',讨:'討',让:'讓',讯:'訊',许:'許',论:'論',设:'設',访:'訪',证:'證',评:'評',词:'詞',试:'試',诗:'詩',诚:'誠',话:'話',该:'該',详:'詳',语:'語',误:'誤',说:'說',请:'請',诸:'諸',读:'讀',谁:'誰',调:'調',谈:'談',谢:'謝',谣:'謠',贝:'貝',负:'負',财:'財',贡:'貢',贫:'貧',货:'貨',质:'質',贩:'販',贪:'貪',贯:'貫',贱:'賤',贴:'貼',贵:'貴',贷:'貸',费:'費',贺:'賀',赵:'趙',赶:'趕',趋:'趨',跃:'躍',跻:'躋',车:'車',轨:'軌',转:'轉',轮:'輪',软:'軟',较:'較',辅:'輔',辆:'輛',辞:'辭',边:'邊',辽:'遼',达:'達',迁:'遷',过:'過',运:'運',还:'還',进:'進',远:'遠',违:'違',连:'連',迟:'遲',适:'適',选:'選',遗:'遺',邓:'鄧',郑:'鄭',邻:'鄰',郁:'鬱',邮:'郵',邻:'鄰',郸:'鄲',酝:'醞',释:'釋',鉴:'鑑',钟:'鐘',钢:'鋼',钱:'錢',铁:'鐵',铃:'鈴',铅:'鉛',银:'銀',铜:'銅',铭:'銘',铺:'鋪',链:'鏈',锅:'鍋',锻:'鍛',镇:'鎮',镜:'鏡',长:'長',门:'門',闭:'閉',问:'問',闲:'閒',间:'間',闷:'悶',闻:'聞',闽:'閩',阁:'閣',阅:'閱',队:'隊',阳:'陽',阴:'陰',际:'際',陆:'陸',陈:'陳',险:'險',随:'隨',隐:'隱',难:'難',雇:'僱',雾:'霧',霸:'霸',青:'青',静:'靜',顶:'頂',顺:'順',须:'須',顾:'顧',顿:'頓',领:'領',颗:'顆',题:'題',颜:'顏',额:'額',风:'風',飞:'飛',饭:'飯',饮:'飲',饲:'飼',馆:'館',马:'馬',驭:'馭',驱:'驅',验:'驗',骑:'騎',骗:'騙',骚:'騷',鱼:'魚',鲁:'魯',鲜:'鮮',鸟:'鳥',鸣:'鳴',鸭:'鴨',鸡:'雞',麦:'麥',黄:'黃',黑:'黑',齐:'齊',龙:'龍',龟:'龜'};
const traditional=s=>String(s==null?'':s).replace(/[\u3400-\u9fff]/g,c=>SIMP_TO_TRAD[c]||c);
const WEATHER_PLACES={淡水:[25.164889,121.448906,'新北市淡水區'],臺北:[25.037658,121.514853,'臺北市'],台北:[25.037658,121.514853,'臺北市'],新北:[24.959207,121.525196,'新北市'],基隆:[25.133314,121.740475,'基隆市'],宜蘭:[24.763975,121.756528,'宜蘭縣'],花蓮:[23.975128,121.613275,'花蓮縣']};
const GEO_CACHE=new Map();
const COUNTRY_NAMES={台灣:'Taiwan',臺灣:'Taiwan',美國:'United States',英國:'United Kingdom',法國:'France',德國:'Germany',義大利:'Italy',意大利:'Italy',西班牙:'Spain',葡萄牙:'Portugal',荷蘭:'Netherlands',比利時:'Belgium',瑞士:'Switzerland',奧地利:'Austria',日本:'Japan',韓國:'South Korea',南韓:'South Korea',中國:'China',俄羅斯:'Russia',烏克蘭:'Ukraine',澳洲:'Australia',澳大利亞:'Australia',紐西蘭:'New Zealand',加拿大:'Canada',墨西哥:'Mexico',巴西:'Brazil',阿根廷:'Argentina',智利:'Chile',秘魯:'Peru',印度:'India',泰國:'Thailand',越南:'Vietnam',新加坡:'Singapore',馬來西亞:'Malaysia',印尼:'Indonesia',印度尼西亞:'Indonesia',菲律賓:'Philippines',阿聯:'United Arab Emirates',土耳其:'Turkey',希臘:'Greece',埃及:'Egypt',南非:'South Africa',以色列:'Israel'};
const CITY_NAMES={巴黎:'Paris',倫敦:'London',紐約:'New York',洛杉磯:'Los Angeles',舊金山:'San Francisco',芝加哥:'Chicago',華盛頓:'Washington',東京:'Tokyo',大阪:'Osaka',京都:'Kyoto',首爾:'Seoul',釜山:'Busan',曼谷:'Bangkok',河內:'Hanoi',胡志明市:'Ho Chi Minh City',吉隆坡:'Kuala Lumpur',雅加達:'Jakarta',馬尼拉:'Manila',雪梨:'Sydney',悉尼:'Sydney',墨爾本:'Melbourne',奧克蘭:'Auckland',多倫多:'Toronto',溫哥華:'Vancouver',蒙特婁:'Montreal',羅馬:'Rome',米蘭:'Milan',馬德里:'Madrid',巴塞隆納:'Barcelona',柏林:'Berlin',慕尼黑:'Munich',阿姆斯特丹:'Amsterdam',布魯塞爾:'Brussels',維也納:'Vienna',蘇黎世:'Zurich',布拉格:'Prague',莫斯科:'Moscow',伊斯坦堡:'Istanbul',杜拜:'Dubai',開羅:'Cairo',約翰尼斯堡:'Johannesburg',里約:'Rio de Janeiro',聖保羅:'Sao Paulo',布宜諾斯艾利斯:'Buenos Aires',墨西哥城:'Mexico City'};
const weatherQuery=q=>/天氣|氣溫|溫度|下雨|降雨|體感|幾度|冷不冷|熱不熱|weather|temperature|forecast|rain|degree/i.test(q)||Object.keys(WEATHER_PLACES).some(x=>new RegExp('^'+x+'[市區縣]?[？?！!。 ]*$').test(q));
function canonicalPlace(q){let country='';for(const k of Object.keys(COUNTRY_NAMES).sort((a,b)=>b.length-a.length)){if(q.startsWith(k)){country=COUNTRY_NAMES[k];q=q.slice(k.length);break}}const city=CITY_NAMES[q]||q;return country?(city?city+', '+country:country):city;}
async function locatePlace(query){
 const place=canonicalPlace(query),key=place.toLowerCase(),hit=GEO_CACHE.get(key);if(hit&&Date.now()-hit.t<86400000)return hit.v;
 const save=v=>{if(v)GEO_CACHE.set(key,{t:Date.now(),v});return v};
 try{const u='https://geocoding-api.open-meteo.com/v1/search?count=5&language=zh&name='+encodeURIComponent(place),r=await fetch(u,{signal:AbortSignal.timeout(9000)});if(r.ok){const x=(await r.json()).results?.[0];if(x)return save([x.latitude,x.longitude,[x.name,x.admin1,x.country].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join('・')]);}}catch(e){}
 try{const u='https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=zh-TW,zh&q='+encodeURIComponent(place),r=await fetch(u,{headers:{'User-Agent':'handover-site-weather/1.0'},signal:AbortSignal.timeout(9000)});if(r.ok){const xs=await r.json(),x=xs.find(v=>/city|town|village|municipality|county|state|country/.test(String(v.addresstype||v.type||'')));if(x&&x.lat&&x.lon)return save([+x.lat,+x.lon,x.display_name||place]);}}catch(e){}
 return null;
}
async function weatherAnswer(q){
 if(!weatherQuery(q))return null;
 let place=Object.keys(WEATHER_PLACES).find(x=>q.includes(x)),info=place&&WEATHER_PLACES[place];
 if(!info){const cleaned=q.replace(/今天|明天|後天|目前|現在|即時|的|天氣|氣溫|溫度|多少|如何|怎麼樣|會不會|下雨|降雨|體感|[？?！!。]/g,' ').trim();
  if(!cleaned)return {source:'即時天氣',text:'請告訴我想查的地區，例如：「淡水目前氣溫多少？」或「臺北明天天氣如何？」'};
  info=await locatePlace(cleaned);
 }
 if(!info)return {source:'即時天氣',text:'找不到這個地區。請輸入城市、行政區或國家名稱，例如「東京」、「倫敦」或「高雄」。'};
 try{const [lat,lon,label]=info,url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=3`,r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json(),offset=/後天/.test(q)?2:/明天/.test(q)?1:0,day=offset?'明天後天'.slice((offset-1)*2,offset*2):'今天',c=offset?j.daily.weather_code[offset]:j.current.weather_code,temp=offset?`${j.daily.temperature_2m_min[offset]}～${j.daily.temperature_2m_max[offset]} °C`:`${j.current.temperature_2m} °C`,ap=offset?'':`\n- **體感溫度**：${j.current.apparent_temperature} °C`;
  return {source:'Open-Meteo',text:`### 🌤️ ${label}${offset?day:'目前'}天氣\n\n- **氣溫${offset?'範圍':'（模型估計）'}**：${temp}\n- **天氣**：${WEATHER_CODES[c]||'天氣代碼 '+c}${ap}\n- **最高降雨機率**：${j.daily.precipitation_probability_max[offset]}%\n\n**資料時間**：${offset?j.daily.time[offset]:j.current.time}（當地時間）\n\n_資料為該地區附近的天氣模型估計與預報，實際情況可能不同。_`};
 }catch(e){return {source:'即時天氣',text:'目前無法取得天氣資料，請稍後再試；我不會猜測即時氣溫。'};}
}
async function chat(q,sid){
 const list=(await load()).people;
 {const w=await weatherAnswer(q);if(w)return w;const s=smartChat(q,list);if(s)return s;if(handoverQuestion(q,list)){const l=await llm(q,list);if(l)return l;}else{const g=await generalAnswer(q,sid);if(g)return g;}}
 if(CFG.caiEndpoint){try{const r=await fetch(CFG.caiEndpoint,{method:'POST',headers:{'Content-Type':'application/json',...(E.CAI_API_KEY?{Authorization:'Bearer '+E.CAI_API_KEY}:{})},body:JSON.stringify({sessionId:sid,message:q,text:q})});
  if(r.ok){const j=await r.json();const t=j.reply||j.text||j.answer||(j.messages&&j.messages.map(m=>m.text||'').join('\n'))||JSON.stringify(j);return {source:'C.ai',text:t};}}catch(e){}}
 return handoverQuestion(q,list)?{source:'BizForm 快查',text:localAnswer(q,list)}:{source:'交接小幫手',text:'一般問答服務暫時無法回覆，請稍後再試。若要取得即時網路資訊，請確認 Render 已設定 TAVILY_API_KEY。'};}
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
  {name:'交接總覽',head:['BizForm 文件編號','員工編號','移交人','部門','職稱','接交人','監交人','交接原因','最後工作日','剩餘天數','交接起始日','交接完成日','狀態','7 大項確認（項）','完成度（%）','簽名數（/3）','專案數','客戶窗口數','未結事項數','風險分數','風險燈號','卡關位置','單點依賴指數（%）'],
   rows:people.map(p=>[p.id,p.emp,p.name,p.dept,p.title,p.recv,p.boss,p.reason,p.last,days(p),p.start,p.end,status(p),p.ck,Math.round(p.ck/7*100),p.sg,p.proj.length,p.cust.length,p.risk.length,p.rs?p.rs.score:'',p.rs?p.rs.lv:'',p.stuck?p.stuck.text:'',p.spof?p.spof.idx:''])},
  {name:'待移轉專案',head:['移交人','部門','接交人','專案／案件名稱','客戶／需求單位','目前進度（%）','截止日','下一里程碑','已知問題與風險'],
   rows:people.flatMap(p=>p.proj.map(x=>[...who(p),x.n,x.c,num(x.p),x.d,x.nx,x.r]))},
  {name:'客戶窗口',head:['移交人','部門','接交人','單位名稱','聯絡人／職稱','類別'],rows:people.flatMap(p=>p.cust.map(x=>[...who(p),x.n,x.c,x.t]))},
  {name:'未結事項與風險',head:['移交人','部門','接交人','未結事項','風險等級','負責人','追蹤日期'],rows:people.flatMap(p=>p.risk.map(x=>[...who(p),x.n,x.l,x.o,x.d]))}];}
function exportXlsx(people){return buildXlsx(sheetsOf(people));}
const csvCell=v=>{const s=String(v==null?'':v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
const toCsv=sh=>'\ufeff'+[sh.head,...sh.rows].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
const FEEDS={handovers:0,projects:1,customers:2,risks:3};
// ======== 競賽強化模組：風險分數／卡關項目／單點依賴／AI 摘要／通知／PDF 報告 ========
const CKL=[],SGN=[['移交','移交人'],['接交','接交人'],['監交','監交人']];
const dleft=p=>{const t=new Date();t.setHours(0,0,0,0);const d=new Date(String(p.last||'').replace(/\//g,'-'));return isNaN(d)?999:Math.round((d-t)/864e5)};
const dayTo=s=>{if(!s)return null;const t=new Date();t.setHours(0,0,0,0);const d=new Date(String(s).replace(/\//g,'-'));return isNaN(d)?null:Math.round((d-t)/864e5)};
const il=x=>x.t?`第 ${x.i} 項「${x.t}」`:`第 ${x.i} 項`;
const clr=v=>!v||/^(無|—|-|n\/a|none)$/i.test(String(v).trim());
function enrich(list){
 const cc=new Map(),pc=new Map(),rv=new Map(),dp=new Map();
 for(const p of list){for(const c of new Set(p.cust.map(x=>(x.n||'').trim()).filter(Boolean)))cc.set(c,(cc.get(c)||0)+1);
  for(const c of new Set(p.proj.map(x=>(x.c||'').trim()).filter(Boolean)))pc.set(c,(pc.get(c)||0)+1);
  if(status(p)!=='已完成'){const r=rv.get(p.recv)||{name:p.recv,n:0,pj:0};r.n++;r.pj+=p.proj.length;rv.set(p.recv,r);dp.set(p.dept,(dp.get(p.dept)||0)+1);}}
 for(const p of list){
  const st=status(p),done=st==='已完成',d=dleft(p);
  p.cki=p.cki||Array.from({length:p.ck},(_,i)=>i);
  p.sgi=p.sgi||{移交:p.sg>0,接交:p.sg>1,監交:p.sg>2};
  p.ckl=Array.from({length:7},(_,i)=>CKL[i]||'');
  const mi=[0,1,2,3,4,5,6].filter(i=>!p.cki.includes(i)).map(i=>({i:i+1,t:p.ckl[i]})),ms=SGN.filter(([k])=>!p.sgi[k]).map(([,n])=>n+'簽名');
  let tx='全部完成';
  if(!done){if(mi.length)tx=`卡在${il(mi[0])}`+(mi.length>1?`，另有 ${mi.length-1} 項未確認`:'')+(ms.length?`；${ms.join('、')}未簽`:'');else if(ms.length)tx=`7 項已確認，卡在${ms[0]}`+(ms.length>1?`（另缺 ${ms.slice(1).join('、')}）`:'');}
  p.stuck={items:mi,sig:ms,text:tx};
  const parts=[];
  parts.push({k:'完成度',pts:Math.round((7-p.ck)/7*30),max:30,txt:`7 項確認完成 ${p.ck} 項`});
  const tp=d<0?Math.min(25,22+Math.ceil(-d/10)):d<=3?22:d<=7?18:d<=14?12:d<=30?6:2;
  parts.push({k:'剩餘天數',pts:tp,max:25,txt:d<0?`已逾期 ${-d} 天`:d>900?'未填最後工作日':`距最後工作日 ${d} 天`});
  const pg=p.proj.filter(x=>(+x.p||0)<100).map(x=>{const dd=dayTo(x.d),w=dd===null?0.4:dd<0?1:dd<=14?0.8:dd<=d+7?0.6:0.3;return (100-Math.min(100,+x.p||0))/100*w});
  parts.push({k:'專案進度落差',pts:p.proj.length?Math.round(pg.reduce((a,b)=>a+b,0)/p.proj.length*20):0,max:20,txt:p.proj.length?`${p.proj.length} 案、平均進度 ${Math.round(p.proj.reduce((a,x)=>a+Math.min(100,+x.p||0),0)/p.proj.length)}%`:'未填專案'});
  let rk=0;for(const x of p.risk)rk+=/高/.test(x.l||'')?6:/中/.test(x.l||'')?3:1;for(const x of p.proj)if(!clr(x.r))rk+=2;
  parts.push({k:'未結風險',pts:Math.min(15,rk),max:15,txt:`${p.risk.length} 件未結事項（高風險 ${p.risk.filter(x=>/高/.test(x.l||'')).length}）`});
  parts.push({k:'簽名狀態',pts:Math.round((3-p.sg)/3*10),max:10,txt:`簽名 ${p.sg}/3`+(ms.length?`（缺${ms.join('、')}）`:'')});
  const score=done?0:Math.min(100,parts.reduce((a,x)=>a+x.pts,0));
  p.rs={score,lv:score>=55?'高':score>=30?'中':'低',parts:done?parts.map(x=>({...x,pts:0})):parts};
  const sc=p.cust.filter(c=>cc.get((c.n||'').trim())===1).map(c=>c.n+(c.c?`（${c.c}）`:'')),sp=p.proj.filter(x=>x.c&&pc.get(x.c.trim())===1&&!cc.get(x.c.trim())).map(x=>x.n+(x.c?`（${x.c}）`:''));
  const tot=p.cust.length+p.proj.length,rl=rv.get(p.recv)||{n:0,pj:0};
  p.spof={cust:sc,proj:sp,idx:tot?Math.round((sc.length+sp.length)/tot*100):0,recvN:rl.n,recvPj:rl.pj};
 }
 return list;}
function anaOf(list){const a=list.filter(p=>status(p)!=='已完成');const rv={},dp={};for(const p of a){const r=rv[p.recv]||(rv[p.recv]={name:p.recv,n:0,pj:0});r.n++;r.pj+=p.proj.length;dp[p.dept]=(dp[p.dept]||0)+1;}
 return {recv:Object.values(rv).filter(x=>x.name).sort((x,y)=>y.pj-x.pj||y.n-x.n),dept:Object.entries(dp).map(([n,c])=>({n,c})).sort((x,y)=>y.c-x.c)};}
const RSK=p=>p.rs?p.rs.score:0;
function handoverDetail(p){
 const missing=(p.ckl||[]).map((t,i)=>({t:t||`第 ${i+1} 項`,ok:(p.cki||[]).includes(i)})).filter(x=>!x.ok).map(x=>x.t.replace(/^[一二三四五六七]、/,'').trim());
 const d=dleft(p),remain=d<0?`已逾期 ${-d} 天`:`剩 ${d} 天`;
 return [`### ${p.name}`,`🔵 ${status(p)}`,'',
  `- **員工編號**：${p.emp||'未填'}`,`- **部門**：${p.dept||'未填'}`,`- **職稱**：${p.title||'未填'}`,`- **接交人**：${p.recv||'未填'}`,`- **直屬主管（監交人）**：${p.boss||'未填'}`,`- **最後工作日**：${p.last||'未填'}（${remain}）`,`- **表單確認度**：${Math.round(p.ck/7*100)}%（7 大項已確認 ${p.ck} 項）`,`- **簽名**：${p.sg}/3`,'',
  '**尚未確認**',...(missing.length?missing.map(x=>`- ${x}`):['- 已全部確認']),'',
  '**交接清單**',`- **進行中專案**：${p.proj.length} 筆`,`- **客戶與外部窗口**：${p.cust.length} 筆`,`- **未結事項與風險**：${p.risk.length} 筆`,'',
  '**繼續查詢**',`可以問我：「${p.name}的接手新手清單」或「${p.name}的風險分析」`].join('\n');
}
function summaryOf(p){const st=status(p),d=dleft(p),pr=[...p.rs.parts].sort((a,b)=>b.pts-a.pts).filter(x=>x.pts>0).slice(0,2);
 const L=[`【${p.name} 交接摘要】`,`${p.dept}／${p.title}，最後工作日 ${p.last}（${d<0?'已逾期 '+(-d)+' 天':'剩 '+d+' 天'}），接交人 ${p.recv||'未填'}，監交人 ${p.boss||'未填'}。`,
  `狀態：${st}；7 項確認 ${p.ck}/7（${Math.round(p.ck/7*100)}%）、簽名 ${p.sg}/3；風險燈號「${p.rs.lv}」${p.rs.score} 分。`,`卡關位置：${p.stuck.text}。`];
 if(pr.length)L.push('風險主因：'+pr.map(x=>`${x.k}（${x.txt}，${x.pts}/${x.max} 分）`).join('、')+'。');
 L.push(p.proj.length?`待移轉專案 ${p.proj.length} 件：`+p.proj.slice(0,5).map(x=>`${x.n}（${Math.min(100,+x.p||0)}%${x.d?'，截止 '+x.d:''}）`).join('、')+'。':'尚未填寫待移轉專案。');
 L.push(p.cust.length?`客戶窗口 ${p.cust.length} 個${p.spof.cust.length?`，其中僅 ${p.name} 一人記錄：`+p.spof.cust.slice(0,4).join('、'):''}。`:'尚未填寫客戶窗口。');
 if(p.risk.length)L.push(`未結事項 ${p.risk.length} 件：`+p.risk.slice(0,4).map(x=>`${x.n}（${x.l||'未分級'}）`).join('、')+'。');
 const A=[];if(p.stuck.sig.length)A.push(`催請${p.stuck.sig.join('、')}`);if(p.stuck.items.length)A.push(`與${p.recv||'接交人'}逐項確認第 ${p.stuck.items.map(x=>x.i).join('、')} 項`);if(p.spof.cust.length)A.push(`安排${p.recv||'接交人'}與僅此人掌握的窗口見面`);if(p.risk.some(x=>/高/.test(x.l||'')))A.push('為高風險未結事項指定負責人與追蹤日');if(!A.length)A.push('交接完整，歸檔即可');
 L.push('建議行動：'+A.map((x,i)=>`${i+1}. ${x}`).join('　'));return L.join('\n');}
function onboardOf(p){const L=[`【${p.recv||'接交人'} 接手 ${p.name} 的新手上路清單】`,`${p.name}（${p.dept}／${p.title}）最後工作日 ${p.last}，目前${status(p)}。`,'','▍第 1 天：先把「人」和「事」對齊'];
 L.push(`□ 與 ${p.name} 約 1 小時交接會議，逐項確認 7 大項${p.stuck.items.length?`（尚未確認：${p.stuck.items.map(il).join('、')}）`:'（已全部確認）'}`);
 if(p.stuck.sig.length)L.push(`□ 補齊簽名：${p.stuck.sig.join('、')}`);
 L.push('','▍第 1 週：接手專案（依截止日排序）');
 const pj=[...p.proj].sort((a,b)=>(dayTo(a.d)??999)-(dayTo(b.d)??999));
 if(pj.length)pj.forEach(x=>L.push(`□ ${x.n}｜客戶 ${x.c||'—'}｜進度 ${Math.min(100,+x.p||0)}%｜截止 ${x.d||'—'}｜下一步：${x.nx||'—'}${clr(x.r)?'':'｜注意：'+x.r}`));else L.push('□ （未填專案，請向移交人確認有無進行中案件）');
 L.push('','▍第 2 週：認識客戶窗口');
 if(p.cust.length)p.cust.forEach(x=>L.push(`□ ${x.n}｜${x.c||'—'}｜${x.t||'—'}${p.spof.cust.some(s=>s.startsWith(x.n))?'　★僅此人掌握，請優先介紹':''}`));else L.push('□ （未填窗口）');
 L.push('','▍持續追蹤：未結事項');
 if(p.risk.length)[...p.risk].sort((a,b)=>(/高/.test(b.l||'')?1:0)-(/高/.test(a.l||'')?1:0)).forEach(x=>L.push(`□ ${/高/.test(x.l||'')?'【高】':''}${x.n}｜負責 ${x.o||'待指定'}｜追蹤 ${x.d||'待訂'}`));else L.push('□ 目前無未結事項');
 L.push('','▍最後：交接完成後');L.push('□ 在 CRM 將上述客戶／商機的負責人改派為 '+(p.recv||'接交人'));L.push('□ 通知相關客戶窗口聯絡人已更換');return L.join('\n');}
const SPQ=list=>{const a=list.filter(p=>status(p)!=='已完成'&&(p.spof.cust.length||p.spof.proj.length)).sort((x,y)=>y.spof.idx-x.spof.idx);
 return a.length?'單點依賴（僅一位離職者記錄的窗口／客戶）：\n'+a.slice(0,8).map(p=>`• ${p.name}（接交人 ${p.recv}）：${[...p.spof.cust,...p.spof.proj].slice(0,5).join('、')}　依賴指數 ${p.spof.idx}%`).join('\n'):'目前沒有單點依賴。';};
function smartChat(q,list){
 const act=list.filter(p=>status(p)!=='已完成'),by=list.find(p=>q.includes(p.name)),rcv=!by&&list.filter(p=>p.recv&&q.includes(p.recv));
 const ps=by||(rcv&&rcv[0]);
 if(ps&&/交接|狀況|狀態|進度|資料|明細|完成度/.test(q))return {source:'BizForm 即時資料',text:handoverDetail(ps)};
 if(/新手|上路|接手|怎麼開始|從哪.*開始/.test(q)&&ps)return {source:'交接 AI 分析',text:onboardOf(ps)};
 if(/摘要|總結|概述|重點|簡報/.test(q)&&ps)return {source:'交接 AI 分析',text:summaryOf(ps)};
 if(/只有|唯一|單點|獨家|沒人知道|獨自|掌握/.test(q)){if(by)return {source:'交接 AI 分析',text:`${by.name} 獨自掌握：`+([...by.spof.cust,...by.spof.proj].join('、')||'無')+`（依賴指數 ${by.spof.idx}%）`};return {source:'交接 AI 分析',text:SPQ(list)};}
 if(/卡|瓶頸|還差|缺|哪一項|哪項/.test(q)){if(ps)return {source:'交接 AI 分析',text:`${ps.name}：${ps.stuck.text}。`};return {source:'交接 AI 分析',text:'目前卡關位置：\n'+(act.map(p=>`• ${p.name}：${p.stuck.text}`).join('\n')||'無')};}
 if(/風險|危險|最高|燈號|分數|優先/.test(q)){if(ps)return {source:'交接 AI 分析',text:`${ps.name} 風險 ${ps.rs.score} 分（${ps.rs.lv}）：\n`+ps.rs.parts.map(x=>`• ${x.k} ${x.pts}/${x.max}：${x.txt}`).join('\n')};return {source:'交接 AI 分析',text:'風險最高的交接（分數越高越需優先處理）：\n'+([...act].sort((a,b)=>RSK(b)-RSK(a)).slice(0,6).map(p=>`• ${p.rs.lv==='高'?'🔴':p.rs.lv==='中'?'🟡':'🟢'} ${p.name} ${p.rs.score} 分｜${p.stuck.text}`).join('\n')||'無')};}
 if(/超載|負擔|太多|誰.*接/.test(q)){const a=anaOf(list).recv.slice(0,5);return {source:'交接 AI 分析',text:'接交人負荷：\n'+a.map(x=>`• ${x.name}：承接 ${x.n} 人、${x.pj} 案`).join('\n')};}
 return null;}
let LLMLAST={};
async function llm(q,list){if(!E.ANTHROPIC_API_KEY){LLMLAST={ok:false,err:'未設定 ANTHROPIC_API_KEY'};return null}
 const ctx=list.slice(0,40).map(p=>({姓名:p.name,部門:p.dept,接交人:p.recv,最後工作日:p.last,狀態:status(p),風險:p.rs.score,卡關:p.stuck.text,專案:p.proj.map(x=>x.n+'/'+x.c+'/'+x.p+'%'),窗口:p.cust.map(x=>x.n),僅此人掌握:[...p.spof.cust,...p.spof.proj],未結:p.risk.map(x=>x.n+'/'+x.l)}));
 try{const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:AbortSignal.timeout(25000),headers:{'content-type':'application/json','x-api-key':E.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:E.LLM_MODEL||'claude-sonnet-4-5',max_tokens:900,system:'你是「交接不斷線」的離職交接分析助理。只能根據提供的 JSON 資料用繁體中文簡潔回答；資料中沒有的就說沒有，不要編造。',messages:[{role:'user',content:'資料：'+JSON.stringify(ctx)+'\n\n問題：'+q}]})});
  if(!r.ok){LLMLAST={ok:false,status:r.status,err:(await r.text()).slice(0,300),t:Date.now()};return null}const j=await r.json();LLMLAST={ok:true,t:Date.now()};const t=(j.content||[]).map(c=>c.text||'').join('').trim();return t?{source:'AI（LLM）',text:t}:null;}catch(e){LLMLAST={ok:false,err:String(e.message),t:Date.now()};return null}}
const GENERAL_SESSIONS=new Map();
const handoverQuestion=(q,list)=>list.some(p=>q.includes(p.name)||(p.recv&&q.includes(p.recv)))||/交接|離職|接交|移交|監交|逾期|到期|卡關|風險|專案|案件|客戶|窗口|簽名|完成度|部門/.test(q);
async function webSearch(q){
 const key=E.TAVILY_API_KEY||E.SEARCH_API_KEY||'';if(!key)return [];
 try{const r=await fetch('https://api.tavily.com/search',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({query:q,search_depth:'basic',max_results:5,include_answer:true})});if(!r.ok)return [];const j=await r.json();return (j.results||[]).slice(0,5).map(x=>({title:String(x.title||''),url:String(x.url||''),content:String(x.content||'').slice(0,900)}));}catch(e){return []}
}
async function generalAnswer(q,sid){
 const sources=await webSearch(q),sourceText=sources.length?sources.map((x,i)=>`[${i+1}] ${x.title}\n${x.content}\n網址：${x.url}`).join('\n\n'):'';
 if(!E.ANTHROPIC_API_KEY){if(!sources.length)return null;return {source:'網路搜尋',text:`### 搜尋結果\n\n${sources.map((x,i)=>`- **[${i+1}] ${x.title}**\n  ${x.content}\n  ${x.url}`).join('\n')} `};}
 const key=String(sid||'web').slice(0,80),history=GENERAL_SESSIONS.get(key)||[],prompt=sources.length?`${q}\n\n以下是即時網路搜尋結果，請只依據這些來源回答需要即時資訊的部分；資料不足時說明不足，並在最後列出使用的 [編號]。\n\n${sourceText}`:q;
 try{const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',signal:AbortSignal.timeout(25000),headers:{'content-type':'application/json','x-api-key':E.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:E.LLM_MODEL||'claude-sonnet-4-5',max_tokens:900,system:'你是「交接不斷線」網站的自然對話助理。使用繁體中文，先回答重點，內容短而清楚；適度用短標題與條列。你不持有 BizForm 或公司內部資料，不能編造任何員工、客戶、案件或規定。若問題涉及交接資料，請使用者改問具體姓名與交接項目。',messages:[...history.slice(-6),{role:'user',content:prompt}]})});if(!r.ok)return null;const j=await r.json(),text=(j.content||[]).map(x=>x.text||'').join('').trim();if(!text)return null;GENERAL_SESSIONS.set(key,[...history.slice(-4),{role:'user',content:q},{role:'assistant',content:text}]);return {source:sources.length?'AI＋網路搜尋':'AI',text};}catch(e){return null}
}
// ---- 通知：Webhook（Teams／Slack／Discord）＋ Email（SMTP 或 Resend）----
const NF={hook:E.NOTIFY_WEBHOOK_URL||'',to:E.NOTIFY_EMAIL_TO||'',host:E.SMTP_HOST||'',port:+(E.SMTP_PORT||465),secure:E.SMTP_SECURE!=='0',user:E.SMTP_USER||'',pass:E.SMTP_PASS||'',from:E.NOTIFY_FROM||E.SMTP_USER||'',resend:E.RESEND_API_KEY||'',auto:E.AUTO_NOTIFY!=='0'};
const LINE_PUSH_TARGETS=String(E.LINE_PUSH_TO||'').split(/[;,\s]+/).filter(Boolean);
const mailOn=()=>!!(NF.to&&(NF.resend||NF.host));
const mailOf=p=>{const m=String(E.RECV_EMAILS||'').split(/[;,\n]+/).map(x=>x.split('=')).find(x=>x[0].trim()===p.recv);return String(p.recvMail||(m&&m[1])||'').trim()};
const notifyInfo=()=>({webhook:!!NF.hook,email:!!(NF.resend||NF.host),line:linePushOn(),auto:NF.auto&&(!!NF.hook||mailOn()||linePushOn())});
const nlog=[];let sent={};const SENT=path.join(require('os').tmpdir(),'ho_sent.json');try{sent=JSON.parse(fs.readFileSync(SENT,'utf8'))}catch(e){}
const b64=s=>Buffer.from(s).toString('base64');
function smtpSend(subject,text,TO){return new Promise((res,rej)=>{const to=(TO||NF.to).split(/[,;\s]+/).filter(Boolean),ad=s=>(String(s).match(/<([^>]+)>/)||[0,s])[1];
 const msg=['From: '+NF.from,'To: '+to.join(', '),'Subject: =?UTF-8?B?'+b64(subject)+'?=','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',(b64(text).match(/.{1,76}/g)||[]).join('\r\n')].join('\r\n');
 const steps=[[null,'220'],['EHLO handover','250']];if(NF.user)steps.push(['AUTH LOGIN','334'],[b64(NF.user),'334'],[b64(NF.pass),'235']);
 steps.push(['MAIL FROM:<'+ad(NF.from)+'>','250']);to.forEach(a=>steps.push(['RCPT TO:<'+ad(a)+'>','25']));steps.push(['DATA','354'],[msg+'\r\n.','250'],['QUIT','221']);
 const s=(NF.secure?require('tls'):require('net')).connect({host:NF.host,port:NF.port,servername:NF.host});let buf='',i=0,fin=false;
 s.setTimeout(20000,()=>{s.destroy();rej(new Error('SMTP 逾時'))});s.on('error',rej);
 s.on('data',d=>{buf+=d;let m;while((m=buf.match(/^(\d{3})([ -])[^\n]*\n/))){buf=buf.slice(m[0].length);if(m[2]==='-')continue;if(!m[1].startsWith(steps[i][1])){fin=true;s.destroy();return rej(new Error('SMTP '+m[0].trim()))}i++;if(i>=steps.length){fin=true;s.end();return res(true)}s.write(steps[i][0]+'\r\n')}});
 s.on('close',()=>{if(!fin)rej(new Error('SMTP 連線中斷'))});});}
async function notify(subject,text,meta,opt){opt=opt||{};const MT=opt.to||NF.to,via=[],err=[];
 if(NF.hook&&opt.hook!==false){try{const r=await fetch(NF.hook,{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},body:JSON.stringify({'@type':'MessageCard','@context':'http://schema.org/extensions',summary:subject,title:subject,text:text.replace(/\n/g,'<br>'),content:subject+'\n'+text})});if(!r.ok)throw new Error('HTTP '+r.status);via.push('Webhook')}catch(e){err.push('Webhook：'+e.message)}}
 if(linePushOn()&&opt.line!==false){try{await linePush(subject,text);via.push('LINE')}catch(e){err.push('LINE：'+e.message)}}
 if(MT&&(NF.resend||NF.host)){try{if(NF.resend){const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+NF.resend},body:JSON.stringify({from:NF.from||'onboarding@resend.dev',to:MT.split(/[,;\s]+/).filter(Boolean),subject,text})});if(!r.ok)throw new Error('HTTP '+r.status);}else await smtpSend(subject,text,MT);via.push('Email')}catch(e){err.push('Email：'+e.message)}}
 if(!via.length&&!err.length)err.push('尚未設定通知管道（LINE_PUSH_TO、NOTIFY_WEBHOOK_URL 或 Email）');
 const rec={t:new Date().toISOString(),subject,who:meta&&meta.who||'',pid:meta&&meta.pid||0,auto:!!(meta&&meta.auto),to:opt.hook===false?MT:'',ok:!!via.length,via,err};nlog.unshift(rec);nlog.length=Math.min(nlog.length,50);return rec;}
const mailText=p=>`${p.recv||'您好'} 您好，\n\n您接手的離職交接尚未完成，提醒如下：\n\n`+remindText(p)+`\n\n待移轉專案：`+(p.proj.map(x=>`${x.n}（${Math.min(100,+x.p||0)}%${x.d?'，截止 '+x.d:''}）`).join('、')||'無')+`\n\n—— 交接不斷線`;
const remindText=p=>`${p.name} 的離職交接${dleft(p)<0?'已逾期 '+(-dleft(p))+' 天':'剩 '+dleft(p)+' 天'}（最後工作日 ${p.last}）。\n接交人：${p.recv||'未填'}　完成度 ${Math.round(p.ck/7*100)}%　風險 ${p.rs.lv}（${p.rs.score} 分）\n卡關：${p.stuck.text}\n請儘速完成交接。`;
async function autoTick(){try{if(!notifyInfo().auto)return;const hr=+new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',hour:'2-digit',hour12:false}).format(new Date());if(hr<9||hr>=18)return;
 const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date()),d=await load(false);
 const hit=d.people.filter(p=>status(p)!=='已完成'&&p.rs.lv==='高'&&dleft(p)<=7&&sent[p.id]!==day);if(!hit.length)return;
 const r=await notify(`【交接不斷線】${hit.length} 位離職交接需要關注`,hit.map(p=>'• '+remindText(p).split('\n').join('\n  ')).join('\n\n'),{who:hit.map(p=>p.name).join('、'),auto:true});
 if(r.ok){hit.forEach(p=>sent[p.id]=day);try{fs.writeFileSync(SENT,JSON.stringify(sent))}catch(e){}}}catch(e){}}
setInterval(autoTick,600000).unref();setTimeout(autoTick,25000).unref();
// ---- 閉環狀態 ----
function loopOf(p){const cr=ccache.data,names=cr?new Set([...(cr.customers||[]),...(cr.companies||[])].map(x=>String(x.name||'').trim()).filter(Boolean)):null;
 const mt=names?p.cust.filter(c=>names.has((c.n||'').trim())).length:0,nt=nlog.some(n=>n.ok&&n.pid===p.id);
 return [{n:'BizForm 填單',s:'ok',t:'已送出'},{n:'三方簽核',s:p.sg===3?'ok':'wait',t:p.sg+'/3'},{n:'C.ai 通知',s:nt?'ok':'wait',t:nt?'已通知':'尚未通知'},{n:'儀表板結案',s:status(p)==='已完成'?'ok':'wait',t:status(p)}];}
const withLoop=d=>({...d,people:d.people.map(p=>({...p,loop:loopOf(p)})),ana:anaOf(d.people)});
// ---- PDF 交接報告（瀏覽器列印／另存 PDF）----
function reportHtml(p){const X=xe,d=dleft(p),ck=p.ckl.map((t,i)=>`<tr><td>${i+1}</td><td>${X(t||'（第 '+(i+1)+' 項）')}</td><td class="${p.cki.includes(i)?'ok':'no'}">${p.cki.includes(i)?'✔ 已確認':'✘ 未確認'}</td></tr>`).join('');
 const sg=SGN.map(([k,n],i)=>`<tr><td>${n}</td><td>${X([p.name,p.recv,p.boss][i]||'未填')}</td><td class="${p.sgi[k]?'ok':'no'}">${p.sgi[k]?'✔ 已簽名':'✘ 未簽名'}</td></tr>`).join('');
 const tb=(h,r,e)=>r.length?`<table><tr>${h.map(x=>'<th>'+x+'</th>').join('')}</tr>${r.join('')}</table>`:`<p class="mu">${e}</p>`;
 const tl=[['交接起始日',p.start],['最後工作日',p.last],['交接完成日（預計）',p.end],['今日',new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date()).replace(/-/g,'/')]].filter(x=>x[1]).sort((a,b)=>a[1]<b[1]?-1:1);
 return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>交接報告－${X(p.name)}</title><style>
body{font-family:"Microsoft JhengHei","PingFang TC",sans-serif;color:#111;margin:0;padding:28px 36px;font-size:13px;line-height:1.6}h1{font-size:22px;margin:0}h2{font-size:15px;border-left:4px solid #f97316;padding-left:8px;margin:22px 0 8px}.mu{color:#666}
table{border-collapse:collapse;width:100%;margin-bottom:4px}th,td{border:1px solid #ccc;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f1f3f6}.ok{color:#15803d;font-weight:700}.no{color:#b91c1c;font-weight:700}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1f2a3c;padding-bottom:10px}.badge{display:inline-block;padding:2px 12px;border-radius:99px;color:#fff;font-weight:700;background:${p.rs.lv==='高'?'#dc2626':p.rs.lv==='中'?'#d97706':'#16a34a'}}
.tl{display:flex;gap:0;margin:8px 0}.tl div{flex:1;border-top:3px solid #f97316;padding-top:6px;font-size:12px}.tl b{display:block}.pb{margin:14px 0;text-align:right}button{padding:8px 18px;background:#f97316;color:#fff;border:0;border-radius:6px;font-size:14px;cursor:pointer}
.sig{display:flex;gap:24px;margin-top:30px}.sig div{flex:1;border-top:1px solid #111;padding-top:4px;text-align:center}@media print{.pb{display:none}body{padding:0}h2{break-after:avoid}table{break-inside:avoid}}</style></head><body>
<div class="pb"><button onclick="print()">列印／另存為 PDF</button></div>
<div class="top"><div><h1>離職人員工作交接報告</h1><div class="mu">${X(p.name)}（${X(p.emp)}）・${X(p.dept)}／${X(p.title)}</div></div><div style="text-align:right">狀態：<b>${status(p)}</b>　風險：<span class="badge">${p.rs.lv} ${p.rs.score} 分</span><div class="mu">產出時間 ${new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}</div></div></div>
<h2>一、基本資訊</h2>${tb(['移交人','接交人','監交人','離職原因','最後工作日','剩餘天數'],[`<tr><td>${X(p.name)}</td><td>${X(p.recv)}</td><td>${X(p.boss)}</td><td>${X(p.reason)}</td><td>${X(p.last)}</td><td>${d<0?'已逾期 '+(-d)+' 天':d+' 天'}</td></tr>`])}
<h2>二、交接時間軸</h2><div class="tl">${tl.map(x=>`<div><b>${X(x[0])}</b>${X(x[1])}</div>`).join('')}</div>
<h2>三、七大項交接確認（${p.ck}/7）</h2>${tb(['#','項目','結果'],[ck])}
<h2>四、簽核記錄（${p.sg}/3）</h2>${tb(['角色','姓名','結果'],[sg])}
<h2>五、風險評估：${p.rs.lv}（${p.rs.score}/100）</h2>${tb(['構面','得分','說明'],p.rs.parts.map(x=>`<tr><td>${X(x.k)}</td><td>${x.pts}/${x.max}</td><td>${X(x.txt)}</td></tr>`))}<p>卡關位置：<b>${X(p.stuck.text)}</b></p>
<h2>六、待移轉專案（${p.proj.length}）</h2>${tb(['專案','客戶','進度','截止日','下一里程碑','已知風險'],p.proj.map(x=>`<tr><td>${X(x.n)}</td><td>${X(x.c)}</td><td>${Math.min(100,+x.p||0)}%</td><td>${X(x.d)}</td><td>${X(x.nx)}</td><td>${X(clr(x.r)?'—':x.r)}</td></tr>`),'未填寫專案')}
<h2>七、客戶窗口（${p.cust.length}）</h2>${tb(['單位','聯絡人／職稱','類別','單點依賴'],p.cust.map(x=>`<tr><td>${X(x.n)}</td><td>${X(x.c)}</td><td>${X(x.t)}</td><td>${p.spof.cust.some(s=>s.startsWith(x.n))?'僅此人記錄':'—'}</td></tr>`),'未填寫客戶窗口')}
<h2>八、未結事項（${p.risk.length}）</h2>${tb(['事項','風險等級','負責人','追蹤日'],p.risk.map(x=>`<tr><td>${X(x.n)}</td><td>${X(x.l)}</td><td>${X(x.o)}</td><td>${X(x.d)}</td></tr>`),'無未結事項')}
<div class="sig"><div>移交人簽名</div><div>接交人簽名</div><div>監交人簽名</div></div>
<script>if(location.search.includes('print=1'))setTimeout(()=>print(),400)</script></body></html>`;}
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};

// ---- LINE Messaging API Webhook ----
const LINE_SECRET=E.LINE_CHANNEL_SECRET||'';
const LINE_TOKEN=E.LINE_CHANNEL_ACCESS_TOKEN||'';
const LINE_ALLOW=new Set(String(E.LINE_ALLOWED_USER_IDS||'').split(/[;,\\s]+/).filter(Boolean));
const LINE_ALLOW_ALL=String(E.LINE_ALLOWED_USER_IDS||'').trim()==='*';
const lineSeen=new Map();
const linePushOn=()=>!!(LINE_TOKEN&&LINE_PUSH_TARGETS.length>0);
async function linePush(subject,text){
 const message=(subject?String(subject)+'\n':'')+String(text||'');
 for(const to of LINE_PUSH_TARGETS){
  const r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+LINE_TOKEN},body:JSON.stringify({to,messages:[{type:'text',text:message.slice(0,4900)}]})});
  if(!r.ok)throw new Error('LINE push '+r.status+' '+(await r.text()).slice(0,200));
 }
 return true;
}
function lineVerify(raw,signature){
 if(!LINE_SECRET||!signature)return false;
 const digest=crypto.createHmac('sha256',LINE_SECRET).update(raw).digest('base64');
 const a=Buffer.from(digest),b=Buffer.from(String(signature));
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
async function lineReply(replyToken,text){
 if(!LINE_TOKEN||!replyToken)return false;
 const r=await fetch('https://api.line.me/v2/bot/message/reply',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+LINE_TOKEN},body:JSON.stringify({replyToken,messages:[{type:'text',text:String(text||'').slice(0,4900)}]})});
 if(!r.ok)throw new Error('LINE reply '+r.status+' '+(await r.text()).slice(0,200));
 return true;
}
async function lineHandleEvent(ev){
 if(!ev||ev.type!=='message'||!ev.replyToken||!ev.message||ev.message.type!=='text')return;
 const uid=ev.source&&ev.source.userId||'';
 if(!uid||(!LINE_ALLOW_ALL&&!LINE_ALLOW.has(uid))){
  await lineReply(ev.replyToken,'此 LINE 帳號尚未授權使用「交接不斷線」。請聯絡專題管理員加入使用權限。');
  return;
 }
 const q=String(ev.message.text||'').trim().slice(0,500);
 if(!q){await lineReply(ev.replyToken,'請輸入想查詢的交接問題。');return;}
 try{
  const ans=await chat(q,'line:'+uid);
  await lineReply(ev.replyToken,ans&&ans.text||'目前無法取得回答，請稍後再試。');
 }catch(err){
  console.error('LINE chat failed:',err&&err.message||err);
  await lineReply(ev.replyToken,'目前查詢服務暫時無法使用，請稍後再試。');
 }
}
async function lineWebhook(req,res){
 let raw='';
 req.on('data',c=>{raw+=c;if(raw.length>1024*1024)req.destroy();});
 req.on('end',async()=>{
  try{
   if(!lineVerify(raw,req.headers['x-line-signature'])){res.writeHead(401);return res.end('Invalid signature');}
   const payload=JSON.parse(raw||'{}');
   res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'});res.end('OK');
   for(const ev of payload.events||[]){
    const key=ev.webhookEventId||ev.replyToken;
    if(key&&lineSeen.has(key))continue;
    if(key){lineSeen.set(key,Date.now());if(lineSeen.size>1000){const cutoff=Date.now()-86400000;for(const [k,t] of lineSeen)if(t<cutoff)lineSeen.delete(k);}}
    lineHandleEvent(ev).catch(err=>console.error('LINE webhook event failed:',err&&err.message||err));
   }
  }catch(err){console.error('LINE webhook error:',err&&err.message||err);if(!res.headersSent){res.writeHead(400);res.end('Bad request');}}
 });
}

const body=req=>new Promise(r=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch(e){r({})}})});
const authed=req=>!PASS||(req.headers.cookie||'').includes('hs='+tok());
const send=(res,c,o)=>{res.writeHead(c,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(o));};
http.createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://x');
  if(u.pathname==='/webhook/line'&&req.method==='POST')return lineWebhook(req,res);
  if(u.pathname==='/api/login'&&req.method==='POST'){const b=await body(req);if(!PASS||b.code===PASS){res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'hs='+tok()+'; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400'});return res.end('{"ok":true}');}return send(res,401,{error:'存取碼錯誤'});}
  if(u.pathname==='/api/config')return send(res,200,{needLogin:!!PASS&&!authed(req),formUrl:CFG.formUrl,powerbi:CFG.powerbi,caiEmbed:CFG.caiEmbed,caiHost:CFG.caiHost,caiBot:CFG.caiBot,caiHome:CFG.caiHome,mock:MOCK,notify:notifyInfo()});
  if(u.pathname==='/api/assistant/status')return send(res,200,{generalAI:!!E.ANTHROPIC_API_KEY,webSearch:!!(E.TAVILY_API_KEY||E.SEARCH_API_KEY)});
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
  if(u.pathname==='/api/handovers'){try{return send(res,200,withLoop(await load(u.searchParams.get('refresh')==='1')));}catch(e){return send(res,502,{error:e.message});}}
  if(u.pathname==='/api/crm'){try{const d=await loadCrm(u.searchParams.get('refresh')==='1');return send(res,200,{syncedAt:new Date().toISOString(),...d,sample:u.searchParams.get('debug')==='1'?d.sample:undefined});}catch(e){return send(res,502,{error:e.message});}}
  if(u.pathname==='/api/llm'){const d=await load(false),r=await llm('請只回覆「OK」兩個字',d.people.slice(0,1));return send(res,200,{configured:!!E.ANTHROPIC_API_KEY,model:E.LLM_MODEL||'claude-sonnet-4-5',reply:r&&r.text,last:LLMLAST});}
  if(u.pathname==='/api/notify/log')return send(res,200,{info:notifyInfo(),log:nlog});
  if(u.pathname==='/api/notify'&&req.method==='POST'){const b=await body(req),d=await load(false),p=d.people.find(x=>x.id==b.id);if(!p)return send(res,404,{error:'找不到交接單'});const hasMail=!!(NF.resend||NF.host),hasLine=linePushOn();if(!hasMail&&!hasLine)return send(res,503,{error:'尚未設定通知服務（LINE_PUSH_TO 或 Email）'});const to=hasMail?(mailOf(p)||(/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(b.to||'').trim())?String(b.to).trim():'')):'';if(hasMail&&!to&&!NF.to&&!hasLine)return send(res,409,{error:'找不到接交人 Email',need:'mail'});const r=await notify('【交接提醒】'+p.name+' 的離職交接',mailText(p),{who:(p.recv||'')+'（接手 '+p.name+'）',pid:p.id},{to,hook:false});return send(res,r.ok?200:502,r);}
  if(u.pathname==='/api/ai'){const d=await load(false),p=d.people.find(x=>x.id==u.searchParams.get('id'));if(!p)return send(res,404,{error:'找不到交接單'});return send(res,200,{text:u.searchParams.get('kind')==='onboard'?onboardOf(p):summaryOf(p)});}
  if(u.pathname.startsWith('/report/')){if(!authed(req)){res.writeHead(401,{'Content-Type':'text/plain; charset=utf-8'});return res.end('請先登入');}const d=await load(false),p=d.people.find(x=>String(x.id)===u.pathname.slice(8));if(!p){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('找不到交接單');}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(reportHtml(p));}
  if(u.pathname==='/api/chat'&&req.method==='POST'){const b=await body(req),answer=await chat(String(b.q||'').slice(0,500),String(b.sid||'web'));answer.text=traditional(answer.text);answer.source=traditional(answer.source);return send(res,200,answer);}
  let f=path.join(__dirname,'public',u.pathname==='/'?'index.html':u.pathname);
  if(!f.startsWith(path.join(__dirname,'public'))||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);
 }catch(e){send(res,500,{error:e.message});}
}).listen(+(E.PORT||3000),()=>console.log('交接不斷線 running on :'+(E.PORT||3000)+(MOCK?' (MOCK)':'')));
