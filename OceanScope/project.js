/* =========================================================================
   DATA LAYER — mock ocean model + observation network
   ========================================================================= */

const DEPTH_LEVELS = [0,50,100,200,500,1000];
const DAYS = Array.from({length:7},(_,i)=>{
  const d = new Date(Date.UTC(2026,7,25+i,12,0,0));
  return d;
});
const PALETTES = {
  Turbo:   ['#30123b','#4145ab','#3d7ffb','#1fc8de','#4be36a','#c8e621','#fca50a','#e2461a','#7a0403'],
  Viridis: ['#440154','#472d7b','#3b528b','#2c728e','#21918c','#28ae80','#5ec962','#addc30','#fde725'],
  Plasma:  ['#0d0887','#5302a3','#8b0aa5','#b83289','#db5c68','#f48849','#febc2a','#f0f921'],
  'Cool-Warm': ['#3b4cc0','#6f92f3','#aac7fd','#dddddd','#f7b89c','#e3765a','#b40426']
};
const REGIONS = {
  'Arabian Sea':  {latMin:12,latMax:24,lonMin:60,lonMax:74, base:{Temperature:29.5,Salinity:36.4,Current:0.55,Chlorophyll:0.9}},
  'Bay of Bengal':{latMin:8, latMax:22,lonMin:82,lonMax:96, base:{Temperature:28.6,Salinity:33.6,Current:0.4, Chlorophyll:0.6}},
  'Indian Ocean': {latMin:-10,latMax:24,lonMin:55,lonMax:96, base:{Temperature:27.8,Salinity:35.0,Current:0.6, Chlorophyll:0.5}},
};
const UNITS = {Temperature:'°C', Salinity:'PSU', Current:'m/s', Chlorophyll:'mg/m³'};
const RANGES = {Temperature:[10,30], Salinity:[32,38], Current:[0,1.6], Chlorophyll:[0,2]};

function seededNoise(x,y,z=0){
  const v = Math.sin(x*12.9898+y*78.233+z*37.719)*43758.5453;
  return v - Math.floor(v); // 0..1
}

// smooth field value for variable at normalized (u,v in 0..1), depth, day index
function fieldValue(variable, region, u, v, depth, dayIdx){
  const base = REGIONS[region].base[variable];
  const n = seededNoise(u*3.1+dayIdx*0.05, v*3.7, dayIdx*0.02);
  const wave = Math.sin(u*6+dayIdx*0.4)*Math.cos(v*5-dayIdx*0.25);
  let val;
  if(variable==='Temperature'){
    const thermocline = depth<=0?0: (depth<100? depth*0.06 : 6 + Math.log(1+(depth-100))*1.9);
    val = base - thermocline + wave*1.1 + (n-0.5)*0.8;
  } else if(variable==='Salinity'){
    const depthAdj = depth>200? 0.6 : 0;
    val = base + depthAdj + wave*0.35 + (n-0.5)*0.3;
  } else if(variable==='Current'){
    const decay = Math.exp(-depth/300);
    val = Math.max(0, (base + wave*0.3)*decay + (n-0.5)*0.15);
  } else { // Chlorophyll
    const decay = Math.exp(-depth/60);
    val = Math.max(0.02, (base + wave*0.25)*decay + (n-0.5)*0.2);
  }
  return val;
}

// depth interpolation status
function depthStatus(depth){
  if(DEPTH_LEVELS.includes(depth)) return {status:'EXACT', note:`Depth ${depth} m matches a native model level.`};
  let lower=DEPTH_LEVELS[0], upper=DEPTH_LEVELS[DEPTH_LEVELS.length-1];
  for(let i=0;i<DEPTH_LEVELS.length-1;i++){
    if(depth>DEPTH_LEVELS[i] && depth<DEPTH_LEVELS[i+1]){lower=DEPTH_LEVELS[i];upper=DEPTH_LEVELS[i+1];break;}
  }
  return {status:'INTERPOLATED', note:`Depth ${depth} m is interpolated: ${lower} m → ${upper} m.`};
}

// build ARGO / glider network per region
function buildFloats(){
  const floats = [];
  let idc = 6903790;
  const specs = [
    {region:'Arabian Sea', type:'ARGO FLOAT', u:0.32, v:0.62, anomaly:false},
    {region:'Arabian Sea', type:'ARGO FLOAT', u:0.58, v:0.38, anomaly:true},
    {region:'Arabian Sea', type:'GLIDER',     u:0.71, v:0.55, anomaly:false},
    {region:'Bay of Bengal', type:'ARGO FLOAT', u:0.4, v:0.45, anomaly:false},
    {region:'Bay of Bengal', type:'CTD',        u:0.62, v:0.65, anomaly:false},
    {region:'Indian Ocean', type:'ARGO FLOAT', u:0.5, v:0.5, anomaly:false},
    {region:'Indian Ocean', type:'GLIDER',     u:0.25,v:0.7, anomaly:false},
  ];
  specs.forEach((s,i)=>{
    const R = REGIONS[s.region];
    const lat = R.latMin + s.v*(R.latMax-R.latMin);
    const lon = R.lonMin + s.u*(R.lonMax-R.lonMin);
    const id = idc + i*3;
    const profile = DEPTH_LEVELS.map(d=>{
      const modelT = fieldValue('Temperature', s.region, s.u, s.v, d, 0);
      const modelS = fieldValue('Salinity', s.region, s.u, s.v, d, 0);
      let obsT = modelT + (seededNoise(s.u,s.v,d)-0.5)*0.9;
      let obsS = modelS + (seededNoise(s.u+1,s.v,d)-0.5)*0.5;
      if(s.anomaly && d===50){ obsT = modelT + 4.0; } // deliberate anomaly for demo
      return {depth:d, modelT:+modelT.toFixed(1), obsT:+obsT.toFixed(1), modelS:+modelS.toFixed(2), obsS:+obsS.toFixed(2)};
    });
    floats.push({
      id:'F'+id, label:s.type, region:s.region, u:s.u, v:s.v, lat:+lat.toFixed(2), lon:+lon.toFixed(2),
      instrument: s.type==='ARGO FLOAT' ? 'ARGO profiling float' : s.type==='GLIDER' ? 'Autonomous underwater glider' : 'CTD rosette cast',
      variables: s.type==='CTD' ? ['Temperature','Salinity','Pressure'] : ['Temperature','Salinity','Pressure'],
      depthRange:'0–1000 m', profile, anomaly:s.anomaly, timestamp: DAYS[0]
    });
  });
  return floats;
}
const FLOATS = buildFloats();

function fmtDate(d){
  return d.toISOString().slice(0,10).split('-').reverse().join(' ').replace(/^(\d+) (\d+) (\d+)$/, (m,dd,mm,yy)=>{
    const months=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${dd} ${months[+mm]} ${yy}`;
  });
}
function fmtDateTime(d){ return fmtDate(d)+' '+String(d.getUTCHours()).padStart(2,'0')+':00 UTC'; }

/* =========================================================================
   APP STATE
   ========================================================================= */
const state = {
  model:'HYCOM', variable:'Temperature', region:'Arabian Sea',
  depth:0, dayIdx:0, playing:false, playTimer:null,
  palette:'Turbo', vexag:1, opacity:1,
  overlays:{model:true, argo:true, glider:false, anomaly:true},
  selectedFloat:null, viewMode:'3d'
};

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* =========================================================================
   VIEW ROUTING
   ========================================================================= */
function goTo(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  document.querySelectorAll('.topbar-nav button').forEach(b=>b.classList.toggle('active', b.dataset.nav===view));
  if(view==='explore'){ setTimeout(()=>{ resizeRenderer(); },30); }
  if(view==='compare'){ renderCompare(); }
  if(view==='analysis'){ renderAnalysisCharts(); }
  window.scrollTo(0,0);
}
function scrollToFeatures(){ document.getElementById('feature-grid').scrollIntoView({behavior:'smooth'}); }
function openAbout(){ document.getElementById('modal-about').classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }

/* =========================================================================
   LANDING BACKGROUND ANIMATION (lightweight canvas waves)
   ========================================================================= */
(function landingBG(){
  const canvas = document.getElementById('landing-canvas');
  const ctx = canvas.getContext('2d');
  let w,h,t=0;
  function resize(){ w=canvas.width=innerWidth; h=canvas.height=innerHeight; }
  resize(); addEventListener('resize', resize);
  function draw(){
    t+=0.006;
    const grad = ctx.createLinearGradient(0,0,0,h);
    grad.addColorStop(0,'#061520'); grad.addColorStop(1,'#020a0f');
    ctx.fillStyle = grad; ctx.fillRect(0,0,w,h);
    const layers = [
      {amp:26, freq:0.006, speed:1.0, y:h*0.62, color:'rgba(34,193,201,0.10)'},
      {amp:34, freq:0.004, speed:0.6, y:h*0.72, color:'rgba(34,193,201,0.08)'},
      {amp:44, freq:0.003, speed:0.35,y:h*0.84, color:'rgba(77,139,124,0.10)'},
    ];
    layers.forEach(l=>{
      ctx.beginPath(); ctx.moveTo(0,h);
      for(let x=0;x<=w;x+=12){
        const y = l.y + Math.sin(x*l.freq + t*l.speed)*l.amp;
        ctx.lineTo(x,y);
      }
      ctx.lineTo(w,h); ctx.closePath();
      ctx.fillStyle = l.color; ctx.fill();
    });
    // subtle dot grid (data points)
    ctx.fillStyle='rgba(94,190,196,0.35)';
    for(let i=0;i<40;i++){
      const x=(i*97+ (t*10))%w;
      const y = h*0.15 + (i*53%150);
      ctx.fillRect(x,y,1.6,1.6);
    }
    requestAnimationFrame(draw);
  }
  draw();
})();

/* =========================================================================
   THREE.JS OCEAN VIEWER
   ========================================================================= */
let renderer, scene, camera, group, fieldMesh, markerGroup, raycaster, mouse;
let rotation = {x:-0.55, y:0.6}, dragging=false, lastX=0,lastY=0, camDist=7.2;
const GRID_N = 46;

function initViewer(){
  const canvas = document.getElementById('viewer-canvas');
  renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true, preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42,1,0.1,100);
  group = new THREE.Group(); scene.add(group);

  const amb = new THREE.AmbientLight(0xffffff,0.9); scene.add(amb);
  const dir = new THREE.DirectionalLight(0xbfe9ee,0.6); dir.position.set(3,5,2); scene.add(dir);

  // grid helper ring (depth cage)
  const cage = new THREE.GridHelper(6.4, 16, 0x1c3a44, 0x14252c);
  cage.position.y = 0;
  group.add(cage);

  const geo = new THREE.PlaneGeometry(6,6,GRID_N,GRID_N);
  geo.rotateX(-Math.PI/2);
  const mat = new THREE.MeshPhongMaterial({vertexColors:true, side:THREE.DoubleSide, shininess:18, transparent:true, opacity:1});
  fieldMesh = new THREE.Mesh(geo, mat);
  group.add(fieldMesh);

  markerGroup = new THREE.Group(); group.add(markerGroup);

  raycaster = new THREE.Raycaster(); mouse = new THREE.Vector2();

  buildMarkers();
  updateField();
  resizeRenderer();

  const canvasEl = canvas;
  canvasEl.addEventListener('mousedown', e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;});
  addEventListener('mouseup', ()=>dragging=false);
  addEventListener('mousemove', e=>{
    if(dragging){
      rotation.y += (e.clientX-lastX)*0.006;
      rotation.x += (e.clientY-lastY)*0.006;
      rotation.x = Math.max(-1.3, Math.min(0.1, rotation.x));
      lastX=e.clientX; lastY=e.clientY;
    }
    handleHover(e);
  });
  canvasEl.addEventListener('wheel', e=>{
    e.preventDefault();
    camDist += e.deltaY*0.003;
    camDist = Math.max(3.5, Math.min(14, camDist));
  }, {passive:false});
  canvasEl.addEventListener('click', handleClick);
  // touch support (basic rotate)
  canvasEl.addEventListener('touchstart', e=>{dragging=true;lastX=e.touches[0].clientX;lastY=e.touches[0].clientY;});
  canvasEl.addEventListener('touchend', ()=>dragging=false);
  canvasEl.addEventListener('touchmove', e=>{
    if(dragging){
      rotation.y += (e.touches[0].clientX-lastX)*0.006;
      rotation.x += (e.touches[0].clientY-lastY)*0.006;
      rotation.x = Math.max(-1.3, Math.min(0.1, rotation.x));
      lastX=e.touches[0].clientX; lastY=e.touches[0].clientY;
    }
  }, {passive:true});

  new ResizeObserver(resizeRenderer).observe(document.getElementById('viewer-wrap'));
  animate();
}

function resizeRenderer(){
  const wrap = document.getElementById('viewer-wrap');
  if(!wrap || !renderer) return;
  const w = wrap.clientWidth, h = wrap.clientHeight || 500;
  renderer.setSize(w,h,false);
  camera.aspect = w/h; camera.updateProjectionMatrix();
}

function colorForValue(val, variable, palette){
  const [lo,hi] = RANGES[variable];
  let t = (val-lo)/(hi-lo); t = Math.max(0,Math.min(1,t));
  const stops = PALETTES[palette];
  const idx = t*(stops.length-1);
  const i0 = Math.floor(idx), i1 = Math.min(stops.length-1,i0+1), f = idx-i0;
  const c0 = new THREE.Color(stops[i0]), c1 = new THREE.Color(stops[i1]);
  return c0.lerp(c1, f);
}

function updateField(){
  const geo = fieldMesh.geometry;
  const pos = geo.attributes.position;
  const colors = geo.attributes.color || new THREE.BufferAttribute(new Float32Array(pos.count*3),3);
  const region = state.region, variable = state.variable, depth = state.depth, day = state.dayIdx;
  const exag = [1,1.6,2.4,3.4][state.vexag] || 1;
  for(let i=0;i<pos.count;i++){
    const x = pos.getX(i), z = pos.getZ(i);
    const u = (x/6)+0.5, v = (z/6)+0.5;
    const val = fieldValue(variable, region, u, v, depth, day);
    const c = colorForValue(val, variable, state.palette);
    colors.setXYZ(i, c.r, c.g, c.b);
    // subtle displacement for structure, scaled by exaggeration & depth
    const relief = (seededNoise(u*4,v*4,day*0.1)-0.5) * 0.18 * exag * (1 - depth/1400);
    pos.setY(i, relief);
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', colors);
  geo.computeVertexNormals();
  fieldMesh.material.opacity = state.opacity;
  fieldMesh.visible = state.overlays.model;

  // sink whole group visually to represent depth (camera-side cue)
  fieldMesh.position.y = -Math.min(depth,1000)/1000*1.1;
  markerGroup.position.y = fieldMesh.position.y;

  updateLegend();
}

function updateLegend(){
  const stops = PALETTES[state.palette];
  document.getElementById('legend-bar').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
  const [lo,hi] = RANGES[state.variable];
  document.getElementById('legend-min').textContent = lo;
  document.getElementById('legend-max').textContent = hi;
  document.getElementById('legend-title').textContent = state.variable.toUpperCase()+' ('+UNITS[state.variable]+')';
}

function buildMarkers(){
  markerGroup.clear();
  const inRegionFloats = FLOATS.filter(f=>f.region===state.region);
  inRegionFloats.forEach(f=>{
    if(f.label==='GLIDER' && !state.overlays.glider) return;
    if(f.label!=='GLIDER' && !state.overlays.argo) return;
    const x = (f.u-0.5)*6, z=(f.v-0.5)*6;
    const geo = new THREE.SphereGeometry(0.09,16,16);
    const color = f.anomaly && state.overlays.anomaly ? 0xe6b95c : (f.label==='GLIDER' ? 0x4d8b7c : 0x5be8e0);
    const mat = new THREE.MeshBasicMaterial({color});
    const sph = new THREE.Mesh(geo, mat);
    sph.position.set(x, 0.12, z);
    sph.userData = {floatId:f.id};
    markerGroup.add(sph);
    // vertical stem to indicate depth reach
    const stemGeo = new THREE.CylinderGeometry(0.008,0.008,0.5,6);
    const stem = new THREE.Mesh(stemGeo, new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.5}));
    stem.position.set(x,-0.14,z);
    markerGroup.add(stem);
    if(f.anomaly && state.overlays.anomaly){
      const ringGeo = new THREE.RingGeometry(0.13,0.16,24);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({color:0xe6b95c, side:THREE.DoubleSide, transparent:true, opacity:0.7}));
      ring.rotation.x = -Math.PI/2; ring.position.set(x,0.13,z);
      markerGroup.add(ring);
    }
  });
}

function handleHover(e){
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX-rect.left)/rect.width)*2-1;
  mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(markerGroup.children.filter(c=>c.geometry.type==='SphereGeometry'));
  const tip = document.getElementById('tooltip');
  if(hits.length){
    const f = FLOATS.find(ff=>ff.id===hits[0].object.userData.floatId);
    if(f){
      const surfaceObs = f.profile[0];
      tip.style.display='block';
      tip.style.left = (e.clientX - rect.left + 14)+'px';
      tip.style.top = (e.clientY - rect.top - 10)+'px';
      tip.innerHTML = `<div class="t-title">${f.label} ${f.id}</div>
        <div class="t-row"><span>Location</span><b>${f.lat}°N, ${f.lon}°E</b></div>
        <div class="t-row"><span>Time</span><b>${fmtDateTime(DAYS[state.dayIdx])}</b></div>
        <div class="t-row"><span>Depth</span><b>0 m</b></div>
        <div class="t-row"><span>Temp.</span><b>${surfaceObs.obsT}°C</b></div>`;
      renderer.domElement.style.cursor='pointer';
      return;
    }
  }
  tip.style.display='none';
  renderer.domElement.style.cursor='grab';
}

function handleClick(e){
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX-rect.left)/rect.width)*2-1;
  mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(markerGroup.children.filter(c=>c.geometry.type==='SphereGeometry'));
  if(hits.length){
    selectFloat(hits[0].object.userData.floatId);
  }
}

function animate(){
  requestAnimationFrame(animate);
  camera.position.set(
    Math.sin(rotation.y)*Math.cos(rotation.x)*camDist,
    Math.sin(-rotation.x)*camDist + 2.4,
    Math.cos(rotation.y)*Math.cos(rotation.x)*camDist
  );
  camera.lookAt(0,0,0);
  renderer.render(scene, camera);
}

/* =========================================================================
   ARGO DETAIL PANEL
   ========================================================================= */
let currentTab = 'profile';
let profileChart, modelObsChart;

function selectFloat(id){
  state.selectedFloat = id;
  document.getElementById('argo-empty-state').style.display='none';
  const content = document.getElementById('argo-content');
  content.style.display='block';
  const f = FLOATS.find(x=>x.id===id);
  currentTab='profile';
  renderArgoPanel(f);
  document.getElementById('argo-panel').classList.add('open');
}

function renderArgoPanel(f){
  const content = document.getElementById('argo-content');
  content.innerHTML = `
    <div class="tab-row">
      <button data-tab="profile" class="${currentTab==='profile'?'active':''}" onclick="switchTab('profile')">Argo Profile</button>
      <button data-tab="modelobs" class="${currentTab==='modelobs'?'active':''}" onclick="switchTab('modelobs')">Model vs Obs</button>
      <button data-tab="details" class="${currentTab==='details'?'active':''}" onclick="switchTab('details')">Details</button>
    </div>
    <div id="argo-tab-body"></div>
  `;
  fillTabBody(f);
}

function switchTab(tab){ currentTab = tab; renderArgoPanel(FLOATS.find(x=>x.id===state.selectedFloat)); }

function fillTabBody(f){
  const body = document.getElementById('argo-tab-body');
  if(currentTab==='profile'){
    body.innerHTML = `
      <div class="info-grid">
        <div class="info-cell"><div class="k">FLOAT ID</div><div class="v">${f.id}</div></div>
        <div class="info-cell"><div class="k">TYPE</div><div class="v">${f.label}</div></div>
        <div class="info-cell"><div class="k">LAT / LON</div><div class="v">${f.lat}°N, ${f.lon}°E</div></div>
        <div class="info-cell"><div class="k">TIME</div><div class="v">${fmtDate(DAYS[state.dayIdx])}</div></div>
      </div>
      <div class="chart-box"><canvas id="canvas-profile"></canvas></div>
      <div style="font-size:12.5px;color:var(--mist);">Difference at 50 m: <b class="mono" style="color:var(--tide-bright)">${diffAt(f,50).toFixed(1)}°C</b></div>
      <div class="link-row">
        <button class="link-btn" onclick="openProvenanceFor('${f.id}')">View Full Profile <span>Provenance →</span></button>
        <button class="link-btn" onclick="goTo('compare');document.getElementById('cmp-float').value='${f.id}';renderCompare();">Send to Compare <span>⇄</span></button>
      </div>
    `;
    setTimeout(()=>drawProfileChart(f),10);
  } else if(currentTab==='modelobs'){
    const d = closestDepth(state.depth);
    const row = f.profile.find(p=>p.depth===d);
    const diff = +(row.obsT-row.modelT).toFixed(1);
    body.innerHTML = `
      <div class="info-grid">
        <div class="info-cell"><div class="k">DEPTH</div><div class="v">${d} m</div></div>
        <div class="info-cell"><div class="k">VARIABLE</div><div class="v">Temperature</div></div>
        <div class="info-cell"><div class="k">MODEL</div><div class="v" style="color:var(--tide-bright)">${row.modelT}°C</div></div>
        <div class="info-cell"><div class="k">OBSERVATION</div><div class="v" style="color:var(--coral)">${row.obsT}°C</div></div>
      </div>
      <div class="chart-box"><canvas id="canvas-modelobs"></canvas></div>
      <div style="font-size:12.5px;color:${Math.abs(diff)>2?'var(--danger)':'var(--mist)'};">
        ${Math.abs(diff)>2 ? '⚠ Unusual observation detected — this does not necessarily indicate incorrect data. Review recommended.' : `Difference ${diff>0?'+':''}${diff}°C — within expected range.`}
      </div>
    `;
    setTimeout(()=>drawModelObsChart(f),10);
  } else {
    body.innerHTML = `
      <div class="info-grid">
        <div class="info-cell"><div class="k">INSTRUMENT</div><div class="v">${f.instrument}</div></div>
        <div class="info-cell"><div class="k">DEPTH RANGE</div><div class="v">${f.depthRange}</div></div>
        <div class="info-cell"><div class="k">VARIABLES</div><div class="v">${f.variables.join(', ')}</div></div>
        <div class="info-cell"><div class="k">REGION</div><div class="v">${f.region}</div></div>
      </div>
      <div class="var-pill-row">${f.variables.map(v=>`<span class="chip active">${v}</span>`).join('')}</div>
      <div class="link-row">
        <button class="link-btn" onclick="openQuality()">View Data Quality <span>◎</span></button>
        <button class="link-btn" onclick="openProvenanceFor('${f.id}')">View Data Provenance <span>ⓘ</span></button>
      </div>
    `;
  }
}

function closestDepth(d){
  return DEPTH_LEVELS.reduce((a,b)=>Math.abs(b-d)<Math.abs(a-d)?b:a);
}
function diffAt(f, depth){
  const d = closestDepth(depth);
  const row = f.profile.find(p=>p.depth===d);
  return row.obsT - row.modelT;
}

function drawProfileChart(f){
  const ctx = document.getElementById('canvas-profile');
  if(profileChart) profileChart.destroy();
  profileChart = new Chart(ctx, {
    type:'line',
    data:{ labels:f.profile.map(p=>p.depth),
      datasets:[
        {label:'Model', data:f.profile.map(p=>p.modelT), borderColor:'#5be8e0', backgroundColor:'transparent', tension:0.3},
        {label:'Observation', data:f.profile.map(p=>p.obsT), borderColor:'#e8895b', backgroundColor:'transparent', tension:0.3},
      ]},
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
      scales:{ y:{reverse:true, title:{display:true,text:'Depth (m)',color:'#8aa8b4'}, ticks:{color:'#8aa8b4'}, grid:{color:'rgba(255,255,255,0.06)'}},
               x:{title:{display:true,text:'Temperature (°C)',color:'#8aa8b4'}, ticks:{color:'#8aa8b4'}, grid:{color:'rgba(255,255,255,0.06)'}}},
      plugins:{legend:{labels:{color:'#eaf6f8', font:{size:11}}}}
    }
  });
}
function drawModelObsChart(f){
  const ctx = document.getElementById('canvas-modelobs');
  if(modelObsChart) modelObsChart.destroy();
  modelObsChart = new Chart(ctx, {
    type:'bar',
    data:{ labels:f.profile.map(p=>p.depth+'m'),
      datasets:[
        {label:'Model', data:f.profile.map(p=>p.modelT), backgroundColor:'#5be8e0'},
        {label:'Observation', data:f.profile.map(p=>p.obsT), backgroundColor:'#e8895b'},
      ]},
    options:{ responsive:true, maintainAspectRatio:false,
      scales:{ x:{ticks:{color:'#8aa8b4'}, grid:{display:false}}, y:{ticks:{color:'#8aa8b4'}, grid:{color:'rgba(255,255,255,0.06)'}} },
      plugins:{legend:{labels:{color:'#eaf6f8', font:{size:11}}}}
    }
  });
}

function openArgoList(){
  const body = document.getElementById('argolist-body');
  const list = FLOATS.filter(f=>f.region===state.region);
  body.innerHTML = list.map(f=>`
    <button class="link-btn" onclick="closeModal('modal-argolist');selectFloat('${f.id}')">
      ${f.label} ${f.id} <span style="color:var(--mist)">${f.lat}°N, ${f.lon}°E →</span>
    </button>`).join('');
  document.getElementById('modal-argolist').classList.add('open');
}

/* =========================================================================
   CONTROL PANEL WIRING
   ========================================================================= */
function toggleSwitch(el, key){
  const on = !el.classList.contains('on');
  el.classList.toggle('on', on);
  state.overlays[key] = on;
  buildMarkers(); updateField();
}

function wireControls(){
  document.getElementById('sel-model').addEventListener('change', e=>{ state.model=e.target.value; toast('Model set to '+state.model); });
  document.getElementById('sel-variable').addEventListener('change', e=>{ state.variable=e.target.value; updateField(); });
  document.getElementById('sel-region').addEventListener('change', e=>{
    state.region = e.target.value;
    document.getElementById('badge-region').textContent = state.region;
    buildMarkers(); updateField();
    document.getElementById('argo-empty-state').style.display='block';
    document.getElementById('argo-content').style.display='none';
    state.selectedFloat = null;
  });
  document.getElementById('sel-palette').addEventListener('change', e=>{ state.palette=e.target.value; updateField(); });

  const depthSlider = document.getElementById('depth-slider');
  depthSlider.addEventListener('input', e=>{
    state.depth = +e.target.value;
    document.getElementById('depth-label').textContent = state.depth+' m';
    const ds = depthStatus(state.depth);
    const tag = document.getElementById('depth-status');
    tag.textContent = ds.status; tag.className = 'status-tag '+(ds.status==='EXACT'?'status-exact':'status-interp');
    document.getElementById('depth-interp-note').textContent = ds.note;
    updateField();
  });

  const timeSlider = document.getElementById('time-slider');
  timeSlider.addEventListener('input', e=>{
    state.dayIdx = +e.target.value;
    document.getElementById('time-label').textContent = fmtDate(DAYS[state.dayIdx]);
    updateField();
  });

  document.getElementById('sel-vexag').addEventListener('input', e=>{
    state.vexag = +e.target.value;
    document.getElementById('vexag-val').textContent = [1,2,5,10][state.vexag]+'×';
    updateField();
  });
  document.getElementById('sel-opacity').addEventListener('input', e=>{
    state.opacity = (+e.target.value)/100;
    document.getElementById('opacity-val').textContent = e.target.value+'%';
    updateField();
  });
}

function togglePlay(){
  state.playing = !state.playing;
  const btn = document.getElementById('btn-play');
  if(state.playing){
    btn.textContent='⏸ Pause'; btn.classList.add('play');
    state.playTimer = setInterval(()=>{
      state.dayIdx = (state.dayIdx+1)%DAYS.length;
      document.getElementById('time-slider').value = state.dayIdx;
      document.getElementById('time-label').textContent = fmtDate(DAYS[state.dayIdx]);
      updateField();
    }, 1100);
  } else {
    btn.textContent='▶ Play'; btn.classList.remove('play');
    clearInterval(state.playTimer);
  }
}
function stepTime(dir){
  state.dayIdx = (state.dayIdx+dir+DAYS.length)%DAYS.length;
  document.getElementById('time-slider').value = state.dayIdx;
  document.getElementById('time-label').textContent = fmtDate(DAYS[state.dayIdx]);
  updateField();
}
function resetView(){
  rotation = {x:-0.55,y:0.6}; camDist=7.2;
  state.depth=0; state.dayIdx=0; state.vexag=1; state.opacity=1;
  document.getElementById('depth-slider').value=0;
  document.getElementById('time-slider').value=0;
  document.getElementById('sel-vexag').value=0;
  document.getElementById('sel-opacity').value=100;
  document.getElementById('depth-label').textContent='0 m';
  document.getElementById('time-label').textContent=fmtDate(DAYS[0]);
  document.getElementById('vexag-val').textContent='1×';
  document.getElementById('opacity-val').textContent='100%';
  const tag=document.getElementById('depth-status'); tag.textContent='EXACT'; tag.className='status-tag status-exact';
  document.getElementById('depth-interp-note').textContent='';
  updateField();
  toast('View reset');
}
function setViewMode(mode){
  state.viewMode = mode;
  ['3d','slice','iso'].forEach(m=>document.getElementById('mode-'+m).classList.toggle('active', m===mode));
  if(mode==='slice'){ fieldMesh.material.wireframe = false; state.opacity=0.85; }
  if(mode==='iso'){ fieldMesh.material.wireframe = true; }
  else { fieldMesh.material.wireframe = false; }
  updateField();
  toast(mode==='3d'?'Full 3D field':mode==='slice'?'Slice view at current depth':'Isosurface (wireframe) mode');
}

/* =========================================================================
   COMPARE VIEW
   ========================================================================= */
function populateCompareSelectors(){
  const floatSel = document.getElementById('cmp-float');
  floatSel.innerHTML = FLOATS.map(f=>`<option value="${f.id}">${f.label} ${f.id} — ${f.region}</option>`).join('');
  const depthSel = document.getElementById('cmp-depth');
  depthSel.innerHTML = DEPTH_LEVELS.map(d=>`<option value="${d}">${d} m</option>`).join('');
  depthSel.value = 50;
  floatSel.value = FLOATS.find(f=>f.region==='Arabian Sea').id;
  floatSel.addEventListener('change', renderCompare);
  depthSel.addEventListener('change', renderCompare);
  document.getElementById('cmp-variable').addEventListener('change', renderCompare);
}

function renderCompare(){
  const f = FLOATS.find(x=>x.id===document.getElementById('cmp-float').value) || FLOATS[0];
  const depth = +document.getElementById('cmp-depth').value;
  const variable = document.getElementById('cmp-variable').value;
  const row = f.profile.find(p=>p.depth===depth);
  const modelVal = variable==='Temperature'? row.modelT : row.modelS;
  const obsVal = variable==='Temperature'? row.obsT : row.obsS;
  const diff = +(modelVal-obsVal).toFixed(2);
  const pct = +((diff/obsVal)*100).toFixed(1);
  const unit = variable==='Temperature'?'°C':'PSU';

  // eligibility logic
  const dstat = depthStatus(depth);
  const checks = [
    {ok:true, label:'Same variable'},
    {ok:true, label:'Compatible units ('+unit+')'},
    {ok:true, label:'Spatial proximity (<10 km)'},
    {ok:true, label:'Compatible timestamps'},
    {ok:dstat.status==='EXACT', label: dstat.status==='EXACT' ? 'Compatible depth (exact)' : 'Compatible depth (interpolated)'},
    {ok:true, label:'Observation available'},
    {ok:true, label:'Model data available'},
  ];
  const allOk = checks.every(c=>c.ok);
  const eligibility = allOk ? 'ELIGIBLE' : 'PARTIAL';
  const elig = document.getElementById('eligibility-card');
  elig.innerHTML = `
    <div class="elig-badge ${allOk?'elig-eligible':'elig-partial'}">${allOk?'✓ ELIGIBLE':'◐ PARTIALLY ELIGIBLE'}</div>
    <div style="font-size:13.5px;color:var(--mist);margin-bottom:14px;">${allOk ? 'Model and observation can be compared directly.' : 'Comparison possible with depth interpolation applied — interpret with slightly wider uncertainty.'}</div>
    <div class="check-list">${checks.map(c=>`<div class="check-item ${c.ok?'ok':'warn'}"><b>${c.ok?'✓':'!'}</b>${c.label}</div>`).join('')}</div>
  `;

  const cols = document.getElementById('compare-cols');
  cols.innerHTML = `
    <div class="compare-col"><div class="cl">MODEL (${state.model})</div><div class="cv" style="color:var(--tide-bright)">${modelVal}${unit}</div><div class="swatch" style="background:${colorForValue(modelVal, variable==='Temperature'?'Temperature':'Salinity', state.palette).getStyle()}"></div></div>
    <div class="compare-col"><div class="cl">OBSERVATION (${f.id})</div><div class="cv" style="color:var(--coral)">${obsVal}${unit}</div><div class="swatch" style="background:${colorForValue(obsVal, variable==='Temperature'?'Temperature':'Salinity', state.palette).getStyle()}"></div></div>
    <div class="compare-col ${diff>=0?'diff-pos':'diff-neg'}"><div class="cl">DIFFERENCE</div><div class="cv">${diff>0?'+':''}${diff}${unit}</div><div style="font-size:11.5px;color:var(--mist);margin-top:12px;">${pct>0?'+':''}${pct}% · ${diff>=0?'Model warmer/higher':'Model cooler/lower'}</div></div>
  `;

  const insight = document.getElementById('compare-insight');
  const flag = Math.abs(diff) > (variable==='Temperature'?2:1);
  insight.innerHTML = flag
    ? `⚠ <span>Potential discrepancy detected between model and observation at ${depth} m. Review recommended — this does not necessarily indicate incorrect data.</span>`
    : `✓ <span>Model and observation show close agreement at ${depth} m (difference ${Math.abs(diff)}${unit}).</span>`;
}

/* =========================================================================
   PROVENANCE / QUALITY / ANOMALY / RAPID UNDERSTANDING
   ========================================================================= */
function openProvenance(){ openProvenanceFor(state.selectedFloat || FLOATS.find(f=>f.region===state.region).id); }
function openProvenanceFor(floatId){
  const f = FLOATS.find(x=>x.id===floatId);
  const d = closestDepth(state.depth);
  const row = f.profile.find(p=>p.depth===d);
  const body = document.getElementById('provenance-body');
  body.innerHTML = [
    ['Dataset', state.model],
    ['Variable', state.variable],
    ['Source file (model)', `hycom_${state.region.toLowerCase().replace(/\s+/g,'_')}_${fmtDate(DAYS[state.dayIdx]).replace(/\s+/g,'').toLowerCase()}.nc`],
    ['Source type', 'NetCDF (mock)'],
    ['Observation', `${f.label} ${f.id}`],
    ['Instrument type', f.instrument],
    ['Timestamp', fmtDateTime(DAYS[state.dayIdx])],
    ['Depth requested', state.depth+' m'],
    ['Depth resolved', d+' m ('+depthStatus(state.depth).status+')'],
    ['Original unit', state.variable==='Temperature'?'K (converted)':'raw sensor unit'],
    ['Displayed unit', UNITS[state.variable]],
    ['Processing', 'Converted + '+(depthStatus(state.depth).status==='EXACT'?'no interpolation needed':'depth-interpolated')],
  ].map(([k,v])=>`<div class="prov-row"><span class="pk">${k}</span><span class="pv">${v}</span></div>`).join('');
  document.getElementById('modal-provenance').classList.add('open');
}

function openQuality(){
  const f = FLOATS.find(x=>x.id===(state.selectedFloat||FLOATS.find(ff=>ff.region===state.region).id));
  const d = closestDepth(state.depth);
  const row = f.profile.find(p=>p.depth===d);
  const diff = Math.abs(row.obsT-row.modelT);
  const rows = [
    {label:`Temperature ${row.obsT}°C`, level: diff>3?'bad':diff>1.8?'warn':'good'},
    {label:`Salinity ${row.obsS} PSU`, level:'good'},
    {label:'Coordinates', level: (f.lat>=-90&&f.lat<=90&&f.lon>=-180&&f.lon<=180)?'good':'bad'},
    {label:'Timestamp completeness', level:'good'},
    {label:'Depth coverage (0–1000 m)', level: state.depth>1000?'warn':'good'},
  ];
  const score = Math.max(35, 100 - rows.filter(r=>r.level==='warn').length*10 - rows.filter(r=>r.level==='bad').length*25 - (f.anomaly?8:0));
  const scoreColor = score>=80?'var(--good)':score>=60?'var(--alert)':'var(--danger)';
  const body = document.getElementById('quality-body');
  body.innerHTML = `
    <div class="quality-list">${rows.map(r=>`<div class="quality-row"><span>${r.label}</span><span class="qbadge q${r.level==='good'?'good':r.level==='warn'?'warn':'bad'}">${r.level==='good'?'Good':r.level==='warn'?'Suspicious':'Invalid'}</span></div>`).join('')}</div>
    ${f.anomaly ? `<div class="anomaly-flag">⚠ <div><b>Unusual observation detected</b> near 50 m depth (≈4°C above nearby readings). This does not necessarily indicate incorrect data — review recommended.</div></div>` : ''}
    <div class="qscore">
      <div class="qscore-ring" style="background:conic-gradient(${scoreColor} ${score*3.6}deg, rgba(255,255,255,0.08) 0deg); position:relative;">
        <div style="position:absolute;inset:6px;border-radius:50%;background:#0c202c;display:flex;align-items:center;justify-content:center;color:${scoreColor};font-size:15px;">${score}</div>
      </div>
      <div style="font-size:13px;color:var(--mist);">Data Quality Score<br><span style="color:var(--foam);font-size:13.5px;">${score} / 100</span> — based on value range, coordinate validity, timestamp completeness and depth coverage.</div>
    </div>
  `;
  document.getElementById('modal-quality').classList.add('open');
}

function openRapidUnderstanding(){
  const f = state.selectedFloat ? FLOATS.find(x=>x.id===state.selectedFloat) : FLOATS.find(ff=>ff.region===state.region);
  const d = closestDepth(state.depth);
  const row = f.profile.find(p=>p.depth===d);
  const diff = +(row.modelT-row.obsT).toFixed(1);
  const dstat = depthStatus(state.depth);
  const eligible = dstat.status==='EXACT' ? 'Eligible' : 'Partially eligible (depth interpolated)';
  const qualityGood = Math.abs(diff) < 2;
  const anomaly = f.anomaly && d===50;
  const body = document.getElementById('rapid-body');
  body.innerHTML = `
    <div class="rapid-block"><div class="rl">CONTEXT</div>
      <div class="info-grid">
        <div class="info-cell"><div class="k">REGION</div><div class="v">${state.region}</div></div>
        <div class="info-cell"><div class="k">VARIABLE</div><div class="v">${state.variable}</div></div>
        <div class="info-cell"><div class="k">DEPTH</div><div class="v">${d} m</div></div>
        <div class="info-cell"><div class="k">TIME</div><div class="v">${fmtDate(DAYS[state.dayIdx])}</div></div>
      </div>
    </div>
    <div class="rapid-block"><div class="rl">KEY OBSERVATIONS</div>
      <ul class="rapid-obs">
        <li>${state.model} predicts ${row.modelT}°C at this depth</li>
        <li>${f.label} ${f.id} observed ${row.obsT}°C</li>
        <li>Difference: ${diff>0?'+':''}${diff}°C</li>
        <li>Data quality: ${qualityGood?'Good':'Suspicious value flagged'}</li>
        <li>Comparison: ${eligible}</li>
        <li>${anomaly ? 'A nearby anomaly was flagged — review recommended' : 'No major anomaly detected'}</li>
      </ul>
    </div>
    <div class="rapid-conclusion">
      ${Math.abs(diff)<1
        ? '<b>Model and observation show close agreement</b> at this location — the field appears to represent local conditions well.'
        : Math.abs(diff)<2.5
        ? '<b>Model and observation show a modest gap</b> at this location. This is within a plausible range but worth a closer look in Compare mode.'
        : '<b>Model and observation diverge noticeably</b> at this location. This is an explanatory summary, not a verified scientific conclusion — review the underlying data before drawing conclusions.'}
    </div>
  `;
  document.getElementById('modal-rapid').classList.add('open');
}

/* =========================================================================
   EXPORT
   ========================================================================= */
function openExport(){ document.getElementById('modal-export').classList.add('open'); }
function download(filename, content, mime){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}
function exportCSV(){
  const f = FLOATS.find(x=>x.id===(state.selectedFloat||FLOATS.find(ff=>ff.region===state.region).id));
  let csv = 'depth_m,model_temp_c,obs_temp_c,diff_c,model_sal_psu,obs_sal_psu\n';
  f.profile.forEach(p=>{ csv += `${p.depth},${p.modelT},${p.obsT},${(p.modelT-p.obsT).toFixed(2)},${p.modelS},${p.obsS}\n`; });
  download(`oceanscope_${f.id}_${state.region.replace(/\s+/g,'_')}.csv`, csv, 'text/csv');
  closeModal('modal-export'); toast('✓ Export complete — CSV downloaded');
}
function exportJSON(){
  const f = FLOATS.find(x=>x.id===(state.selectedFloat||FLOATS.find(ff=>ff.region===state.region).id));
  const payload = {
    dataset: state.model, variable: state.variable, region: state.region,
    depth_requested_m: state.depth, depth_status: depthStatus(state.depth).status,
    time: fmtDateTime(DAYS[state.dayIdx]),
    observation: f, provenance: { source:'mock', processing:'converted + interpolated where needed' }
  };
  download(`oceanscope_${f.id}_metadata.json`, JSON.stringify(payload,null,2), 'application/json');
  closeModal('modal-export'); toast('✓ Export complete — JSON downloaded');
}
function exportPNG(){
  if(!renderer){ toast('Open Explore first'); return; }
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a'); a.href=url; a.download='oceanscope_view.png'; a.click();
  closeModal('modal-export'); toast('✓ Export complete — PNG downloaded');
}

/* =========================================================================
   ANALYSIS CHARTS
   ========================================================================= */
let charts = {};
function populateAnalysisSelectors(){
  const floatSel = document.getElementById('an-float');
  const daySel = document.getElementById('an-day');
  daySel.innerHTML = DAYS.map((d,i)=>`<option value="${i}">${fmtDate(d)}</option>`).join('');
  function refreshFloats(){
    const region = document.getElementById('an-region').value;
    floatSel.innerHTML = FLOATS.filter(f=>f.region===region).map(f=>`<option value="${f.id}">${f.label} ${f.id}</option>`).join('');
  }
  document.getElementById('an-region').addEventListener('change', ()=>{refreshFloats(); renderAnalysisCharts();});
  refreshFloats();
}
function mkChart(id, config){
  if(charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}
const chartColors = ['#5be8e0','#e8895b','#e6b95c','#4d8b7c'];
function baseOpts(extra={}){
  return Object.assign({
    responsive:true, maintainAspectRatio:false,
    scales:{ x:{ticks:{color:'#8aa8b4', font:{size:10.5}}, grid:{color:'rgba(255,255,255,0.05)'}},
             y:{ticks:{color:'#8aa8b4', font:{size:10.5}}, grid:{color:'rgba(255,255,255,0.05)'}} },
    plugins:{legend:{labels:{color:'#eaf6f8', font:{size:11}}}}
  }, extra);
}
function renderAnalysisCharts(){
  const region = document.getElementById('an-region').value;
  const floatId = document.getElementById('an-float').value;
  const f = FLOATS.find(x=>x.id===floatId) || FLOATS.find(x=>x.region===region);
  if(!f) return;

  mkChart('chart-temp-depth', {type:'line', data:{labels:f.profile.map(p=>p.depth), datasets:[
    {label:'Model', data:f.profile.map(p=>p.modelT), borderColor:chartColors[0], tension:0.3},
    {label:'Observation', data:f.profile.map(p=>p.obsT), borderColor:chartColors[1], tension:0.3},
  ]}, options: baseOpts({scales:{x:{title:{display:true,text:'Depth (m)',color:'#8aa8b4'},ticks:{color:'#8aa8b4'},grid:{color:'rgba(255,255,255,0.05)'}}, y:{title:{display:true,text:'°C',color:'#8aa8b4'},ticks:{color:'#8aa8b4'},grid:{color:'rgba(255,255,255,0.05)'}}}})});

  mkChart('chart-sal-depth', {type:'line', data:{labels:f.profile.map(p=>p.depth), datasets:[
    {label:'Model', data:f.profile.map(p=>p.modelS), borderColor:chartColors[0], tension:0.3},
    {label:'Observation', data:f.profile.map(p=>p.obsS), borderColor:chartColors[1], tension:0.3},
  ]}, options: baseOpts({scales:{x:{title:{display:true,text:'Depth (m)',color:'#8aa8b4'},ticks:{color:'#8aa8b4'},grid:{color:'rgba(255,255,255,0.05)'}}, y:{title:{display:true,text:'PSU',color:'#8aa8b4'},ticks:{color:'#8aa8b4'},grid:{color:'rgba(255,255,255,0.05)'}}}})});

  mkChart('chart-model-obs', {type:'bar', data:{labels:f.profile.map(p=>p.depth+'m'), datasets:[
    {label:'Model', data:f.profile.map(p=>p.modelT), backgroundColor:chartColors[0]},
    {label:'Observation', data:f.profile.map(p=>p.obsT), backgroundColor:chartColors[1]},
  ]}, options: baseOpts()});

  mkChart('chart-diff-depth', {type:'bar', data:{labels:f.profile.map(p=>p.depth+'m'), datasets:[
    {label:'Model − Observation (°C)', data:f.profile.map(p=>+(p.modelT-p.obsT).toFixed(2)), backgroundColor:f.profile.map(p=>(p.modelT-p.obsT)>=0?chartColors[2]:chartColors[3])},
  ]}, options: baseOpts()});

  // variable vs time at 50m across days (simulate small day-to-day drift)
  const timeSeries = DAYS.map((d,i)=>{
    const val = fieldValue('Temperature', f.region, f.u, f.v, 50, i);
    const obs = val + (seededNoise(f.u,f.v,i)-0.5)*0.6;
    return {model:+val.toFixed(2), obs:+obs.toFixed(2)};
  });
  mkChart('chart-var-time', {type:'line', data:{labels:DAYS.map(fmtDate), datasets:[
    {label:'Model', data:timeSeries.map(t=>t.model), borderColor:chartColors[0], tension:0.3},
    {label:'Observation', data:timeSeries.map(t=>t.obs), borderColor:chartColors[1], tension:0.3},
  ]}, options: baseOpts()});
}

/* =========================================================================
   INIT
   ========================================================================= */
window.addEventListener('DOMContentLoaded', ()=>{
  wireControls();
  populateCompareSelectors();
  populateAnalysisSelectors();
  initViewer();
});