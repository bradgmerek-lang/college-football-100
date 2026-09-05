const CFG = window.PICKEM_CONFIG || {};
const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('YOUR_') && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes('YOUR_');
const sb = configured ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const $ = id => document.getElementById(id);
const savedPage = (()=>{ try { return sessionStorage.getItem('cfb100CurrentPage') || 'home'; } catch(e) { return 'home'; } })();
const state = { user:null, profile:null, seasons:[], weeks:[], games:[], picks:[], entries:[], standings:[], activeEntry:null, currentSeason:null, currentWeek:null, rules:null, seasonSettings:null, entryGateMessage:'', demo:false, adminPlayers:[], adminSelectedPlayer:null, adminSelectedEntries:[], currentPage:savedPage };
const demoGames = [
  {id:'d1',week_id:'dw1',away_team:'Texas',home_team:'Ohio State',away_spread:2.5,home_spread:-2.5,kickoff:new Date(Date.now()+86400000).toISOString(),network:'ABC',status:'scheduled'},
  {id:'d2',week_id:'dw1',away_team:'Clemson',home_team:'LSU',away_spread:4.5,home_spread:-4.5,kickoff:new Date(Date.now()+90000000).toISOString(),network:'ESPN',status:'scheduled'},
  {id:'d3',week_id:'dw1',away_team:'Notre Dame',home_team:'Miami',away_spread:-3.5,home_spread:3.5,kickoff:new Date(Date.now()+95000000).toISOString(),network:'NBC',status:'scheduled'},
  {id:'d4',week_id:'dw1',away_team:'Alabama',home_team:'Florida State',away_spread:-12.5,home_spread:12.5,kickoff:new Date(Date.now()+100000000).toISOString(),network:'FOX',status:'scheduled'}
];
function toast(msg){ const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(window._toast);window._toast=setTimeout(()=>t.hidden=true,3400); }
function fmtSpread(v){ if(v===null||v===undefined||v==='')return '—'; return Number(v)>0?`+${Number(v).toFixed(1)}`:Number(v).toFixed(1); }
function locked(g){ return g.status!=='scheduled' || Date.now()>=new Date(g.kickoff).getTime(); }
function showApp(){ $('authView').hidden=true;$('appView').hidden=false;$('userName').textContent=state.profile?.display_name||state.user?.email||'Player';$('commissionerNav').hidden=state.profile?.role!=='commissioner';switchPage(state.currentPage||'home'); }
function showAuth(){ $('authView').hidden=false;$('appView').hidden=true; }
function switchPage(name){ const target=$(`${name}Page`)?name:'home';state.currentPage=target;try{sessionStorage.setItem('cfb100CurrentPage',target);}catch(e){};document.querySelectorAll('.page').forEach(p=>p.hidden=true);$(`${target}Page`).hidden=false;document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===target));if(target==='home')renderHome();if(target==='standings')renderStandings();if(target==='history')renderHistory();if(target==='rules')renderRules();if(target==='commissioner')renderCommissioner(); }
function setAuthTab(tab){document.querySelectorAll('[data-auth-tab]').forEach(b=>b.classList.toggle('active',b.dataset.authTab===tab));$('signInForm').hidden=tab!=='signin';$('signUpForm').hidden=tab!=='signup';}
async function boot(){
  bindEvents();
  if(!configured) return showAuth();
  try {
    const {data:{session}, error} = await sb.auth.getSession();
    if(error) toast(error.message);
    if(session?.user){
      state.user=session.user;
      await loadApp();
    } else {
      showAuth();
    }
  } catch(err){
    console.error(err);
    showAuth();
    toast('Could not connect to the database.');
  }
  sb.auth.onAuthStateChange((_event,session)=>{
    // Defer database work until after Supabase finishes the auth callback.
    setTimeout(async()=>{
      try {
        if(session?.user){
          state.user=session.user;
          await loadApp();
        } else {
          state.user=null;
          state.profile=null;
          showAuth();
        }
      } catch(err){
        console.error(err);
        toast(err?.message || 'Authentication error.');
      }
    },0);
  });
}
async function loadApp(){ const {data:profile,error}=await sb.from('profiles').select('*').eq('id',state.user.id).single();if(error)return toast(error.message);if(profile?.disabled){await sb.auth.signOut();showAuth();return toast('This account is disabled. Contact the commissioner.');}state.profile=profile;showApp();await loadCore(); }
async function loadCore(){
  const [{data:seasons},{data:entries}] = await Promise.all([sb.from('seasons').select('*').order('year',{ascending:false}),sb.from('entries').select('*').eq('user_id',state.user.id).order('entry_number',{ascending:false})]);
  state.seasons=seasons||[];state.entries=entries||[];state.entryGateMessage='';state.currentSeason=state.seasons.find(s=>s.is_active)||state.seasons[0];state.activeEntry=state.entries.find(e=>e.season_id===state.currentSeason?.id&&e.status==='active');
  if(!state.activeEntry && state.currentSeason){
    const {data,error}=await sb.rpc('ensure_active_entry',{p_season_id:state.currentSeason.id});
    if(data){const r=await sb.from('entries').select('*').eq('id',data).single();state.activeEntry=r.data;state.entries.unshift(r.data);}
    else if(error){state.entryGateMessage=error.message||'';}
  }
  const {data:ss}=await sb.from('season_settings').select('*').eq('season_id',state.currentSeason?.id).maybeSingle();state.seasonSettings=ss||null;
  await loadWeeks();renderTop();renderHome();
}
async function loadWeeks(){ if(!state.currentSeason)return;const {data}=await sb.from('weeks').select('*').eq('season_id',state.currentSeason.id).order('week_number');state.weeks=data||[];state.currentWeek=state.weeks.find(w=>w.is_current)||state.weeks[0];fillSelectors();await loadWeek(); }
function fillSelectors(){ $('seasonSelect').innerHTML=state.seasons.map(s=>`<option value="${s.id}" ${s.id===state.currentSeason?.id?'selected':''}>${s.year}</option>`).join('');const opts=state.weeks.map(w=>`<option value="${w.id}" ${w.id===state.currentWeek?.id?'selected':''}>Week ${w.week_number}</option>`).join('');$('weekSelect').innerHTML=opts;$('commissionerWeekSelect').innerHTML=opts; }
async function loadWeek(){ if(!state.currentWeek)return; const [g,p,r]=await Promise.all([sb.from('games').select('*').eq('week_id',state.currentWeek.id).order('kickoff'),state.activeEntry?sb.from('picks').select('*').eq('entry_id',state.activeEntry.id):Promise.resolve({data:[]}),sb.rpc('get_week_rules',{p_week_id:state.currentWeek.id})]);state.games=g.data||[];const gameIds=new Set(state.games.map(x=>x.id));state.picks=(p.data||[]).filter(x=>gameIds.has(x.game_id));state.rules=(r.data&&r.data[0])||{min_picks:0,max_picks:0,spread_requirements:[]};renderTop();renderGames();renderRequirements();renderHome();if(state.profile?.role==='commissioner')renderAdminGames(); }
function latestSeasonEntry(){return state.entries.find(e=>e.season_id===state.currentSeason?.id)||null;}
function reentryWeek(){const e=latestSeasonEntry();return Number(e?.reentry_eligible_week_number||0)||null;}
function renderRules(){
  const box=$('rulesCurrentWeek');if(!box)return;
  const week=state.currentWeek?.week_number;
  const min=Number(state.rules?.min_picks||0),max=Number(state.rules?.max_picks||0);
  const spreadRules=Array.isArray(state.rules?.spread_requirements)?state.rules.spread_requirements:[];
  const reentry=state.seasonSettings?.reentry_policy||'unlimited';
  const reentryText=reentry==='disabled'?'No re-entry':reentry==='limited'?`Limited${state.seasonSettings?.max_entries?` · max ${state.seasonSettings.max_entries} entries`:''}`:'Unlimited re-entry';
  const spreadHtml=spreadRules.length?spreadRules.map(r=>{const count=Number(r.required_count||1);const raw=Number(r.max_spread);const fav=Math.abs(raw);return `<div class="rules-week-item"><span>Spread requirement</span><strong>${count} pick${count===1?'':'s'} at -${fav.toFixed(1)} or better</strong></div>`}).join(''):'<div class="rules-week-item"><span>Spread requirement</span><strong>None</strong></div>';
  box.innerHTML=`<div class="panel-kicker">CURRENT WEEK</div><div class="rules-current-head"><div><h3>${week!=null?`Week ${week}`:'Current week'} requirements</h3><p>These are the requirements currently being enforced by the site.</p></div><span class="rules-live-chip">LIVE SETTINGS</span></div><div class="rules-week-grid"><div class="rules-week-item"><span>Minimum picks</span><strong>${min}</strong></div><div class="rules-week-item"><span>Maximum picks</span><strong>${max>0?max:'Unlimited'}</strong></div><div class="rules-week-item"><span>Re-entry</span><strong>${reentryText}</strong></div>${spreadHtml}</div>`;
}
function renderTop(){ const e=state.activeEntry,latest=latestSeasonEntry();const wins=e?.current_wins||0;$('runWins').textContent=wins;$('runBar').style.width=`${Math.min(100,wins)}%`;if(e){$('runStatus').textContent='ACTIVE';$('welcomeTitle').textContent=`${state.profile?.display_name||'Player'} · Entry #${e.entry_number}`;}else if(latest?.status==='lost'){$('runStatus').textContent='RUN ENDED';$('welcomeTitle').textContent=`${state.profile?.display_name||'Player'} · Entry #${latest.entry_number} ended`;}else{$('runStatus').textContent='NO ACTIVE RUN';$('welcomeTitle').textContent=`${state.profile?.display_name||'Player'} · Road to 100`;}const rw=reentryWeek();$('weekSubtitle').textContent=rw&&!e?`Run ended · eligible to re-enter Week ${rw}`:(state.currentWeek?`Week ${state.currentWeek.week_number} · ${state.games.length} FBS games loaded`:'No active week'); }
async function renderHome(){if(!$('homePage'))return;const wins=state.activeEntry?.current_wins||0;const rw=reentryWeek();$('homeGreeting').textContent=`Welcome back, ${state.profile?.display_name||'Player'}`;$('homeWins').textContent=wins;$('homeRunBar').style.width=`${Math.min(100,wins)}%`;$('homeWeekTitle').textContent=state.currentWeek?`Week ${state.currentWeek.week_number}`:'Current week';const open=state.games.filter(g=>!locked(g)).length;const picked=state.picks.length;const min=Number(state.rules?.min_picks||0);$('homeWeekSummary').innerHTML=`<div><strong>${picked}</strong><span>picks made</span></div><div><strong>${min}</strong><span>minimum</span></div><div><strong>${open}</strong><span>games open</span></div>`;const upcoming=state.picks.map(p=>({p,g:state.games.find(g=>g.id===p.game_id)})).filter(x=>x.g&&!locked(x.g)).sort((a,b)=>new Date(a.g.kickoff)-new Date(b.g.kickoff)).slice(0,3);$('homeUpcoming').innerHTML=upcoming.length?upcoming.map(({p,g})=>`<div class="upcoming-row"><div><strong>${g[p.selected_side+'_team']}</strong><span>${g.away_team} @ ${g.home_team}</span></div><small>${new Date(g.kickoff).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'})}</small></div>`).join(''):(rw&&!state.activeEntry?`<div class="run-ended-note"><strong>Run ended</strong><span>You may start a new entry in Week ${rw}.</span></div>`:'<div class="home-empty">No upcoming selections yet.</div>');const msg=state.seasonSettings?.commissioner_message?.trim();$('homeMessage').hidden=!msg;$('homeMessage').innerHTML=msg?`<strong>Commissioner message</strong><span>${escapeHtml(msg)}</span>`:'';const cta=$('homeMakePicks');if(!state.activeEntry&&rw){cta.textContent=`Re-entry available Week ${rw}`;cta.disabled=true;}else{cta.textContent="Make This Week's Picks";cta.disabled=false;}await loadHomeLeaders();$('homeCommissionerPanel').hidden=state.profile?.role!=='commissioner';if(state.profile?.role==='commissioner'){$('homeCommissionerStats').innerHTML=`<div><strong>${state.games.length}</strong><span>games loaded</span></div><div><strong>${open}</strong><span>still open</span></div><div><strong>${state.standings.length}</strong><span>players</span></div>`;}}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
async function loadHomeLeaders(){if(state.demo){state.standings=[{user_id:'demo',display_name:'Brad',current_wins:12,best_wins:12,entry_count:1,status:'active'},{user_id:'d2',display_name:'Jordan',current_wins:9,best_wins:18,entry_count:2,status:'active'}];}else if(state.currentSeason){const {data}=await sb.rpc('get_standings',{p_season_id:state.currentSeason.id});state.standings=data||[];}$('homeLeaders').innerHTML=(state.standings||[]).slice(0,5).map((x,i)=>`<div class="leader-row"><span>${i+1}</span><strong>${escapeHtml(x.display_name)}</strong><b>${x.current_wins}</b></div>`).join('')||'<div class="home-empty">Standings will appear here.</div>';}
function pickedFor(gameId){return state.picks.find(p=>p.game_id===gameId);}
function renderGames(){ const filter=$('gameFilter').value;let arr=state.games;if(filter==='open')arr=arr.filter(g=>!locked(g));if(filter==='picked')arr=arr.filter(g=>pickedFor(g.id));$('emptyGames').hidden=arr.length>0;$('gamesGrid').innerHTML=arr.map(g=>{const p=pickedFor(g.id),isLocked=locked(g);return `<article class="game-card card"><div class="game-head"><span>${new Date(g.kickoff).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}${g.network?' · '+g.network:''}</span><span class="${isLocked?'locked':''}">${isLocked?'LOCKED':'OPEN'}</span></div><div class="matchup">${teamRow(g,'away',p,isLocked)}${teamRow(g,'home',p,isLocked)}</div><div class="game-foot"><span>Opening line</span><span class="${p?'saved':''}">${p?'✓ Pick saved':'No pick'}</span></div></article>`}).join(''); }
function teamRow(g,side,p,isLocked){const team=g[`${side}_team`],spread=g[`${side}_spread`],selected=p?.selected_side===side,disabled=isLocked||!state.activeEntry;return `<label class="team-option ${selected?'selected':''} ${disabled?'disabled':''}"><input type="radio" name="game_${g.id}" data-game="${g.id}" data-side="${side}" ${selected?'checked':''} ${disabled?'disabled':''}><span class="team-name">${team}</span><span class="spread">${fmtSpread(spread)}</span></label>`;}
async function savePick(gameId,side){
  const g=state.games.find(x=>x.id===gameId);
  if(!g||locked(g))return toast('That game is locked.');
  if(!state.activeEntry){const rw=reentryWeek();return toast(rw?`Your run ended. Re-entry begins Week ${rw}.`:'No active entry is available.');}
  const existing=pickedFor(gameId);

  // Clicking the team you already selected clears the pick while the game is still open.
  if(existing?.selected_side===side){
    if(state.demo){
      state.picks=state.picks.filter(p=>p.game_id!==gameId);
      renderGames();renderRequirements();
      return toast('Pick cleared (demo)');
    }
    const {error}=await sb.from('picks').delete().eq('id',existing.id);
    if(error){renderGames();return toast(error.message);}
    state.picks=state.picks.filter(p=>p.game_id!==gameId);
    renderGames();renderRequirements();
    return toast('Pick cleared.');
  }

  const max=Number(state.rules?.max_picks||0);
  if(!existing&&max>0&&state.picks.length>=max){
    renderGames();
    return toast(`Maximum of ${max} picks reached for this week.`);
  }
  if(state.demo){
    if(existing)existing.selected_side=side;
    else state.picks.push({id:crypto.randomUUID(),game_id:gameId,entry_id:'de1',selected_side:side,result:'pending'});
    renderGames();renderRequirements();
    return toast('Pick saved (demo)');
  }
  const payload={entry_id:state.activeEntry.id,game_id:gameId,selected_side:side};
  const {data,error}=await sb.from('picks').upsert(payload,{onConflict:'entry_id,game_id'}).select().single();
  if(error){renderGames();return toast(error.message);}
  const i=state.picks.findIndex(p=>p.game_id===gameId);
  if(i>=0)state.picks[i]=data;else state.picks.push(data);
  renderGames();renderRequirements();
}
function effectiveSpreadForPick(p){const g=state.games.find(x=>x.id===p.game_id);return g?Number(g[`${p.selected_side}_spread`]):null;}
function renderRequirements(){const rw=reentryWeek();if(!state.activeEntry&&rw){$('requirementsCard').innerHTML=`<div class="run-ended-note prominent"><strong>Run ended</strong><span>An incorrect pick ended this entry. Later picks from that week do not count. You may re-enter starting Week ${rw}.</span></div>`;return;}const min=Number(state.rules?.min_picks||0),max=Number(state.rules?.max_picks||0),n=state.picks.length,rules=state.rules?.spread_requirements||[];let html=`<h3>Week ${state.currentWeek?.week_number||''} requirements</h3><div class="req-list"><span class="req ${n>=min?'met':'unmet'}">${n}/${min} minimum picks</span>${max?`<span class="req ${n<=max?'met':'unmet'}">${n}/${max} maximum picks</span>`:''}`;for(const r of rules){const count=state.picks.filter(p=>{const s=effectiveSpreadForPick(p);return s!==null&&s>=Number(r.max_spread);}).length;html+=`<span class="req ${count>=r.required_count?'met':'unmet'}">${count}/${r.required_count} pick${r.required_count==1?'':'s'} with selected line ${fmtSpread(r.max_spread)} or higher</span>`;}html+='</div><p class="micro">You may pick more than the minimum unless a maximum is set. Spread requirements apply to the team you select.</p>';$('requirementsCard').innerHTML=html;}
async function renderStandings(){if(state.demo){state.standings=[{user_id:'demo',display_name:'Brad',current_wins:12,best_wins:12,entry_count:1,status:'active'},{user_id:'d2',display_name:'Jordan',current_wins:44,best_wins:44,entry_count:3,status:'active'},{user_id:'d3',display_name:'Taylor',current_wins:18,best_wins:21,entry_count:2,status:'active'}];}else{const {data,error}=await sb.rpc('get_standings',{p_season_id:state.currentSeason.id});if(error)return toast(error.message);state.standings=data||[];}$('standingsBody').innerHTML=state.standings.map((s,i)=>`<tr class="standing-row" data-user="${s.user_id}" data-name="${escapeHtml(s.display_name)}"><td><strong>${i+1}</strong></td><td><button class="player-picks-link" data-user="${s.user_id}" data-name="${escapeHtml(s.display_name)}">${escapeHtml(s.display_name)}</button></td><td><strong>${s.current_wins}</strong></td><td>${s.best_wins}</td><td>${s.entry_count}</td><td class="status-${s.status}">${s.status.toUpperCase()}</td><td><div class="mini-progress"><div><span style="width:${Math.min(100,s.current_wins)}%"></span></div><small>${s.current_wins}/100</small></div></td></tr>`).join('');}
async function showPlayerPicks(userId,name){$('playerPicksTitle').textContent=`${name} · Revealed Picks`;$('playerPicksList').innerHTML='<div class="home-empty">Loading…</div>';$('playerPicksDialog').showModal();if(state.demo){$('playerPicksList').innerHTML='<div class="home-empty">No kicked-off picks in the demo yet.</div>';return;}const {data,error}=await sb.rpc('get_revealed_picks',{p_season_id:state.currentSeason.id,p_user_id:userId});if(error){$('playerPicksList').innerHTML='<div class="home-empty">Reveal function is not installed yet. Run the included SQL patch in Supabase.</div>';return;}const rows=data||[];$('playerPicksList').innerHTML=rows.length?rows.map(r=>`<div class="revealed-pick"><div><strong>${escapeHtml(r.selected_team)}</strong><span>${escapeHtml(r.away_team)} @ ${escapeHtml(r.home_team)}</span></div><div><small>${new Date(r.kickoff).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small><b class="result-${r.result}">${String(r.result||'pending').toUpperCase()}</b></div></div>`).join(''):'<div class="home-empty">No picks are public yet. Future selections are not shown or counted here.</div>';}
function renderHistory(){const entries=state.demo?[{entry_number:2,current_wins:12,best_wins:12,status:'active',created_at:new Date().toISOString()},{entry_number:1,current_wins:0,best_wins:31,status:'lost',loss_week_number:4,reentry_eligible_week_number:5,created_at:new Date(Date.now()-20*864e5).toISOString()}]:state.entries;$('historyList').innerHTML=entries.map(e=>`<div class="run-card card"><div class="run-number">#${e.entry_number}</div><div><strong>${e.status==='active'?'Current run':'Completed run'}</strong><div class="muted">Started ${new Date(e.created_at).toLocaleDateString()}${e.loss_week_number?` · Lost Week ${e.loss_week_number}`:''}</div></div><div><strong>${e.status==='active'?e.current_wins:e.best_wins} wins</strong><div class="status-${e.status}">${e.status.toUpperCase()}</div>${e.reentry_eligible_week_number?`<small class="muted">Re-entry Week ${e.reentry_eligible_week_number}+</small>`:''}</div></div>`).join('')||'<div class="empty card">No entries yet.</div>';}
function spreadRuleRow(r={max_spread:-9.5,required_count:1}){return `<div class="spread-rule"><label>Max favorite spread<input class="rule-spread" type="number" step="0.5" value="${r.max_spread}"></label><label>Required picks<input class="rule-count" type="number" min="1" value="${r.required_count}"></label><button class="secondary remove-rule" type="button">✕</button></div>`;}
async function renderCommissioner(){if(state.profile?.role!=='commissioner')return; if(state.demo){$('globalSpreadRules').innerHTML=spreadRuleRow();renderAdminGames();renderDemoPlayers();return;}const {data:ss}=await sb.from('season_settings').select('*').eq('season_id',state.currentSeason.id).maybeSingle();if(ss){$('globalMinPicks').value=ss.min_picks;$('globalMaxPicks').value=ss.max_picks;$('globalReentry').value=ss.reentry_policy;$('globalMaxEntries').value=ss.max_entries;$('registrationOpen').checked=ss.registration_open;$('commissionerMessage').value=ss.commissioner_message||'';$('globalSpreadRules').innerHTML=(ss.spread_requirements||[]).map(spreadRuleRow).join('')||spreadRuleRow();}await loadWeekOverride();renderAdminGames();await loadAdminPlayers();}
async function loadWeekOverride(){if(state.demo)return;const weekId=$('commissionerWeekSelect').value||state.currentWeek?.id;if(!weekId)return;const {data}=await sb.from('week_settings').select('*').eq('week_id',weekId).maybeSingle();$('weekOverrideEnabled').checked=!!data?.override_enabled;$('weekOverrideFields').hidden=!data?.override_enabled;$('weekMinPicks').value=data?.min_picks??$('globalMinPicks').value;$('weekMaxPicks').value=data?.max_picks??$('globalMaxPicks').value;$('weekSpreadRules').innerHTML=(data?.spread_requirements||[]).map(spreadRuleRow).join('');}
function collectRules(container){return [...$(container).querySelectorAll('.spread-rule')].map(row=>({max_spread:Number(row.querySelector('.rule-spread').value),required_count:Number(row.querySelector('.rule-count').value)}));}
async function saveSeasonSettings(){if(state.demo)return toast('Settings saved in demo preview.');const payload={season_id:state.currentSeason.id,min_picks:Number($('globalMinPicks').value),max_picks:Number($('globalMaxPicks').value),reentry_policy:$('globalReentry').value,max_entries:Number($('globalMaxEntries').value),registration_open:$('registrationOpen').checked,commissioner_message:$('commissionerMessage').value,spread_requirements:collectRules('globalSpreadRules')};const {error}=await sb.from('season_settings').upsert(payload,{onConflict:'season_id'});toast(error?error.message:'Season defaults saved.');if(!error)await loadWeek();}
async function saveWeekSettings(){if(state.demo)return toast('Week override saved in demo preview.');const weekId=$('commissionerWeekSelect').value;const enabled=$('weekOverrideEnabled').checked;const payload={week_id:weekId,override_enabled:enabled,min_picks:Number($('weekMinPicks').value||0),max_picks:Number($('weekMaxPicks').value||0),spread_requirements:collectRules('weekSpreadRules')};const {error}=await sb.from('week_settings').upsert(payload,{onConflict:'week_id'});toast(error?error.message:'Week settings saved.');if(!error&&weekId===state.currentWeek.id)await loadWeek();}
function renderAdminGames(){$('adminGamesList').innerHTML=state.games.map(g=>`<div class="admin-game"><div><strong>${g.away_team} @ ${g.home_team}</strong><br><small>${new Date(g.kickoff).toLocaleString()} · ${fmtSpread(g.away_spread)} / ${fmtSpread(g.home_spread)}</small></div><div class="button-row"><button class="secondary edit-game" data-id="${g.id}">Edit</button>${g.status==='final'?'<span class="status-active">FINAL</span>':`<button class="secondary grade-game" data-id="${g.id}">Grade</button>`}</div></div>`).join('');}
async function saveGame(){const payload={week_id:$('commissionerWeekSelect').value||state.currentWeek.id,away_team:$('awayTeam').value.trim(),home_team:$('homeTeam').value.trim(),kickoff:new Date($('kickoff').value).toISOString(),network:$('network').value.trim()||null,away_spread:$('awaySpread').value===''?null:Number($('awaySpread').value),home_spread:$('homeSpread').value===''?null:Number($('homeSpread').value)};if(state.demo){payload.id=$('gameEditId').value||crypto.randomUUID();const i=state.games.findIndex(g=>g.id===payload.id);i>=0?state.games[i]={...state.games[i],...payload}:state.games.push({...payload,status:'scheduled'});renderGames();renderAdminGames();return toast('Game saved in demo.');}const id=$('gameEditId').value;let q=id?sb.from('games').update(payload).eq('id',id):sb.from('games').insert(payload);const {error}=await q;toast(error?error.message:'Game saved.');if(!error)await loadWeek();}
async function importWeek(){if(state.demo)return toast('Connect Supabase + CFBD to use live imports.');const week=state.weeks.find(w=>w.id===$('commissionerWeekSelect').value);if(!week)return;toast('Importing games…');const {data,error}=await sb.functions.invoke('import-week',{body:{season:state.currentSeason.year,week:week.week_number,week_id:week.id}});toast(error?error.message:`Imported ${data?.games_upserted||0} games.`);if(!error)await loadWeek();}
async function gradeGame(id){const g=state.games.find(x=>x.id===id);const hs=prompt(`${g.home_team} final score:`);if(hs===null)return;const as=prompt(`${g.away_team} final score:`);if(as===null)return;if(state.demo){g.status='final';g.home_score=Number(hs);g.away_score=Number(as);renderAdminGames();return toast('Game graded in demo.');}const {error}=await sb.rpc('commissioner_grade_game',{p_game_id:id,p_home_score:Number(hs),p_away_score:Number(as),p_status:'final'});toast(error?error.message:'Game graded and picks updated.');if(!error)await loadCore();}

function renderDemoPlayers(){
 state.adminPlayers=[{user_id:'demo',display_name:'Brad',disabled:false,current_wins:12,best_wins:12,entry_count:1,status:'active'},{user_id:'d2',display_name:'Jordan',disabled:false,current_wins:9,best_wins:18,entry_count:2,status:'active'}];renderAdminPlayers();
}
async function loadAdminPlayers(){
 if(state.demo)return renderDemoPlayers();
 const {data,error}=await sb.rpc('commissioner_list_players',{p_season_id:state.currentSeason.id});
 if(error){$('adminPlayersList').innerHTML='<div class="admin-note">Player Administration needs the included Supabase SQL update before it can be used.</div>';return;}
 state.adminPlayers=data||[];renderAdminPlayers();
}
function renderAdminPlayers(){
 const q=($('playerSearch')?.value||'').trim().toLowerCase();
 const rows=(state.adminPlayers||[]).filter(p=>!q||String(p.display_name).toLowerCase().includes(q));
 $('adminPlayersList').innerHTML=rows.length?rows.map(p=>`<div class="admin-player-row"><div><strong>${escapeHtml(p.display_name)}</strong><small class="${p.disabled?'account-disabled':'account-enabled'}">${p.disabled?'Disabled':'Enabled'}</small></div><div class="admin-player-stat"><b>${p.current_wins||0}</b><span>Current</span></div><div class="admin-player-stat"><b>${p.best_wins||0}</b><span>Best</span></div><div class="admin-player-stat"><b>${p.entry_count||0}</b><span>Entries</span></div><button class="secondary compact manage-player" data-user="${p.user_id}">Manage</button></div>`).join(''):'<div class="home-empty">No matching players.</div>';
}
async function openAdminPlayer(userId){
 const p=state.adminPlayers.find(x=>x.user_id===userId);if(!p)return;
 state.adminSelectedPlayer=p;$('adminPlayerId').value=userId;$('adminPlayerTitle').textContent=p.display_name;$('adminDisplayName').value=p.display_name;$('adminDisabled').value=String(!!p.disabled);$('adminEntriesList').innerHTML='<div class="home-empty">Loading entries…</div>';$('adminPlayerDialog').showModal();
 if(state.demo){state.adminSelectedEntries=[{id:'de1',entry_number:1,status:'active',current_wins:12,best_wins:12}];renderAdminEntries();return;}
 const {data,error}=await sb.rpc('commissioner_get_player_entries',{p_season_id:state.currentSeason.id,p_user_id:userId});
 if(error){$('adminEntriesList').innerHTML=`<div class="admin-note">${escapeHtml(error.message)}</div>`;return;}state.adminSelectedEntries=data||[];renderAdminEntries();
}
function renderAdminEntries(){
 $('adminEntriesList').innerHTML=(state.adminSelectedEntries||[]).length?state.adminSelectedEntries.map(e=>`<div class="admin-entry-row"><div class="admin-entry-number">#${e.entry_number}</div><div><strong>${String(e.status).toUpperCase()}</strong><div class="admin-entry-meta"><span>${e.current_wins} current wins</span><span>${e.best_wins} best</span></div></div><div class="admin-entry-actions"><button class="secondary compact adjust-entry" data-entry="${e.id}">Adjust run</button></div></div>`).join(''):'<div class="home-empty">No entries for this season yet.</div>';
}
async function saveAdminPlayer(){
 const userId=$('adminPlayerId').value;const name=$('adminDisplayName').value.trim();if(!name)return toast('Display name is required.');
 if(state.demo){const p=state.adminPlayers.find(x=>x.user_id===userId);p.display_name=name;p.disabled=$('adminDisabled').value==='true';$('adminPlayerTitle').textContent=name;renderAdminPlayers();return toast('Player saved in demo.');}
 const {error}=await sb.rpc('commissioner_update_player',{p_user_id:userId,p_display_name:name,p_disabled:$('adminDisabled').value==='true'});toast(error?error.message:'Player updated.');if(!error){await loadAdminPlayers();const fresh=state.adminPlayers.find(x=>x.user_id===userId);if(fresh){state.adminSelectedPlayer=fresh;$('adminPlayerTitle').textContent=fresh.display_name;}}
}
async function grantReentry(){
 const p=state.adminSelectedPlayer;if(!p)return;if(!confirm(`Grant a new active entry to ${p.display_name}?`))return;
 if(state.demo)return toast('Re-entry granted in demo.');
 const {error}=await sb.rpc('commissioner_grant_reentry',{p_season_id:state.currentSeason.id,p_user_id:p.user_id});toast(error?error.message:'New entry granted.');if(!error)await openAdminPlayer(p.user_id);
}
async function adjustEntry(entryId){
 const e=state.adminSelectedEntries.find(x=>x.id===entryId);if(!e)return;
 const current=prompt('Current wins:',String(e.current_wins));if(current===null)return;const best=prompt('Best wins:',String(e.best_wins));if(best===null)return;const status=prompt('Status: active, lost, champion, or disabled',e.status);if(status===null)return;
 if(!['active','lost','champion','disabled'].includes(status.trim().toLowerCase()))return toast('Invalid entry status.');
 if(!confirm('Save this manual run adjustment? It will be recorded in the audit log.'))return;
 if(state.demo)return toast('Entry adjusted in demo.');
 const {error}=await sb.rpc('commissioner_adjust_entry',{p_entry_id:entryId,p_current_wins:Number(current),p_best_wins:Number(best),p_status:status.trim().toLowerCase()});toast(error?error.message:'Entry adjusted.');if(!error)await openAdminPlayer(state.adminSelectedPlayer.user_id);
}
function openAdminPicks(){
 const p=state.adminSelectedPlayer;if(!p)return;$('adminPicksTitle').textContent=`${p.display_name} · Pick Editor`;$('adminPickWeek').innerHTML=state.weeks.map(w=>`<option value="${w.id}" ${w.id===state.currentWeek?.id?'selected':''}>Week ${w.week_number}</option>`).join('');$('adminPicksDialog').showModal();loadAdminPickGames();
}
async function loadAdminPickGames(){
 const userId=state.adminSelectedPlayer?.user_id;const weekId=$('adminPickWeek').value;if(!userId||!weekId)return;$('adminPickGames').innerHTML='<div class="home-empty">Loading started games…</div>';
 if(state.demo){$('adminPickGames').innerHTML='<div class="home-empty">No started demo games.</div>';return;}
 const {data,error}=await sb.rpc('commissioner_get_editable_picks',{p_week_id:weekId,p_user_id:userId});
 if(error){$('adminPickGames').innerHTML=`<div class="admin-note">${escapeHtml(error.message)}</div>`;return;}renderAdminPickGames(data||[]);
}
function renderAdminPickGames(rows){
 $('adminPickGames').innerHTML=rows.length?rows.map(r=>`<div class="admin-pick-row"><div class="match"><strong>${escapeHtml(r.away_team)} @ ${escapeHtml(r.home_team)}</strong><small>${new Date(r.kickoff).toLocaleString()} · ${fmtSpread(r.away_spread)} / ${fmtSpread(r.home_spread)}</small></div><div class="admin-pick-control"><select class="admin-pick-select" data-game="${r.game_id}"><option value="">No pick</option><option value="away" ${r.selected_side==='away'?'selected':''}>${escapeHtml(r.away_team)}</option><option value="home" ${r.selected_side==='home'?'selected':''}>${escapeHtml(r.home_team)}</option></select><span class="admin-pick-result result-${r.result||'pending'}">${String(r.result||'pending').toUpperCase()}</span></div><button class="secondary compact save-admin-pick" data-game="${r.game_id}">Save</button></div>`).join(''):'<div class="home-empty">No games in this week have kicked off yet. Future selections remain private.</div>';
}
async function saveAdminPick(gameId,button){
 const row=button.closest('.admin-pick-row');const side=row.querySelector('.admin-pick-select').value;const player=state.adminSelectedPlayer;if(!player)return;
 const action=side?'save':'remove';if(!confirm(`${side?'Save':'Remove'} this pick for ${player.display_name}?`))return;
 button.disabled=true;
 try{
   const fn=side?'commissioner_set_pick':'commissioner_remove_pick';const args=side?{p_season_id:state.currentSeason.id,p_user_id:player.user_id,p_game_id:gameId,p_selected_side:side}:{p_season_id:state.currentSeason.id,p_user_id:player.user_id,p_game_id:gameId};const {error}=await sb.rpc(fn,args);toast(error?error.message:(action==='save'?'Pick saved.':'Pick removed.'));if(!error)await loadAdminPickGames();
 } finally {button.disabled=false;}
}

function startDemo(){state.demo=true;state.user={id:'demo',email:'demo@example.com'};state.profile={id:'demo',display_name:'Brad',role:'commissioner'};state.seasons=[{id:'ds1',year:new Date().getFullYear(),is_active:true}];state.currentSeason=state.seasons[0];state.weeks=[{id:'dw1',season_id:'ds1',week_number:1,is_current:true}];state.currentWeek=state.weeks[0];state.games=structuredClone(demoGames);state.entries=[{id:'de1',season_id:'ds1',user_id:'demo',entry_number:1,status:'active',current_wins:12,best_wins:12,created_at:new Date().toISOString()}];state.activeEntry=state.entries[0];state.picks=[];state.rules={min_picks:5,max_picks:0,spread_requirements:[{max_spread:-9.5,required_count:1}]};showApp();fillSelectors();renderTop();renderGames();renderRequirements();renderHome();}
function bindEvents(){
 document.querySelectorAll('[data-auth-tab]').forEach(b=>b.onclick=()=>setAuthTab(b.dataset.authTab));document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>switchPage(b.dataset.page));$('demoButton').onclick=startDemo;$('gameFilter').onchange=renderGames;$('homeMakePicks').onclick=() => switchPage('picks');$('homeViewPicks').onclick=() => switchPage('picks');$('homeViewStandings').onclick=() => switchPage('standings');$('homeCommissionerButton').onclick=() => switchPage('commissioner');$('closePlayerPicks').onclick=()=>$('playerPicksDialog').close();$('standingsBody').onclick=e=>{const b=e.target.closest('.player-picks-link');if(b)showPlayerPicks(b.dataset.user,b.dataset.name);};
 $('signInForm').onsubmit=async e=>{
   e.preventDefault();
   if(!configured)return toast('Use Demo Preview or configure Supabase first.');
   const button=$('signInForm').querySelector('button[type=submit]');
   button.disabled=true;button.textContent='Signing in…';
   try{
     const {data,error}=await sb.auth.signInWithPassword({email:$('signinEmail').value.trim(),password:$('signinPassword').value});
     if(error)return toast(error.message);
     if(data?.user){state.user=data.user;await loadApp();}
   }catch(err){console.error(err);toast(err?.message||'Sign in failed.');}
   finally{button.disabled=false;button.textContent='Sign in';}
 };
 $('signUpForm').onsubmit=async e=>{e.preventDefault();if(!configured)return toast('Use Demo Preview or configure Supabase first.');const {error}=await sb.auth.signUp({email:$('signupEmail').value,password:$('signupPassword').value,options:{data:{display_name:$('signupName').value.trim()}}});toast(error?error.message:'Account created. Check your email if confirmation is enabled.');};
 $('logoutButton').onclick=async()=>{try{sessionStorage.removeItem('cfb100CurrentPage');}catch(e){};if(state.demo){location.reload();return;}await sb.auth.signOut();state.user=null;state.currentPage='home';showAuth();};
 $('seasonSelect').onchange=async()=>{state.currentSeason=state.seasons.find(s=>s.id===$('seasonSelect').value);await loadWeeks();};$('weekSelect').onchange=async()=>{state.currentWeek=state.weeks.find(w=>w.id===$('weekSelect').value);$('commissionerWeekSelect').value=state.currentWeek.id;await loadWeek();};
 $('gamesGrid').onclick=e=>{const r=e.target.closest('input[data-game]');if(r)savePick(r.dataset.game,r.dataset.side);};
 $('addGlobalSpreadRule').onclick=()=>$('globalSpreadRules').insertAdjacentHTML('beforeend',spreadRuleRow());$('addWeekSpreadRule').onclick=()=>$('weekSpreadRules').insertAdjacentHTML('beforeend',spreadRuleRow());document.addEventListener('click',e=>{if(e.target.classList.contains('remove-rule'))e.target.closest('.spread-rule').remove();if(e.target.classList.contains('edit-game')){const g=state.games.find(x=>x.id===e.target.dataset.id);if(!g)return;$('gameEditId').value=g.id;$('awayTeam').value=g.away_team;$('homeTeam').value=g.home_team;$('kickoff').value=new Date(g.kickoff).toISOString().slice(0,16);$('network').value=g.network||'';$('awaySpread').value=g.away_spread??'';$('homeSpread').value=g.home_spread??'';$('gameDialog').showModal();}if(e.target.classList.contains('grade-game'))gradeGame(e.target.dataset.id);});
 $('weekOverrideEnabled').onchange=()=>$('weekOverrideFields').hidden=!$('weekOverrideEnabled').checked;$('commissionerWeekSelect').onchange=loadWeekOverride;$('copyDefaults').onclick=()=>{$('weekOverrideEnabled').checked=true;$('weekOverrideFields').hidden=false;$('weekMinPicks').value=$('globalMinPicks').value;$('weekMaxPicks').value=$('globalMaxPicks').value;$('weekSpreadRules').innerHTML=$('globalSpreadRules').innerHTML;};
 $('saveSeasonSettings').onclick=saveSeasonSettings;$('saveWeekSettings').onclick=saveWeekSettings;$('saveMessage').onclick=saveSeasonSettings;$('importWeekButton').onclick=importWeek;$('addGameButton').onclick=()=>{$('gameForm').reset();$('gameEditId').value='';$('gameDialog').showModal();};$('gameForm').onsubmit=e=>{e.preventDefault();saveGame();$('gameDialog').close();};
 $('refreshPlayers').onclick=loadAdminPlayers;$('playerSearch').oninput=renderAdminPlayers;$('adminPlayersList').onclick=e=>{const b=e.target.closest('.manage-player');if(b)openAdminPlayer(b.dataset.user);};$('closeAdminPlayer').onclick=()=>$('adminPlayerDialog').close();$('saveAdminPlayer').onclick=saveAdminPlayer;$('grantReentry').onclick=grantReentry;$('adminEntriesList').onclick=e=>{const b=e.target.closest('.adjust-entry');if(b)adjustEntry(b.dataset.entry);};$('openPickAdmin').onclick=openAdminPicks;$('closeAdminPicks').onclick=()=>$('adminPicksDialog').close();$('adminPickWeek').onchange=loadAdminPickGames;$('adminPickGames').onclick=e=>{const b=e.target.closest('.save-admin-pick');if(b)saveAdminPick(b.dataset.game,b);};
}
boot();
