// Data layer (localStorage) + built-in templates + agent simulator
const DB={get:(k,d)=>{try{return JSON.parse(localStorage.getItem('aic_'+k))??d}catch{return d}},set:(k,v)=>localStorage.setItem('aic_'+k,JSON.stringify(v))};
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,9);
function toast(m){let t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';document.body.append(t)}t.textContent=m;t.className='show';clearTimeout(t._t);t._t=setTimeout(()=>t.className='',2200)}
const mm=s=>String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
const ago=t=>{const m=Math.round((Date.now()-t)/60000);return m<1?'just now':m<60?m+' min ago':m<1440?Math.round(m/60)+' h ago':Math.round(m/1440)+' d ago'};
const A=(id,role,desc,next,prompt)=>({id,role,desc,next,prompt});
const BUILTIN=[
{id:'coding',name:'Coding Team',cat:'Coding',desc:'Manager plans, Researcher gathers docs, Frontend and Backend build, Tester critiques.',max:3,agents:[A('manager','Manager','Plans and assigns work','researcher','Split the goal into tasks.'),A('researcher','Researcher','Finds patterns and docs','frontend','Gather relevant docs.'),A('frontend','Frontend Dev','Builds the UI','backend','Build the UI.'),A('backend','Backend Dev','Builds the API','tester','Build the API.'),A('tester','Tester (Critic)','Reviews and sends work back',null,'Review; reply APPROVED if fine.')]},
{id:'research',name:'Research Team',cat:'Research',desc:'Planner scopes the question, Researcher summarises sources, Critic checks claims.',max:3,agents:[A('planner','Planner','Scopes the question','researcher','Scope it.'),A('researcher','Researcher','Collects and summarises','critic','Summarise sources.'),A('critic','Critic','Checks the claims',null,'Verify claims.')]},
{id:'business',name:'Business Plan Team',cat:'Business',desc:'Planner, Market Researcher and Finance Analyst draft a plan; Critic hunts for gaps.',max:3,agents:[A('planner','Planner','Frames the plan','market','Frame it.'),A('market','Market Researcher','Sizes the market','finance','Research market.'),A('finance','Finance Analyst','Builds the numbers','critic','Model costs.'),A('critic','Critic','Finds gaps',null,'Find gaps.')]},
{id:'content',name:'Content and Marketing',cat:'Content',desc:'Strategist sets the angle, Writer drafts copy, Editor tightens tone and facts.',max:3,agents:[A('strategist','Strategist','Sets the angle','writer','Set angle.'),A('writer','Writer','Drafts the copy','editor','Write copy.'),A('editor','Editor (Critic)','Tightens tone and facts',null,'Edit.')]},
{id:'data',name:'Data Analysis Team',cat:'Research',desc:'Planner frames questions, Analyst runs numbers, Visualiser builds charts, Critic validates.',max:3,agents:[A('planner','Planner','Frames questions','analyst','Frame.'),A('analyst','Analyst','Runs the numbers','visualiser','Analyse.'),A('visualiser','Visualiser','Builds charts','critic','Chart.'),A('critic','Critic','Validates',null,'Validate.')]}];
const allTemplates=()=>[...BUILTIN,...DB.get('templates',[])];
const getTpl=id=>allTemplates().find(t=>t.id===id);
const DEF={providers:{groq:{key:'',model:'Llama 3.3 70B'},gemini:{key:'',model:'Gemini 2.0 Flash'},local:{key:'http://localhost:11434',model:'Qwen 2.5 3B'}},toGemini:true,toLocal:true,ask:false,team:'auto',rounds:3,page:'A4',stamps:true};
const settings=()=>({...DEF,...DB.get('settings',{})});
const colorOf=i=>'c'+(i%7);
// router agent for "Auto-select"
function route(goal){const g=goal.toLowerCase();const k=[['coding',/app|code|api|game|website|bug|script|build|software|login/],['data',/csv|data|chart|analy[sz]e|statistic/],['business',/business|startup|marketing plan|market|revenue|pitch/],['content',/blog|copy|post|caption|landing|article|newsletter/],['research',/research|summari[sz]e|paper|compare|study|explain/]];for(const[i,r]of k)if(r.test(g))return i;return 'research'}
// build a deterministic script of steps from template + goal
function makeScript(tpl,goal){const s=[],ag=tpl.agents,max=Math.max(1,+tpl.max||1);let i=0,round=0,guard=0;const g=goal.length>60?goal.slice(0,57)+'...':goal;
while(i>=0&&i<ag.length&&guard++<40){const a=ag[i],crit=/critic|tester|editor|review/i.test(a.role+a.id)||!a.next;const prev=Math.max(0,ag.findIndex(x=>x.next===a.id));
if(crit){if(round<max&&round<1&&ag.length>1){s.push({a:a.id,t:`Review of "${g}": found 2 issues — missing input validation and an unclear edge case. Sending it back to ${ag[prev].role}.`,tag:'Revision requested: '+ag[prev].role,k:'bad'});round++;i=prev;continue}
s.push({a:a.id,t:`All requirements for "${g}" are met. APPROVED.`,tag:'Approved',k:'ok'});break}
const rev=s.some(x=>x.a===a.id);s.push({a:a.id,t:rev?`Fixed the reported issues: added validation and handled the edge case.`:`${a.desc}. Working on "${g}": ${a.prompt}`,tag:i===0?'Plan':rev?'Fixed':'',k:rev?'ok':''});i=a.next?ag.findIndex(x=>x.id===a.next):-1}
return s}
const sessions=()=>DB.get('sessions',[]);
const saveSessions=s=>DB.set('sessions',s);
function createSession(goal,tplId,docs=[]){const set=settings();if(tplId==='auto')tplId=route(goal);const tpl=getTpl(tplId)||BUILTIN[0];
const s={id:uid(),goal,tpl:tpl.id,tplName:tpl.name,agents:tpl.agents,model:'Groq',created:Date.now(),status:'running',cursor:0,elapsed:0,paused:false,docs,script:makeScript(tpl,goal),msgs:[{me:1,t:goal}]};
const all=sessions();all.unshift(s);saveSessions(all);return s}
const getSession=id=>sessions().find(s=>s.id===id);
function patchSession(id,fn){const all=sessions(),s=all.find(x=>x.id===id);if(s){fn(s);saveSessions(all)}return s}
// simulator: one step per tick
let simTimer=null;
function runSim(id,onTick){stopSim();simTimer=setInterval(()=>{const s=patchSession(id,s=>{if(s.paused||s.status!=='running')return;s.elapsed+=2;if(s.cursor<s.script.length){const st=s.script[s.cursor++];s.msgs.push({a:st.a,t:st.t,tag:st.tag,k:st.k,time:s.elapsed});if(s.cursor>=s.script.length)s.status='done'}});if(s)onTick(s);if(!s||s.status!=='running')stopSim()},2000)}
const stopSim=()=>{clearInterval(simTimer);simTimer=null};
function pdfExport(s){const w=window.open('','_blank');const st=settings();w.document.write(`<html><head><title>${esc(s.goal)}</title><style>@page{size:${st.page}}body{font:14px Inter,Arial,sans-serif;max-width:720px;margin:30px auto}h1{font-size:20px}p{margin:4px 0 14px}small{color:#666}</style></head><body><h1>${esc(s.goal)}</h1><small>${esc(s.tplName)} · ${esc(s.model)}</small><hr>`+s.msgs.map(m=>m.me?`<p><b>You:</b> ${esc(m.t)}</p>`:`<p><b>${esc(s.agents.find(a=>a.id===m.a)?.role||m.a)}</b>${st.stamps?` <small>${mm(m.time||0)}</small>`:''}<br>${esc(m.t)}</p>`).join('')+'</body></html>');w.document.close();w.focus();setTimeout(()=>w.print(),300)}
