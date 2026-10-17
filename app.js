const CFG = window.PICKEM_CONFIG || {};
const configured = CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('YOUR_') && CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.includes('YOUR_');
const sb = configured ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;
const $ = id => document.getElementById(id);
const savedPage = (()=>{ try { return sessionStorage.getItem('cfb100CurrentPage') || 'home'; } catch(e) { return 'home'; } })();
const state = { user:null, profile:null, seasons:[], contests:[], activeContest:null, currentContest:null, championNames:{}, weeks:[], games:[], picks:[], entries:[], standings:[], activeEntry:null, currentSeason:null, currentWeek:null, rules:null, seasonSettings:null, entryGateMessage:'', demo:false, adminPlayers:[], adminSelectedPlayer:null, adminSelectedEntries:[], currentPage:savedPage };
let allPicksRefreshTimer = null;
const demoGames = [
  {id:'d1',week_id:'dw1',away_team:'Texas',home_team:'Ohio State',away_spread:2.5,home_spread:-2.5,kickoff:new Date(Date.now()+86400000).toISOString(),network:'ABC',status:'scheduled'},
  {id:'d2',week_id:'dw1',away_team:'Clemson',home_team:'LSU',away_spread:4.5,home_spread:-4.5,kickoff:new Date(Date.now()+90000000).toISOString(),network:'ESPN',status:'scheduled'},
  {id:'d3',week_id:'dw1',away_team:'Notre Dame',home_team:'Miami',away_spread:-3.5,home_spread:3.5,kickoff:new Date(Date.now()+95000000).toISOString(),network:'NBC',status:'scheduled'},
  {id:'d4',week_id:'dw1',away_team:'Alabama',home_team:'Florida State',away_spread:-12.5,home_spread:12.5,kickoff:new Date(Date.now()+100000000).toISOString(),network:'FOX',status:'scheduled'}
];
function toast(msg){ const t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(window._toast);window._toast=setTimeout(()=>t.hidden=true,3400); }
function fmtSpread(v){ if(v===null||v===undefined||v==='')return '—'; return Number(v)>0?`+${Number(v).toFixed(1)}`:Number(v).toFixed(1); }
function locked(g){ return g.status!=='scheduled' || Date.now()>=new Date(g.kickoff).getTime(); }
function showApp(){ $('authView').hidden=true;$('appView').hidden=false;$('userName').textContent=state.profile?.display_name||state.user?.email||'Player';const isCommissioner=state.profile?.role==='commissioner';$('commissionerNav').hidden=!isCommissioner;switchPage(state.currentPage||'home'); }
function showAuth(){ $('authView').hidden=false;$('appView').hidden=true; }
function switchPage(name){ const target=$(`${name}Page`)?name:'home';state.currentPage=target;try{sessionStorage.setItem('cfb100CurrentPage',target);}catch(e){};document.querySelectorAll('.page').forEach(p=>p.hidden=true);$(`${target}Page`).hidden=false;document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===target));stopAllPicksAutoRefresh();if(target==='home')renderHome();if(target==='allpicks'){renderAllPicks();startAllPicksAutoRefresh();}if(target==='standings')renderStandings();if(target==='history')renderHistory();if(target==='rules')renderRules();if(target==='commissioner')renderCommissioner(); }
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
  sb.auth.onAuthStateChange((event,session)=>{
    // Supabase may refresh the auth token when the browser tab regains focus.
    // A token refresh must NOT rebuild the app or change the page the player is viewing.
    setTimeout(async()=>{
      try {
        if(event==='SIGNED_OUT' || !session?.user){
          state.user=null;
          state.profile=null;
          showAuth();
          return;
        }

        state.user=session.user;

        // These events only update credentials/user data. Leave the current UI untouched.
        if(event==='TOKEN_REFRESHED' || event==='USER_UPDATED') return;

        // INITIAL_SESSION / SIGNED_IN can fire even when an already-loaded tab is
        // simply becoming active again. Do not reinitialize a visible app.
        if(state.profile && $('appView') && !$('appView').hidden) return;

        await loadApp();
      } catch(err){
        console.error(err);
        toast(err?.message || 'Authentication error.');
      }
    },0);
  });
}
async function loadApp(){ const {data:profile,error}=await sb.from('profiles').select('*').eq('id',state.user.id).single();if(error)return toast(error.message);if(profile?.disabled){await sb.auth.signOut();showAuth();return toast('This account is disabled. Contact the commissioner.');}state.profile=profile;showApp();await loadCore(); }
async function loadCore(){
  const [{data:seasons,error:seasonsError},{data:entries,error:entriesError},{data:contests,error:contestsError}] = await Promise.all([
    sb.from('seasons').select('*').order('year',{ascending:false}),
    sb.from('entries').select('*').eq('user_id',state.user.id).order('created_at',{ascending:false}),
    sb.from('contests').select('*').order('contest_number',{ascending:false})
  ]);
  if(seasonsError)return toast(seasonsError.message);
  if(entriesError)return toast(entriesError.message);
  if(contestsError)return toast(contestsError.message);

  const requestedSeasonId=state.currentSeason?.id||null;
  state.seasons=seasons||[];
  state.entries=entries||[];
  state.contests=contests||[];
  state.entryGateMessage='';
  state.currentSeason=state.seasons.find(s=>s.id===requestedSeasonId)||state.seasons.find(s=>s.is_active)||state.seasons[0]||null;

  const seasonContests=state.contests
    .filter(c=>c.season_id===state.currentSeason?.id)
    .sort((a,b)=>Number(b.contest_number||0)-Number(a.contest_number||0));
  state.activeContest=seasonContests.find(c=>c.status==='active')||null;
  state.currentContest=state.activeContest||seasonContests[0]||null;
  state.activeEntry=state.activeContest
    ? state.entries.find(e=>e.contest_id===state.activeContest.id&&e.status==='active')||null
    : null;

  if(!state.activeEntry && state.currentSeason && state.activeContest){
    const {data,error}=await sb.rpc('ensure_active_entry',{p_season_id:state.currentSeason.id});
    if(data){
      const r=await sb.from('entries').select('*').eq('id',data).single();
      if(r.data){state.activeEntry=r.data;state.entries.unshift(r.data);}
    }else if(error){
      state.entryGateMessage=error.message||'';
    }
  }

  state.championNames={};
  const championIds=[...new Set(seasonContests.map(c=>c.champion_user_id).filter(Boolean))];
  if(championIds.length){
    const {data:profiles}=await sb.from('profiles').select('id,display_name').in('id',championIds);
    for(const p of profiles||[])state.championNames[p.id]=p.display_name;
  }

  const {data:ss}=await sb.from('season_settings').select('*').eq('season_id',state.currentSeason?.id).maybeSingle();
  state.seasonSettings=ss||null;
  await loadWeeks();
  renderTop();
  renderHome();
  if(state.currentPage==='allpicks')await renderAllPicks();
}
async function loadWeeks(){ if(!state.currentSeason)return;const {data}=await sb.from('weeks').select('*').eq('season_id',state.currentSeason.id).order('week_number');state.weeks=data||[];state.currentWeek=state.weeks.find(w=>w.is_current)||state.weeks[0];fillSelectors();await loadWeek(); }
function fillSelectors(){ $('seasonSelect').innerHTML=state.seasons.map(s=>`<option value="${s.id}" ${s.id===state.currentSeason?.id?'selected':''}>${s.year}</option>`).join('');const opts=state.weeks.map(w=>`<option value="${w.id}" ${w.id===state.currentWeek?.id?'selected':''}>Week ${w.week_number}</option>`).join('');$('weekSelect').innerHTML=opts;$('commissionerWeekSelect').innerHTML=opts;if($('allPicksWeekSelect'))$('allPicksWeekSelect').innerHTML=opts; }
async function loadWeek(){ if(!state.currentWeek)return; const [g,p,r]=await Promise.all([sb.from('games').select('*').eq('week_id',state.currentWeek.id).order('kickoff'),state.activeEntry?sb.from('picks').select('*').eq('entry_id',state.activeEntry.id):Promise.resolve({data:[]}),sb.rpc('get_week_rules',{p_week_id:state.currentWeek.id})]);state.games=g.data||[];const gameIds=new Set(state.games.map(x=>x.id));state.picks=(p.data||[]).filter(x=>gameIds.has(x.game_id));state.rules=(r.data&&r.data[0])||{min_picks:0,max_picks:0,spread_requirements:[]};renderTop();renderGames();renderRequirements();renderHome();if(state.profile?.role==='commissioner')renderAdminGames(); }
function currentRoadNumber(){return Number((state.activeContest||state.currentContest)?.contest_number||1);}
function contestForEntry(entry){return state.contests.find(c=>c.id===entry?.contest_id)||null;}
function latestCompletedContest(){return state.contests.filter(c=>c.season_id===state.currentSeason?.id&&c.status==='completed').sort((a,b)=>Number(b.contest_number||0)-Number(a.contest_number||0))[0]||null;}
function latestSeasonEntry(){
  const cid=(state.activeContest||state.currentContest)?.id;
  const rows=state.entries.filter(e=>cid?e.contest_id===cid:e.season_id===state.currentSeason?.id);
  return rows.sort((a,b)=>Number(b.entry_number||0)-Number(a.entry_number||0)||new Date(b.created_at)-new Date(a.created_at))[0]||null;
}
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
function renderTop(){
  const e=state.activeEntry,latest=latestSeasonEntry(),road=currentRoadNumber();
  const wins=e?.current_wins||0;
  $('runWins').textContent=wins;
  $('runBar').style.width=`${Math.min(100,wins)}%`;
  if(e){
    $('runStatus').textContent='ACTIVE';
    $('welcomeTitle').textContent=`${state.profile?.display_name||'Player'} · Gridiron Lines · Entry #${e.entry_number}`;
  }else if(latest?.status==='lost'){
    $('runStatus').textContent='RUN ENDED';
    $('welcomeTitle').textContent=`${state.profile?.display_name||'Player'} · Gridiron Lines · Entry #${latest.entry_number}`;
  }else{
    $('runStatus').textContent=state.activeContest?'NO ACTIVE RUN':'CONTEST COMPLETE';
    $('welcomeTitle').textContent=`${state.profile?.display_name||'Player'} · Gridiron Lines`;
  }
  const canReenter=!!state.activeContest&&!e&&latest?.status==='lost';
  $('weekSubtitle').textContent=canReenter?'Weekly ATS card':(state.currentWeek?`Gridiron Lines · Week ${state.currentWeek.week_number} · ${state.games.length} FBS games loaded`:'No active week');
  const rc=$('reentryCard');if(rc)rc.hidden=!canReenter;
  const roadLabel=$('currentRoadLabel');if(roadLabel)roadLabel.textContent=`ROAD TO 100 #${road}`;
}
async function renderHome(){
  if(!$('homePage'))return;
  const wins=state.activeEntry?.current_wins||0;
  const latest=latestSeasonEntry();
  const road=currentRoadNumber();
  const canReenter=!!state.activeContest&&!state.activeEntry&&latest?.status==='lost';
  if($('homeGreeting'))$('homeGreeting').textContent=`Welcome back, ${state.profile?.display_name||'Player'}`;
  $('homeWins').textContent=wins;
  $('homeRunBar').style.width=`${Math.min(100,wins)}%`;
  const roadLabel=$('currentRoadLabel');if(roadLabel)roadLabel.textContent=`ROAD TO 100 #${road}`;

  const completed=latestCompletedContest();
  const championBox=$('championBanner');
  if(championBox){
    if(completed?.champion_user_id){
      const championName=state.championNames[completed.champion_user_id]||'Champion';
      championBox.hidden=false;
      championBox.innerHTML=`<div class="champion-trophy">🏆</div><div><span>${state.currentSeason?.year||''} ROAD TO 100 CHAMPION #${Number(completed.contest_number||1)}</span><strong>${escapeHtml(championName)}</strong><small>Gridiron Lines is now underway.</small></div>`;
    }else championBox.hidden=true;
  }

  $('homeWeekTitle').textContent=state.currentWeek?`Week ${state.currentWeek.week_number}`:'Current week';
  const open=state.games.filter(g=>!locked(g)).length;
  const picked=state.picks.length;
  const min=Number(state.rules?.min_picks||0);
  $('homeWeekSummary').innerHTML=`<div><strong>${picked}</strong><span>picks made</span></div><div><strong>${min}</strong><span>minimum</span></div><div><strong>${open}</strong><span>games open</span></div>`;
  const upcoming=state.picks.map(p=>({p,g:state.games.find(g=>g.id===p.game_id)})).filter(x=>x.g&&!locked(x.g)).sort((a,b)=>new Date(a.g.kickoff)-new Date(b.g.kickoff)).slice(0,3);
  $('homeUpcoming').innerHTML=upcoming.length?upcoming.map(({p,g})=>`<div class="upcoming-row"><div><strong>${g[p.selected_side+'_team']}</strong><span>${g.away_team} @ ${g.home_team}</span></div><small>${new Date(g.kickoff).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'})}</small></div>`).join(''):(canReenter?`<div class="run-ended-note"><strong>Run ended</strong><span>You can re-enter immediately. Unsettled picks from this week will carry forward.</span></div>`:'<div class="home-empty">No upcoming selections yet.</div>');
  const msg=state.seasonSettings?.commissioner_message?.trim();
  $('homeMessage').hidden=!msg;
  $('homeMessage').innerHTML=msg?`<strong>Commissioner message</strong><span>${escapeHtml(msg)}</span>`:'';
  const cta=$('homeMakePicks');
  if(canReenter){cta.textContent='Re-enter Pool';cta.disabled=false;}
  else if(!state.activeContest){cta.textContent='Contest Complete';cta.disabled=true;}
  else{cta.textContent="Make This Week's Picks";cta.disabled=false;}
  await loadHomeLeaders();
  paintLiveDashboard(score,goal,picked);
  await loadLivePreviousWeek();
  ensureGridironLiveTimer();
  $('homeCommissionerPanel').hidden=state.profile?.role!=='commissioner';
  if(state.profile?.role==='commissioner')$('homeCommissionerStats').innerHTML=`<div><strong>${state.games.length}</strong><span>games loaded</span></div><div><strong>${open}</strong><span>still open</span></div><div><strong>${state.standings.length}</strong><span>players</span></div>`;
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
async function loadHomeLeaders(){if(state.demo){state.standings=[{user_id:'demo',display_name:'Brad',current_wins:12,best_wins:12,entry_count:1,status:'active'},{user_id:'d2',display_name:'Jordan',current_wins:9,best_wins:18,entry_count:2,status:'active'}];}else if(state.currentSeason){const {data}=await sb.rpc('get_gridiron_standings',{p_season_id:state.currentSeason.id});state.standings=data||[];}$('homeLeaders').innerHTML=(state.standings||[]).slice(0,5).map((x,i)=>`<div class="leader-row"><span>${i+1}</span><strong>${escapeHtml(x.display_name)}</strong><b>${x.current_wins}</b></div>`).join('')||'<div class="home-empty">Standings will appear here.</div>';}
function pickedFor(gameId){return state.picks.find(p=>p.game_id===gameId);}
function renderGames(){
  const filter=$('gameFilter').value;
  let arr=state.games;
  if(filter==='open')arr=arr.filter(g=>!locked(g));
  if(filter==='picked')arr=arr.filter(g=>pickedFor(g.id));
  $('emptyGames').hidden=arr.length>0;
  $('gamesGrid').innerHTML=arr.map(g=>{
    const p=pickedFor(g.id),isLocked=locked(g);
    const kickoff=new Date(g.kickoff).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    return `<article class="game-card card ${p?'has-pick':''}">
      <div class="game-head"><span class="game-time">${kickoff}${g.network?`<b> · ${escapeHtml(g.network)}</b>`:''}</span><span class="game-state ${isLocked?'locked':'open'}">${isLocked?'LOCKED':'OPEN'}</span></div>
      <div class="matchup">${teamRow(g,'away',p,isLocked)}<div class="matchup-divider"><span>@</span></div>${teamRow(g,'home',p,isLocked)}</div>
      <div class="game-foot"><span>Opening line</span><span class="${p?'saved':''}">${p?'✓ Pick saved':'Select a team'}</span></div>
    </article>`;
  }).join('');
}
function teamRow(g,side,p,isLocked){
  const team=g[`${side}_team`],spread=g[`${side}_spread`],logo=g[`${side}_logo_url`],selected=p?.selected_side===side,disabled=isLocked||!state.activeEntry;
  const initial=escapeHtml(String(team||'?').trim().charAt(0).toUpperCase()||'?');
  const logoHtml=logo?`<span class="team-logo-wrap"><img class="team-logo" src="${escapeHtml(logo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><span class="team-logo-fallback">${initial}</span></span>`:`<span class="team-logo-wrap"><span class="team-logo-fallback" style="display:grid">${initial}</span></span>`;
  return `<label class="team-option ${selected?'selected':''} ${disabled?'disabled':''}"><input type="radio" name="game_${g.id}" data-game="${g.id}" data-side="${side}" ${selected?'checked':''} ${disabled?'disabled':''}>${logoHtml}<span class="team-copy"><span class="team-name">${escapeHtml(team)}</span><small>${side==='away'?'AWAY':'HOME'}</small></span><span class="spread">${fmtSpread(spread)}</span><span class="pick-indicator">${selected?'PICKED':'PICK'}</span></label>`;
}
async function savePick(gameId,side){
  const g=state.games.find(x=>x.id===gameId);
  if(!g||locked(g))return toast('That game is locked.');
  if(!state.activeEntry){const latest=latestSeasonEntry();return toast(latest?.status==='lost'?'Your run ended. Re-enter the pool to continue.':'No active entry is available.');}
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
function renderRequirements(){const latest=latestSeasonEntry();if(!state.activeEntry&&latest?.status==='lost'){$('requirementsCard').innerHTML=`<div class="run-ended-note prominent"><strong>Run ended</strong><span>Re-enter to continue this week. Any unsettled picks will carry into your new run automatically.</span></div>`;return;}const min=Number(state.rules?.min_picks||0),max=Number(state.rules?.max_picks||0),n=state.picks.length,rules=state.rules?.spread_requirements||[];let html=`<h3>Week ${state.currentWeek?.week_number||''} requirements</h3><div class="req-list"><span class="req ${n>=min?'met':'unmet'}">${n}/${min} minimum picks</span>${max?`<span class="req ${n<=max?'met':'unmet'}">${n}/${max} maximum picks</span>`:''}`;for(const r of rules){const count=state.picks.filter(p=>{const s=effectiveSpreadForPick(p);return s!==null&&s>=Number(r.max_spread);}).length;html+=`<span class="req ${count>=r.required_count?'met':'unmet'}">${count}/${r.required_count} pick${r.required_count==1?'':'s'} with selected line ${fmtSpread(r.max_spread)} or higher</span>`;}html+='</div><p class="micro">You may pick more than the minimum unless a maximum is set. Spread requirements apply to the team you select.</p>';$('requirementsCard').innerHTML=html;}
async function renderStandings(){
  if(state.demo){state.standings=[{user_id:'demo',display_name:'Brad',current_wins:12,best_wins:12,entry_count:1,status:'active'},{user_id:'d2',display_name:'Jordan',current_wins:44,best_wins:44,entry_count:3,status:'active'},{user_id:'d3',display_name:'Taylor',current_wins:18,best_wins:21,entry_count:2,status:'active'}];}
  else{
    const {data,error}=await sb.rpc('get_gridiron_standings',{p_season_id:state.currentSeason.id});
    if(error)return toast(error.message);
    state.standings=data||[];
  }
  const label=$('standingsRoadLabel');if(label)label.textContent=`ROAD TO 100 #${currentRoadNumber()} LEADERBOARD`;
  $('standingsBody').innerHTML=state.standings.map((s,i)=>`<tr class="standing-row" data-user="${s.user_id}" data-name="${escapeHtml(s.display_name)}"><td><strong>${i+1}</strong></td><td><button class="player-picks-link" data-user="${s.user_id}" data-name="${escapeHtml(s.display_name)}">${escapeHtml(s.display_name)}</button></td><td><strong>${s.current_wins}</strong></td><td>${s.best_wins}</td><td>${s.entry_count}</td><td class="status-${s.status}">${s.status.toUpperCase()}</td><td><div class="mini-progress"><div><span style="width:${Math.min(100,s.current_wins)}%"></span></div><small>${s.current_wins}/100</small></div></td></tr>`).join('');
  const history=$('championHistory');
  if(history){
    const completed=state.contests.filter(c=>c.season_id===state.currentSeason?.id&&c.status==='completed').sort((a,b)=>Number(b.contest_number)-Number(a.contest_number));
    history.innerHTML=completed.length?completed.map(c=>`<div class="champion-history-row"><span>🏆 ${state.currentSeason?.year||''} Road to 100 Champion #${Number(c.contest_number||1)}</span><strong>${escapeHtml(state.championNames[c.champion_user_id]||'Champion')}</strong></div>`).join(''):'<div class="home-empty">No Road to 100 champion has been crowned yet.</div>';
  }
}
function revealedPickLiveStatus(r){
  const hs=r.live_home_score,as=r.live_away_score;
  const hasScore=hs!==null&&hs!==undefined&&as!==null&&as!==undefined;
  if(!hasScore)return '';
  let detail='';
  if(r.live_status==='final')detail='FINAL';
  else if(r.live_status==='in_progress'){
    const period=Number(r.live_period||0);
    const suffix=period===1?'1st':period===2?'2nd':period===3?'3rd':period===4?'4th':period?`OT${period-4}`:'LIVE';
    detail=[suffix,r.live_clock].filter(Boolean).join(' · ');
  }else return '';
  return `<div class="revealed-live"><strong>${escapeHtml(r.away_team)} ${as} — ${escapeHtml(r.home_team)} ${hs}</strong><span>${escapeHtml(detail)}</span></div>`;
}

async function refreshEspnScores(){
  if(state.demo||!sb)return;
  try{
    const {error}=await sb.functions.invoke('espn-scores');
    if(error)console.warn('ESPN score refresh failed:',error);
  }catch(err){console.warn('ESPN score refresh failed:',err);}
}

async function fetchRevealedPicks(userId){
  const preferred=await sb.rpc('get_contest_revealed_picks',{p_season_id:state.currentSeason.id,p_user_id:userId});
  if(!preferred.error)return {data:preferred.data||[],error:null};
  return await sb.rpc('get_revealed_picks',{p_season_id:state.currentSeason.id,p_user_id:userId});
}

async function showPlayerPicks(userId,name){
  $('playerPicksTitle').textContent=`${name} · Revealed Picks`;
  $('playerPicksList').innerHTML='<div class="home-empty">Loading…</div>';
  $('playerPicksDialog').showModal();

  if(state.demo){
    $('playerPicksList').innerHTML='<div class="home-empty">No kicked-off picks in the demo yet.</div>';
    return;
  }

  await refreshEspnScores();

  const {data,error}=await fetchRevealedPicks(userId);

  if(error){
    $('playerPicksList').innerHTML='<div class="home-empty">Reveal function is not installed yet. Run the included SQL patch in Supabase.</div>';
    return;
  }

  const rows=data||[];
  if(!rows.length){
    $('playerPicksList').innerHTML='<div class="home-empty">No picks are public yet. Future selections are not shown or counted here.</div>';
    return;
  }

  const weekIds=(state.weeks||[]).map(w=>w.id).filter(Boolean);
  let seasonGames=[];

  if(weekIds.length){
    const {data:liveRows,error:liveError}=await sb
      .from('games')
      .select('id,week_id,away_team,home_team,kickoff,live_home_score,live_away_score,live_status,live_period,live_clock,live_updated_at')
      .in('week_id',weekIds);

    if(!liveError)seasonGames=liveRows||[];
  }

  const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const merged=rows.map(r=>{
    const direct=r.game_id?seasonGames.find(g=>g.id===r.game_id):null;
    const matched=direct||seasonGames.find(g=>{
      const sameTeams=
        norm(g.away_team)===norm(r.away_team) &&
        norm(g.home_team)===norm(r.home_team);
      if(!sameTeams)return false;
      if(!g.kickoff||!r.kickoff)return true;
      return Math.abs(new Date(g.kickoff).getTime()-new Date(r.kickoff).getTime())<=4*60*60*1000;
    });
    return {...r,...(matched||{})};
  });

  $('playerPicksList').innerHTML=merged.map(r=>`
    <div class="revealed-pick">
      <div>
        <strong>${escapeHtml(r.selected_team)}</strong>
        <span>${escapeHtml(r.away_team)} @ ${escapeHtml(r.home_team)}</span>
        ${revealedPickLiveStatus(r)}
      </div>
      <div>
        <small>${new Date(r.kickoff).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</small>
        <b class="result-${r.result}">${String(r.result||'pending').toUpperCase()}</b>
      </div>
    </div>
  `).join('');
}

function stopAllPicksAutoRefresh(){
  if(allPicksRefreshTimer){clearInterval(allPicksRefreshTimer);allPicksRefreshTimer=null;}
}
function startAllPicksAutoRefresh(){
  stopAllPicksAutoRefresh();
  allPicksRefreshTimer=setInterval(()=>{
    if(state.currentPage==='allpicks')renderAllPicks(true);
  },60000);
}
function allPicksGameStatus(g){
  const awayScore=g.live_away_score ?? g.away_score;
  const homeScore=g.live_home_score ?? g.home_score;
  const hasScore=awayScore!==null&&awayScore!==undefined&&homeScore!==null&&homeScore!==undefined;
  let label='LOCKED';
  if(g.live_status==='final'||g.status==='final')label='FINAL';
  else if(g.live_status==='in_progress'){
    const p=Number(g.live_period||0);
    const q=p===1?'1st':p===2?'2nd':p===3?'3rd':p===4?'4th':p?`OT${p-4}`:'LIVE';
    label=[q,g.live_clock].filter(Boolean).join(' · ');
  }
  const score=hasScore?`${escapeHtml(g.away_team)} ${awayScore} · ${escapeHtml(g.home_team)} ${homeScore}`:'';
  return `<div class="all-picks-score"><strong>${escapeHtml(label)}</strong>${score?`<span>${score}</span>`:''}</div>`;
}
function allPicksMatchRow(g){
  const time=new Date(g.kickoff).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return `<div class="all-picks-game"><strong>${escapeHtml(g.away_team)} @ ${escapeHtml(g.home_team)}</strong><span>${escapeHtml(time)}</span></div>`;
}
function wireAllPicksScrollbars(){
  const wrap=$('allPicksWrap');if(!wrap)return;
  const fixed=wrap.querySelector('.all-picks-fixed-scroll');
  const fixedInner=wrap.querySelector('.all-picks-fixed-scroll-inner');
  const tableScroll=wrap.querySelector('.all-picks-scroll');
  const table=wrap.querySelector('.all-picks-table');
  const originalHead=table?.querySelector('thead');
  if(!fixed||!fixedInner||!tableScroll||!table||!originalHead)return;

  // Use a viewport-level header overlay. Keeping it outside the table's
  // overflow containers makes the frozen names reliable in desktop browsers.
  document.querySelectorAll('body > .all-picks-fixed-head').forEach(el=>el.remove());
  const fixedHead=document.createElement('div');
  fixedHead.className='all-picks-fixed-head';
  fixedHead.hidden=true;
  fixedHead.setAttribute('aria-hidden','true');
  fixedHead.innerHTML='<div class="all-picks-fixed-head-inner"></div>';
  document.body.appendChild(fixedHead);
  const fixedHeadInner=fixedHead.firstElementChild;

  let syncing=false;
  let headTable=null;

  const buildHead=()=>{
    fixedHeadInner.innerHTML='';
    headTable=table.cloneNode(false);
    headTable.className=table.className+' all-picks-fixed-head-table';
    const clonedHead=originalHead.cloneNode(true);
    headTable.appendChild(clonedHead);
    fixedHeadInner.appendChild(headTable);

    const sourceCells=[...originalHead.querySelectorAll('th')];
    const cloneCells=[...clonedHead.querySelectorAll('th')];
    sourceCells.forEach((cell,i)=>{
      const w=cell.getBoundingClientRect().width;
      if(cloneCells[i]){
        cloneCells[i].style.width=`${w}px`;
        cloneCells[i].style.minWidth=`${w}px`;
        cloneCells[i].style.maxWidth=`${w}px`;
      }
    });
    headTable.style.width=`${table.scrollWidth}px`;
  };

  const syncHeaderScroll=()=>{ fixedHead.scrollLeft=tableScroll.scrollLeft; };

  const positionFixedElements=()=>{
    if(state.currentPage!=='allpicks'){
      fixedHead.hidden=true;
      fixed.hidden=true;
      return;
    }
    const rect=tableScroll.getBoundingClientRect();
    const tableRect=table.getBoundingClientRect();
    const topbar=document.querySelector('.topbar');
    const topOffset=topbar?Math.max(0,topbar.getBoundingClientRect().bottom):0;
    const left=Math.max(0,rect.left);
    const width=Math.max(0,Math.min(rect.width,window.innerWidth-left));

    fixed.style.left=`${left}px`;
    fixed.style.width=`${width}px`;
    fixedInner.style.width=`${table.scrollWidth}px`;
    fixed.hidden=table.scrollWidth<=tableScroll.clientWidth+1;
    if(!fixed.hidden)fixed.scrollLeft=tableScroll.scrollLeft;

    fixedHead.style.left=`${left}px`;
    fixedHead.style.width=`${width}px`;
    fixedHead.style.top=`${topOffset}px`;
    const originalHeadRect=originalHead.getBoundingClientRect();
    const headHeight=Math.max(originalHeadRect.height, originalHead.offsetHeight||0);
    const shouldShow=tableRect.top < topOffset && tableRect.bottom > topOffset + headHeight;
    fixedHead.hidden=!shouldShow;
    if(shouldShow)syncHeaderScroll();
  };

  buildHead();
  fixed.onscroll=()=>{if(syncing)return;syncing=true;tableScroll.scrollLeft=fixed.scrollLeft;syncHeaderScroll();syncing=false;};
  tableScroll.onscroll=()=>{if(syncing)return;syncing=true;fixed.scrollLeft=tableScroll.scrollLeft;syncHeaderScroll();syncing=false;};
  window.addEventListener('scroll',positionFixedElements,{passive:true});
  window.addEventListener('resize',()=>{buildHead();positionFixedElements();},{passive:true});
  requestAnimationFrame(positionFixedElements);
  if(window.ResizeObserver){const ro=new ResizeObserver(()=>{buildHead();positionFixedElements();});ro.observe(tableScroll);ro.observe(table);}
}

async function renderAllPicks(silent=false){
  const wrap=$('allPicksWrap'),select=$('allPicksWeekSelect'),meta=$('allPicksMeta');
  if(!wrap||!select||!meta)return;
  if(!state.currentSeason||!state.weeks.length){wrap.innerHTML='<div class="home-empty">Loading pool data…</div>';return;}
  const chosenId=select.value||state.currentWeek?.id;
  const week=state.weeks.find(w=>w.id===chosenId)||state.currentWeek||state.weeks[0];
  if(!week)return;
  if(select.value!==week.id)select.value=week.id;
  if(!silent)wrap.innerHTML='<div class="home-empty">Loading revealed picks…</div>';

  if(state.demo){
    meta.textContent=`Week ${week.week_number} · Demo preview`;
    wrap.innerHTML='<div class="home-empty">All Picks uses kicked-off production picks. Connect Supabase to preview the live matrix.</div>';
    return;
  }

  await refreshEspnScores();
  const [{data:games,error:gamesError},{data:standingRows,error:standingsError}]=await Promise.all([
    sb.from('games').select('id,week_id,away_team,home_team,kickoff,status,away_score,home_score,live_home_score,live_away_score,live_status,live_period,live_clock').eq('week_id',week.id).order('kickoff'),
    sb.rpc('get_gridiron_standings',{p_season_id:state.currentSeason.id})
  ]);
  if(gamesError){wrap.innerHTML=`<div class="home-empty">${escapeHtml(gamesError.message)}</div>`;return;}
  if(standingsError){wrap.innerHTML=`<div class="home-empty">${escapeHtml(standingsError.message)}</div>`;return;}

  const lockedGames=(games||[]).filter(g=>locked(g));
  const players=(standingRows||[]).slice().sort((a,b)=>String(a.display_name||'').localeCompare(String(b.display_name||'')));
  state.standings=standingRows||[];

  if(!lockedGames.length){
    meta.textContent=`Week ${week.week_number} · 0 locked games`;
    wrap.innerHTML='<div class="home-empty">No games in this week have locked yet. Future selections remain completely private.</div>';
    return;
  }

  const results=await Promise.all(players.map(async player=>{
    const {data,error}=await fetchRevealedPicks(player.user_id);
    return {player,rows:error?[]:(data||[])};
  }));

  const norm=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const gameById=new Map(lockedGames.map(g=>[g.id,g]));
  const pickMaps=new Map();
  for(const item of results){
    const map=new Map();
    for(const r of item.rows){
      let gid=r.game_id&&gameById.has(r.game_id)?r.game_id:null;
      if(!gid){
        const match=lockedGames.find(g=>norm(g.away_team)===norm(r.away_team)&&norm(g.home_team)===norm(r.home_team)&&(!g.kickoff||!r.kickoff||Math.abs(new Date(g.kickoff).getTime()-new Date(r.kickoff).getTime())<=4*60*60*1000));
        gid=match?.id||null;
      }
      if(gid&&!map.has(gid))map.set(gid,r);
    }
    pickMaps.set(item.player.user_id,map);
  }

  const header=players.map(p=>`<th class="all-picks-player-head">${escapeHtml(p.display_name)}</th>`).join('');
  const body=lockedGames.map(g=>{
    const cells=players.map(p=>{
      const pick=pickMaps.get(p.user_id)?.get(g.id);
      if(!pick)return '<td class="all-picks-cell no-pick"><span>—</span></td>';
      const team=pick.selected_team||(pick.selected_side==='home'?g.home_team:g.away_team);
      const result=String(pick.result||'pending').toLowerCase();
      const label=result==='correct'?'✓':result==='incorrect'?'✕':result==='push'?'PUSH':result==='void'?'VOID':'LIVE';
      return `<td class="all-picks-cell result-${escapeHtml(result)}"><strong>${escapeHtml(team)}</strong><span>${escapeHtml(label)}</span></td>`;
    }).join('');
    return `<tr><td class="all-picks-game-col">${allPicksMatchRow(g)}</td><td class="all-picks-score-col">${allPicksGameStatus(g)}</td>${cells}</tr>`;
  }).join('');

  meta.textContent=`Week ${week.week_number} · ${lockedGames.length} locked game${lockedGames.length===1?'':'s'} · ${players.length} player${players.length===1?'':'s'} · Updated ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
  wrap.innerHTML=`<div class="all-picks-scroll"><table class="all-picks-table"><thead><tr><th class="all-picks-game-col">Game</th><th class="all-picks-score-col">Score / status</th>${header}</tr></thead><tbody>${body}</tbody></table></div><div class="all-picks-fixed-scroll" aria-label="Horizontal scrollbar for All Picks"><div class="all-picks-fixed-scroll-inner"></div></div>`;wireAllPicksScrollbars();
}

function renderHistory(){
  const entries=state.demo?[{entry_number:2,current_wins:12,best_wins:12,status:'active',created_at:new Date().toISOString(),contest_id:'dc1'},{entry_number:1,current_wins:0,best_wins:31,status:'lost',loss_week_number:4,created_at:new Date(Date.now()-20*864e5).toISOString(),contest_id:'dc1'}]:state.entries.slice();
  entries.sort((a,b)=>{
    const ca=Number(contestForEntry(a)?.contest_number||0),cb=Number(contestForEntry(b)?.contest_number||0);
    return cb-ca||Number(b.entry_number||0)-Number(a.entry_number||0)||new Date(b.created_at)-new Date(a.created_at);
  });
  $('historyList').innerHTML=entries.map(e=>{
    const contest=contestForEntry(e),road=Number(contest?.contest_number||1);
    const isCurrent=state.activeContest?.id===e.contest_id&&e.status==='active';
    return `<div class="run-card card"><div class="run-number">#${e.entry_number}</div><div><strong>Gridiron Lines · ${isCurrent?'Current run':'Completed run'}</strong><div class="muted">Started ${new Date(e.created_at).toLocaleDateString()}${e.loss_week_number?` · Lost Week ${e.loss_week_number}`:''}</div></div><div><strong>${e.status==='active'?e.current_wins:e.best_wins} wins</strong><div class="status-${e.status}">${e.status.toUpperCase()}</div></div></div>`;
  }).join('')||'<div class="empty card">No entries yet.</div>';
}
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

function startDemo(){state.demo=true;state.user={id:'demo',email:'demo@example.com'};state.profile={id:'demo',display_name:'Brad',role:'commissioner'};state.seasons=[{id:'ds1',year:new Date().getFullYear(),is_active:true}];state.currentSeason=state.seasons[0];state.contests=[{id:'dc1',season_id:'ds1',contest_number:1,status:'active'}];state.activeContest=state.currentContest=state.contests[0];state.weeks=[{id:'dw1',season_id:'ds1',week_number:1,is_current:true}];state.currentWeek=state.weeks[0];state.games=structuredClone(demoGames);state.entries=[{id:'de1',season_id:'ds1',contest_id:'dc1',user_id:'demo',entry_number:1,status:'active',current_wins:12,best_wins:12,created_at:new Date().toISOString()}];state.activeEntry=state.entries[0];state.picks=[];state.rules={min_picks:10,max_picks:10,spread_requirements:[]};state.seasonSettings={min_picks:10,max_picks:10,push_points:0};showApp();fillSelectors();renderTop();renderGames();renderRequirements();renderHome();}
async function playerReenter(){
  const latest=latestSeasonEntry();
  if(state.activeEntry)return switchPage('picks');
  if(latest?.status!=='lost')return toast('No eliminated run is available to re-enter.');
  if(!confirm('Start a new run now? Unsettled picks from this week will carry forward automatically.'))return;
  const buttons=[$('homeMakePicks'),$('reenterPoolButton')].filter(Boolean);
  buttons.forEach(b=>b.disabled=true);
  try{
    const {data,error}=await sb.rpc('player_reenter',{p_season_id:state.currentSeason.id});
    if(error)return toast(error.message);
    await loadCore();
    switchPage('picks');
    toast('New run started. Unsettled picks carried forward.');
  }finally{buttons.forEach(b=>b.disabled=false);}
}

async function checkForContestRollover(){ return; }

/* ===== GRIDIRON LINES v1 OVERRIDES ===== */
function renderContestChrome(){
  const cr=$('currentRoadLabel');if(cr)cr.textContent='SEASON POINTS';
  const sr=$('standingsRoadLabel');if(sr)sr.textContent='SEASON LEADERBOARD';
  const cb=$('championBanner');if(cb){cb.hidden=true;cb.innerHTML='';}
}
function requiredPickCount(){
  const max=Number(state.rules?.max_picks||0),min=Number(state.rules?.min_picks||0);
  return max||min||Number(state.seasonSettings?.max_picks||state.seasonSettings?.min_picks||10)||10;
}
async function seasonScore(){
  if(state.demo)return {points:62.5,wins:62,losses:37,pushes:1,ats_pct:62.5};
  if(!state.currentSeason)return {points:0,wins:0,losses:0,pushes:0,ats_pct:0};
  const {data}=await sb.rpc('get_gridiron_standings',{p_season_id:state.currentSeason.id});
  return (data||[]).find(x=>x.user_id===state.user?.id)||{points:0,wins:0,losses:0,pushes:0,ats_pct:0};
}
function renderTop(){
  renderContestChrome();
  const n=state.picks.length,goal=requiredPickCount(),pct=goal?Math.min(100,n/goal*100):0;
  $('runWins').textContent=n;$('runBar').style.width=`${pct}%`;
  const pg=$('pickGoalText');if(pg)pg.textContent=`/ ${goal} picks`;
  $('runStatus').textContent=n===goal?'CARD COMPLETE':'CARD OPEN';
  $('welcomeTitle').textContent=`Week ${state.currentWeek?.week_number||''} · My Card`;
  $('weekSubtitle').textContent=`${n} of ${goal} picks made · each selection locks at kickoff`;
  const rc=$('reentryCard');if(rc)rc.hidden=true;
}
let gridironLiveTimer=null;
function updateGridironCountdown(){
  const box=$('liveCountdown');if(!box)return;
  const now=Date.now();
  const pickedOpen=state.picks.map(p=>state.games.find(g=>g.id===p.game_id)).filter(g=>g&&!locked(g));
  const pool=(pickedOpen.length?pickedOpen:state.games.filter(g=>!locked(g))).sort((a,b)=>new Date(a.kickoff)-new Date(b.kickoff));
  const next=pool[0];
  if(!next){box.innerHTML='<div><strong>—</strong><span>DAYS</span></div><div><strong>—</strong><span>HOURS</span></div><div><strong>—</strong><span>MIN</span></div><div><strong>—</strong><span>SEC</span></div>';if($('liveCountdownNote'))$('liveCountdownNote').textContent='No open games remain this week';return;}
  let s=Math.max(0,Math.floor((new Date(next.kickoff).getTime()-now)/1000));const d=Math.floor(s/86400);s%=86400;const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60),sec=s%60;
  box.innerHTML=`<div><strong>${d}</strong><span>DAYS</span></div><div><strong>${String(h).padStart(2,'0')}</strong><span>HOURS</span></div><div><strong>${String(m).padStart(2,'0')}</strong><span>MIN</span></div><div><strong>${String(sec).padStart(2,'0')}</strong><span>SEC</span></div>`;
  const team=pickedOpen.length?'your next selected game':'the next available game';if($('liveCountdownNote'))$('liveCountdownNote').textContent=`${team} locks at kickoff`;
}
async function loadLivePreviousWeek(){
  const label=$('livePrevWeekLabel');if(!label)return;
  const prevNo=Number(state.currentWeek?.week_number||0)-1;label.textContent=prevNo>0?`WEEK ${prevNo}`:'PREVIOUS WEEK';
  if(state.demo)return;
  const {data}=await sb.rpc('get_gridiron_week_results',{p_season_id:state.currentSeason.id,p_user_id:state.user.id});
  const r=(data||[]).find(x=>Number(x.week_number)===prevNo&&Number(x.picks)>0);
  $('livePrevWins').textContent=r?.wins??'—';$('livePrevLosses').textContent=r?.losses??'—';$('livePrevPushes').textContent=r?.pushes??'—';$('livePrevPoints').textContent=r?Number(r.points||0).toFixed(Number(r.points||0)%1?1:0):'0';
}
function paintLiveDashboard(score,goal,picked){
  if(!$('livePickCount'))return;
  $('livePickCount').textContent=`${picked} of ${goal}`;$('liveWeekLabel').textContent=`WEEK ${state.currentWeek?.week_number||''}`;
  $('liveSeasonWins').textContent=score.wins||0;$('liveSeasonLosses').textContent=score.losses||0;$('liveSeasonPushes').textContent=score.pushes||0;
  const rank=(state.standings||[]).findIndex(x=>x.user_id===state.user?.id);$('liveSeasonRank').textContent=rank>=0?`Rank: ${rank+1} of ${state.standings.length}`:'Rank: —';
  const push=Number(state.seasonSettings?.push_points??0);$('liveHowPick').textContent=`Choose exactly ${goal} game${goal===1?'':'s'} against the spread`;$('liveHowScore').textContent=`1 point for a win · ${push} for a push`;
  $('liveStandings').innerHTML=(state.standings||[]).slice(0,3).map((x,i)=>`<div class="live-standing-row"><span>${i+1}</span><strong>${escapeHtml(x.display_name)}</strong><b>${Number(x.points||0).toFixed(Number(x.points||0)%1?1:0)} pts</b></div>`).join('')||'<div class="home-empty">Standings will appear here.</div>';
  updateGridironCountdown();
}
function ensureGridironLiveTimer(){if(gridironLiveTimer)return;gridironLiveTimer=setInterval(()=>{updateGridironCountdown();},1000);}

async function renderHome(){
  if(!$('homePage'))return;
  renderContestChrome();
  const obsoleteChampion=$('championBanner'); if(obsoleteChampion){obsoleteChampion.hidden=true;obsoleteChampion.innerHTML='';}
  const score=await seasonScore(),goal=requiredPickCount(),picked=state.picks.length,open=state.games.filter(g=>!locked(g)).length;
  if($('homeGreeting'))$('homeGreeting').textContent=`Welcome back, ${state.profile?.display_name||'Player'}`;
  $('homeWins').textContent=Number(score.points||0).toFixed(Number(score.points||0)%1?1:0);
  $('homeRunBar').style.width=`${goal?Math.min(100,picked/goal*100):0}%`;
  $('homeWeekTitle').textContent=state.currentWeek?`Week ${state.currentWeek.week_number}`:'Current week';
  $('homeWeekSummary').innerHTML=`<div><strong>${picked}/${goal}</strong><span>picks made</span></div><div><strong>${score.wins}-${score.losses}-${score.pushes}</strong><span>season ATS</span></div><div><strong>${open}</strong><span>games open</span></div>`;
  const upcoming=state.picks.map(p=>({p,g:state.games.find(g=>g.id===p.game_id)})).filter(x=>x.g&&!locked(x.g)).sort((a,b)=>new Date(a.g.kickoff)-new Date(b.g.kickoff)).slice(0,3);
  $('homeUpcoming').innerHTML=upcoming.length?upcoming.map(({p,g})=>`<div class="upcoming-row"><div><strong>${escapeHtml(g[p.selected_side+'_team'])} ${fmtSpread(g[p.selected_side+'_spread'])}</strong><span>${escapeHtml(g.away_team)} @ ${escapeHtml(g.home_team)}</span></div><small>${new Date(g.kickoff).toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'})}</small></div>`).join(''):'<div class="home-empty">No upcoming selections yet.</div>';
  const msg=state.seasonSettings?.commissioner_message?.trim();$('homeMessage').hidden=!msg;$('homeMessage').innerHTML=msg?`<strong>Commissioner message</strong><span>${escapeHtml(msg)}</span>`:'';
  $('homeMakePicks').textContent=picked===goal?'Review My Card':"Make This Week's Picks";
  await loadHomeLeaders();
  paintLiveDashboard(score,goal,picked);
  await loadLivePreviousWeek();
  ensureGridironLiveTimer();
  $('homeCommissionerPanel').hidden=state.profile?.role!=='commissioner';
  if(state.profile?.role==='commissioner')$('homeCommissionerStats').innerHTML=`<div><strong>${state.games.length}</strong><span>games loaded</span></div><div><strong>${goal}</strong><span>required picks</span></div><div><strong>${state.standings.length}</strong><span>players</span></div>`;
}
async function loadHomeLeaders(){
  if(state.demo)state.standings=[{user_id:'demo',display_name:'Brad',points:62.5,wins:62,losses:37,pushes:1},{user_id:'d2',display_name:'Jordan',points:60,wins:60,losses:40,pushes:0}];
  else if(state.currentSeason){const {data}=await sb.rpc('get_gridiron_standings',{p_season_id:state.currentSeason.id});state.standings=data||[];}
  $('homeLeaders').innerHTML=(state.standings||[]).slice(0,5).map((x,i)=>`<div class="leader-row"><span>${i+1}</span><strong>${escapeHtml(x.display_name)}</strong><b>${Number(x.points||0).toFixed(Number(x.points||0)%1?1:0)} pts</b></div>`).join('')||'<div class="home-empty">Standings will appear here.</div>';
}
function renderRequirements(){
  const goal=requiredPickCount(),n=state.picks.length;
  $('requirementsCard').innerHTML=`<h3>Week ${state.currentWeek?.week_number||''} card</h3><div class="req-list"><span class="req ${n===goal?'met':'unmet'}">${n}/${goal} picks</span><span class="req met">One frozen line per game</span><span class="req met">Push = ${Number(state.seasonSettings?.push_points??0)} pts</span></div><p class="micro">Make exactly ${goal} selections. Picks lock individually at kickoff; the displayed spread is the same official pool line for every competitor.</p>`;
}
async function renderStandings(){
  if(state.demo)state.standings=[{user_id:'demo',display_name:'Brad',points:62.5,wins:62,losses:37,pushes:1,ats_pct:62.5},{user_id:'d2',display_name:'Jordan',points:60,wins:60,losses:40,pushes:0,ats_pct:60}];
  else{const {data,error}=await sb.rpc('get_gridiron_standings',{p_season_id:state.currentSeason.id});if(error)return toast(error.message);state.standings=data||[];}
  const label=$('standingsRoadLabel');if(label)label.textContent='SEASON LEADERBOARD';
  $('standingsBody').innerHTML=state.standings.map((s,i)=>`<tr><td><strong>${i+1}</strong></td><td><button class="player-picks-link" data-user="${s.user_id}" data-name="${escapeHtml(s.display_name)}">${escapeHtml(s.display_name)}</button></td><td><strong>${Number(s.points||0).toFixed(Number(s.points||0)%1?1:0)}</strong></td><td>${s.wins||0}</td><td>${s.losses||0}</td><td>${s.pushes||0}</td><td>${Number(s.ats_pct||0).toFixed(1)}%</td></tr>`).join('');
  const history=$('championHistory');if(history)history.innerHTML=`<div class="champion-history-row"><span>Push value</span><strong>${Number(state.seasonSettings?.push_points??0)} point${Number(state.seasonSettings?.push_points??0)===1?'':'s'}</strong></div>`;
}
async function renderHistory(){
  if(state.demo){$('historyList').innerHTML='<div class="run-card card"><div class="run-number">7</div><div><strong>Week 7</strong><div class="muted">10 picks</div></div><div><strong>7.5 points</strong><div class="status-active">7-2-1 ATS</div></div></div>';return;}
  const {data,error}=await sb.rpc('get_gridiron_week_results',{p_season_id:state.currentSeason.id,p_user_id:state.user.id});
  if(error){$('historyList').innerHTML=`<div class="home-empty">${escapeHtml(error.message)}</div>`;return;}
  $('historyList').innerHTML=(data||[]).filter(x=>Number(x.picks)>0).map(x=>`<div class="run-card card"><div class="run-number">${x.week_number}</div><div><strong>Week ${x.week_number}</strong><div class="muted">${x.picks} picks graded/placed</div></div><div><strong>${Number(x.points||0).toFixed(Number(x.points||0)%1?1:0)} points</strong><div class="status-active">${x.wins}-${x.losses}-${x.pushes} ATS</div></div></div>`).join('')||'<div class="empty card">No weekly results yet.</div>';
}
async function fetchRevealedPicks(userId){
  const weekId=$('allPicksWeekSelect')?.value||null;
  const r=await sb.rpc('get_gridiron_revealed_picks',{p_season_id:state.currentSeason.id,p_user_id:userId,p_week_id:weekId});
  if(r.error)return r;
  return {data:(r.data||[]).map(x=>({...x,result:x.ats_result==='win'?'correct':x.ats_result==='loss'?'incorrect':x.ats_result==='push'?'push':'pending'})),error:null};
}
async function saveSeasonSettings(){
  if(state.demo)return toast('Settings saved in demo preview.');
  const count=Math.max(1,Number($('globalMinPicks').value||10)),push=Math.max(0,Math.min(1,Number($('pushPoints').value||0)));
  $('globalMaxPicks').value=count;
  const payload={season_id:state.currentSeason.id,min_picks:count,max_picks:count,reentry_policy:'disabled',max_entries:1,registration_open:$('registrationOpen').checked,commissioner_message:$('commissionerMessage').value,spread_requirements:[],push_points:push};
  const {error}=await sb.from('season_settings').upsert(payload,{onConflict:'season_id'});toast(error?error.message:'Gridiron Lines season settings saved.');if(!error){state.seasonSettings={...(state.seasonSettings||{}),...payload};await loadWeek();}
}
async function saveWeekSettings(){
  if(state.demo)return toast('Week settings saved in demo preview.');
  const weekId=$('commissionerWeekSelect').value,enabled=$('weekOverrideEnabled').checked,count=Math.max(1,Number($('weekMinPicks').value||$('globalMinPicks').value||10));
  $('weekMaxPicks').value=count;
  const payload={week_id:weekId,override_enabled:enabled,min_picks:count,max_picks:count,spread_requirements:[]};
  const {error}=await sb.from('week_settings').upsert(payload,{onConflict:'week_id'});toast(error?error.message:'Week pick count saved.');if(!error&&weekId===state.currentWeek.id)await loadWeek();
}
async function renderCommissioner(){
  if(state.profile?.role!=='commissioner')return;
  if(state.demo){$('globalMinPicks').value=10;$('globalMaxPicks').value=10;$('pushPoints').value=0;renderAdminGames();renderDemoPlayers();return;}
  const {data:ss}=await sb.from('season_settings').select('*').eq('season_id',state.currentSeason.id).maybeSingle();
  if(ss){$('globalMinPicks').value=ss.max_picks||ss.min_picks||10;$('globalMaxPicks').value=ss.max_picks||ss.min_picks||10;$('pushPoints').value=ss.push_points??0;$('registrationOpen').checked=ss.registration_open;$('commissionerMessage').value=ss.commissioner_message||'';}
  await loadWeekOverride();renderAdminGames();await loadAdminPlayers();
}
async function loadWeekOverride(){
  if(state.demo)return;const weekId=$('commissionerWeekSelect').value||state.currentWeek?.id;if(!weekId)return;
  const {data}=await sb.from('week_settings').select('*').eq('week_id',weekId).maybeSingle();
  $('weekOverrideEnabled').checked=!!data?.override_enabled;$('weekOverrideFields').hidden=!data?.override_enabled;
  const count=data?.max_picks||data?.min_picks||$('globalMinPicks').value||10;$('weekMinPicks').value=count;$('weekMaxPicks').value=count;
}
function renderAdminGames(){
  $('adminGamesList').innerHTML=state.games.map(g=>`<div class="admin-game"><div><strong>${escapeHtml(g.away_team)} @ ${escapeHtml(g.home_team)}</strong><br><small>${new Date(g.kickoff).toLocaleString()} · official line ${fmtSpread(g.away_spread)} / ${fmtSpread(g.home_spread)}</small></div><div class="button-row"><span class="privacy-chip">LINE FROZEN</span><button class="secondary edit-game" data-id="${g.id}">Edit</button>${g.status==='final'?'<span class="status-active">FINAL</span>':`<button class="secondary grade-game" data-id="${g.id}">Grade</button>`}</div></div>`).join('');
}
async function saveGame(){
  const id=$('gameEditId').value,payload={week_id:$('commissionerWeekSelect').value||state.currentWeek.id,away_team:$('awayTeam').value.trim(),home_team:$('homeTeam').value.trim(),kickoff:new Date($('kickoff').value).toISOString(),network:$('network').value.trim()||null,away_spread:$('awaySpread').value===''?null:Number($('awaySpread').value),home_spread:$('homeSpread').value===''?null:Number($('homeSpread').value)};
  if(state.demo){return toast('Game saved in demo.');}
  if(id){
    const g=state.games.find(x=>x.id===id),spreadChanged=Number(payload.away_spread)!==Number(g?.away_spread)||Number(payload.home_spread)!==Number(g?.home_spread);
    const base={week_id:payload.week_id,away_team:payload.away_team,home_team:payload.home_team,kickoff:payload.kickoff,network:payload.network};
    let {error}=await sb.from('games').update(base).eq('id',id);
    if(!error&&spreadChanged){if(!confirm('This changes the official frozen pool line for EVERY player. Continue?'))return loadWeek();const r=await sb.rpc('commissioner_set_pool_spread',{p_game_id:id,p_away_spread:payload.away_spread,p_home_spread:payload.home_spread});error=r.error;}
    toast(error?error.message:'Game saved. Official line is frozen for everyone.');if(!error)await loadWeek();return;
  }
  const {error}=await sb.from('games').insert(payload);toast(error?error.message:'Game added. Its first spread is now the official frozen pool line.');if(!error)await loadWeek();
}

function bindEvents(){
 document.querySelectorAll('[data-auth-tab]').forEach(b=>b.onclick=()=>setAuthTab(b.dataset.authTab));document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>switchPage(b.dataset.page));$('demoButton').onclick=startDemo;$('gameFilter').onchange=renderGames;$('homeMakePicks').onclick=()=>switchPage('picks');if($('reenterPoolButton'))$('reenterPoolButton').onclick=playerReenter;$('homeViewPicks').onclick=() => switchPage('picks');$('homeViewStandings').onclick=() => switchPage('standings');$('homeCommissionerButton').onclick=() => switchPage('commissioner');$('closePlayerPicks').onclick=()=>$('playerPicksDialog').close();$('standingsBody').onclick=e=>{const b=e.target.closest('.player-picks-link');if(b)showPlayerPicks(b.dataset.user,b.dataset.name);};if($('allPicksWeekSelect'))$('allPicksWeekSelect').onchange=()=>renderAllPicks();
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
 $('seasonSelect').onchange=async()=>{state.currentSeason=state.seasons.find(s=>s.id===$('seasonSelect').value);await loadCore();};$('weekSelect').onchange=async()=>{state.currentWeek=state.weeks.find(w=>w.id===$('weekSelect').value);$('commissionerWeekSelect').value=state.currentWeek.id;await loadWeek();};
 $('gamesGrid').onclick=e=>{const r=e.target.closest('input[data-game]');if(r)savePick(r.dataset.game,r.dataset.side);};
 $('addGlobalSpreadRule').onclick=()=>$('globalSpreadRules').insertAdjacentHTML('beforeend',spreadRuleRow());$('addWeekSpreadRule').onclick=()=>$('weekSpreadRules').insertAdjacentHTML('beforeend',spreadRuleRow());document.addEventListener('click',e=>{if(e.target.classList.contains('remove-rule'))e.target.closest('.spread-rule').remove();if(e.target.classList.contains('edit-game')){const g=state.games.find(x=>x.id===e.target.dataset.id);if(!g)return;$('gameEditId').value=g.id;$('awayTeam').value=g.away_team;$('homeTeam').value=g.home_team;$('kickoff').value=new Date(g.kickoff).toISOString().slice(0,16);$('network').value=g.network||'';$('awaySpread').value=g.away_spread??'';$('homeSpread').value=g.home_spread??'';$('gameDialog').showModal();}if(e.target.classList.contains('grade-game'))gradeGame(e.target.dataset.id);});
 $('weekOverrideEnabled').onchange=()=>$('weekOverrideFields').hidden=!$('weekOverrideEnabled').checked;$('commissionerWeekSelect').onchange=loadWeekOverride;$('copyDefaults').onclick=()=>{$('weekOverrideEnabled').checked=true;$('weekOverrideFields').hidden=false;$('weekMinPicks').value=$('globalMinPicks').value;$('weekMaxPicks').value=$('globalMinPicks').value;};
 $('saveSeasonSettings').onclick=saveSeasonSettings;$('saveWeekSettings').onclick=saveWeekSettings;$('saveMessage').onclick=saveSeasonSettings;$('importWeekButton').onclick=importWeek;$('addGameButton').onclick=()=>{$('gameForm').reset();$('gameEditId').value='';$('gameDialog').showModal();};$('gameForm').onsubmit=e=>{e.preventDefault();saveGame();$('gameDialog').close();};
 $('refreshPlayers').onclick=loadAdminPlayers;$('playerSearch').oninput=renderAdminPlayers;$('adminPlayersList').onclick=e=>{const b=e.target.closest('.manage-player');if(b)openAdminPlayer(b.dataset.user);};$('closeAdminPlayer').onclick=()=>$('adminPlayerDialog').close();$('saveAdminPlayer').onclick=saveAdminPlayer;$('grantReentry').onclick=grantReentry;$('adminEntriesList').onclick=e=>{const b=e.target.closest('.adjust-entry');if(b)adjustEntry(b.dataset.entry);};$('openPickAdmin').onclick=openAdminPicks;$('closeAdminPicks').onclick=()=>$('adminPicksDialog').close();$('adminPickWeek').onchange=loadAdminPickGames;$('adminPickGames').onclick=e=>{const b=e.target.closest('.save-admin-pick');if(b)saveAdminPick(b.dataset.game,b);};
}
boot();
