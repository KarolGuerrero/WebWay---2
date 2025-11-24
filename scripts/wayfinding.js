// scripts/wayfinding.js
import { populateUiAndReturnPois } from './app.js';
import { requestOrientationPermissionIfNeeded, installDeviceOrientationListener, getCurrentHeading } from './orientation.js';


// --- GEODESY helpers
const toRad = d => d * Math.PI/180;
const toDeg = r => r * 180/Math.PI;
function normalizeAngle(a){ return ((a%360)+360)%360; }
function angleDiffSigned(a,b){ let d = normalizeAngle(a)-normalizeAngle(b); if (d>180) d-=360; if (d<-180) d+=360; return d; }

function distanceMeters(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const Δφ = toRad(lat2-lat1), Δλ = toRad(lon2-lon1);
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
function bearingDegrees(lat1, lon1, lat2, lon2){
  const φ1 = toRad(lat1), φ2 = toRad(lat2);
  const λ1 = toRad(lon1), λ2 = toRad(lon2);
  const y = Math.sin(λ2-λ1)*Math.cos(φ2);
  const x = Math.cos(φ1)*Math.sin(φ2) - Math.sin(φ1)*Math.cos(φ2)*Math.cos(λ2-λ1);
  return normalizeAngle(toDeg(Math.atan2(y,x)));
}
function destPoint(lat, lon, bearingDeg, distanceMeters){
  const R = 6371000;
  const δ = distanceMeters / R;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const φ2 = Math.asin(Math.sin(φ1)*Math.cos(δ) + Math.cos(φ1)*Math.sin(δ)*Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ)*Math.sin(δ)*Math.cos(φ1), Math.cos(δ)-Math.sin(φ1)*Math.sin(φ2));
  return { lat: toDeg(φ2), lon: (toDeg(λ2)+540)%360 - 180 };
}

// --- State
let pois = [];
let currentDestination = null;
let ENTRY_ORIGIN = { lat: null, lon: null };
let watchId = null;
const ORIGIN_ACCEPT_RADIUS_M = 12;
const GUIDE_AHEAD_METERS = 6;
const ARRIVAL_DISTANCE_METERS = 4;

// DOM refs
const infoDiv = () => document.getElementById('info');
const arrowEl = () => document.getElementById('arrow');
const calibrateBtn = () => document.getElementById('calibrateBtn');
const startBtn = () => document.getElementById('startBtn');
const stopBtn = () => document.getElementById('stopBtn');

// Read params from URL
function readParams() {
  const p = new URLSearchParams(window.location.search);
  const dest = p.has('dest') ? parseInt(p.get('dest')) : null;
  const origin = p.has('origin') ? (()=>{
    const raw = p.get('origin').split(',').map(s=>s.trim());
    const lat = parseFloat(raw[0]), lon = parseFloat(raw[1]);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    return null;
  })() : null;
  return { dest, origin };
}

// init
(async function init(){
  try {
    pois = await populateUiAndReturnPoisForAR(); // loads pois & updates UI name if dest param present
  } catch(e) {
    console.error('No se pudieron cargar POIs', e);
    infoDiv().textContent = 'Error cargando POIs.';
    return;
  }

  // set entry origin if passed in URL (helps demo autocalibrate)
  const params = readParams();
  if (params.origin) {
    ENTRY_ORIGIN.lat = params.origin.lat;
    ENTRY_ORIGIN.lon = params.origin.lon;
    console.log('ENTRY_ORIGIN from URL', ENTRY_ORIGIN);
  }

  // Wire buttons
  calibrateBtn().addEventListener('click', async ()=> {
    const ok = await requestOrientationPermissionIfNeeded();
    if (!ok) alert('No se concedió permiso de orientación.');
    installDeviceOrientationListener();
    alert('Gira 360° lentamente con el teléfono para calibrar brújula.');
  });

  startBtn().addEventListener('click', ensureAtOriginThenStart);
  stopBtn().addEventListener('click', stopGuidance);

  // If dest param present, auto-select and attempt to start (demo mode)
  if (params.dest != null) {
    currentDestination = pois.find(p => p.id === params.dest);
    if (currentDestination) {
      document.getElementById('uiDestName').textContent = currentDestination.name;
      // try to auto-start: if origin provided, check distance else prompt
      setTimeout(()=> handleAutoStartIfRequested(), 300);
    }
  }
})();

// --- Auto-start logic
async function handleAutoStartIfRequested(){
  if (!currentDestination) return;
  if (ENTRY_ORIGIN.lat === null) {
    // no origin param, just prompt user to calibrate and start
    if (confirm('Iniciar guía hacia ' + currentDestination.name + '?')) ensureAtOriginThenStart();
    return;
  }
  // try to get current pos and compare distance to entry origin
  if (!('geolocation' in navigator)) {
    if (confirm('No hay geolocalización. Iniciar demo de todas formas?')) startGuidance();
    return;
  }
  try {
    const pos = await new Promise((res,rej)=> navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy:true, timeout:7000 }));
    const d = distanceMeters(pos.coords.latitude, pos.coords.longitude, ENTRY_ORIGIN.lat, ENTRY_ORIGIN.lon);
    if (d <= ORIGIN_ACCEPT_RADIUS_M) {
      startGuidance();
    } else {
      if (confirm(`Estás a ~${Math.round(d)} m del origin. ¿Calibrar aquí y empezar?`)) {
        ENTRY_ORIGIN.lat = pos.coords.latitude; ENTRY_ORIGIN.lon = pos.coords.longitude;
        startGuidance();
      } else {
        if (confirm('¿Iniciar guía de todas formas (demo)?')) startGuidance();
      }
    }
  } catch(e) {
    console.warn('No se pudo leer posición para autostart:', e);
    if (confirm('No se pudo obtener ubicación. Iniciar demo de todas formas?')) startGuidance();
  }
}

// --- Ensure at origin
function ensureAtOriginThenStart() {
  if (!currentDestination) {
    alert('Selecciona un destino');
    return;
  }
  if (!('geolocation' in navigator)) return alert('Geolocalización no soportada.');

  navigator.geolocation.getCurrentPosition(pos => {
    const d = distanceMeters(pos.coords.latitude, pos.coords.longitude, ENTRY_ORIGIN.lat || pos.coords.latitude, ENTRY_ORIGIN.lon || pos.coords.longitude);
    if (d <= ORIGIN_ACCEPT_RADIUS_M) {
      startGuidance();
    } else {
      if (confirm(`No estás cerca del origin (~${Math.round(d)} m). ¿Calibrar aquí y continuar?`)) {
        ENTRY_ORIGIN.lat = pos.coords.latitude; ENTRY_ORIGIN.lon = pos.coords.longitude;
        startGuidance();
      } else {
        if (confirm('¿Iniciar guía aunque estés lejos?')) startGuidance();
      }
    }
  }, err => {
    alert('No se pudo obtener ubicación: ' + (err.message || err));
  }, { enableHighAccuracy:true, timeout:7000 });
}

// --- Start / Stop guidance
function startGuidance() {
  if (!currentDestination) {
    // if dest not set via param, try to read from UI name
    const name = document.getElementById('uiDestName').textContent;
    currentDestination = pois.find(p => p.name === name);
  }
  if (!currentDestination) return alert('Destino no seleccionado.');

  infoDiv().textContent = `Destino: ${currentDestination.name}`;

  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(pos => {
    const userLat = pos.coords.latitude, userLon = pos.coords.longitude;
    updateGuidance(userLat, userLon);
  }, err => {
    console.error('geo error', err);
    infoDiv().textContent = 'Error de geolocalización: ' + (err.message || err);
  }, { enableHighAccuracy:true, maximumAge:1000, timeout:7000 });

  startBtn().style.display = 'none';
  stopBtn().style.display = 'inline-block';
  arrowEl().setAttribute('visible','true');
}

function stopGuidance(){
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  infoDiv().textContent = 'Guía detenida.';
  startBtn().style.display = 'inline-block';
  stopBtn().style.display = 'none';
  arrowEl().setAttribute('visible','false');
}

// --- updateGuidance: compute dist, bearing, arrow placement + rotation based on device heading
function updateGuidance(userLat, userLon) {
  const destLat = currentDestination.lat, destLon = currentDestination.lon;
  const dist = distanceMeters(userLat, userLon, destLat, destLon);
  const bear = bearingDegrees(userLat, userLon, destLat, destLon);
  infoDiv().innerHTML = `Destino: <b>${currentDestination.name}</b><br>Distancia: ${Math.round(dist)} m<br>Rumbo: ${Math.round(bear)}°`;

  if (dist <= ARRIVAL_DISTANCE_METERS) {
    infoDiv().innerHTML += '<br><b>Has llegado 🎉</b>';
    stopGuidance();
    return;
  }

  // compute point a few meters ahead in direction (to place arrow)
  const targetPt = destPoint(userLat, userLon, bear, GUIDE_AHEAD_METERS);

  // position arrow using gps-entity-place semantics
  const arrow = arrowEl();
  arrow.setAttribute('gps-entity-place', `latitude: ${targetPt.lat}; longitude: ${targetPt.lon};`);

  // rotate arrow so it visually points towards destination taking device heading into account
  const heading = getCurrentHeading(); // from orientation module; may be null
  let yaw;
  if (heading !== null) {
    const diff = angleDiffSigned(bear, heading); // -180..180
    yaw = -diff; // sign may be flipped depending on model; adjust if points opposite
  } else {
    // fallback: set arrow yaw to face bearing (relative to world north); this may appear rotated if device heading unknown
    yaw = (bear + 180) % 360;
  }
  arrow.setAttribute('rotation', `0 ${yaw} 0`);

  // scale arrow by distance (visual)
  const scale = Math.min(3, Math.max(0.8, dist / 30));
  arrow.setAttribute('scale', `${scale} ${scale} ${scale}`);
}
