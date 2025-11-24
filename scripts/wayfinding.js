// scripts/wayfinding.js
import { populateUiAndReturnPois } from './app.js';
import { requestOrientationPermissionIfNeeded, installDeviceOrientationListener, getCurrentHeading } from './orientation.js';

// --- GEODESY helpers (sin cambios)
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

// Tunables (ajustables)
const ORIGIN_ACCEPT_RADIUS_M = 12;
const GUIDE_AHEAD_METERS = 6;
let ARRIVAL_DISTANCE_METERS = 4; // valor base, se adaptará con accuracy
const MIN_MOVEMENT = 1.5; // metros mínimo para contar movimiento
const MAX_ACCEPTABLE_ACCURACY = 40; // descarta lecturas > esto (puedes subir si quieres)

// ══════════════════════════════════════════════════════════════
// TRACKING DE NAVEGACIÓN (NUEVO)
let navigationStartTime = null;
let navigationStartPosition = null;
let totalDistanceTraveled = 0;
let lastPosition = null;

function startNavigationTracking(userLat, userLon) {
  navigationStartTime = Date.now();
  navigationStartPosition = { lat: userLat, lon: userLon };
  lastPosition = { lat: userLat, lon: userLon };
  totalDistanceTraveled = 0;
  console.log('📍 Tracking iniciado:', { poi: currentDestination?.name, start: navigationStartPosition });
}

function updateNavigationDistance(userLat, userLon) {
  if (lastPosition) {
    const segmentDist = distanceMeters(lastPosition.lat, lastPosition.lon, userLat, userLon);
    if (segmentDist >= MIN_MOVEMENT) {
      totalDistanceTraveled += segmentDist;
    } // si es menor que MIN_MOVEMENT -> se considera ruido y se ignora
  }
  lastPosition = { lat: userLat, lon: userLon };
}

async function completeNavigationTracking(arrived = true) {
  if (!navigationStartTime || !navigationStartPosition) return;

  const durationSeconds = Math.floor((Date.now() - navigationStartTime) / 1000);

  if (window.arAPI && window.arAPI.hasActiveSession()) {
    await window.arAPI.registerNavigation(currentDestination.id, {
      originLat: navigationStartPosition.lat,
      originLon: navigationStartPosition.lon,
      duration: durationSeconds,
      distance: Math.round(totalDistanceTraveled),
      completed: arrived
    });

    console.log('✅ Navegación registrada:', {
      poi: currentDestination.name,
      duration: durationSeconds + 's',
      distance: Math.round(totalDistanceTraveled) + 'm',
      completed: arrived
    });
  }

  navigationStartTime = null;
  navigationStartPosition = null;
  totalDistanceTraveled = 0;
  lastPosition = null;
}
// ══════════════════════════════════════════════════════════════


// --- KALMAN 1D (muy ligero) - para lat y lon por separado
class SimpleKalman {
  // x: estado (posición), P: varianza estado
  // Q: process noise (variabilidad del sistema), inicializable
  constructor({ initial = 0, initialP = 10, Q = 1 }) {
    this.x = initial;
    this.P = initialP;
    this.Q = Q;
  }

  // z: medida (posición), R: varianza medida (accuracy^2)
  update(z, R) {
    // Predict
    this.P = this.P + this.Q;

    // Kalman gain
    const K = this.P / (this.P + R);

    // Update estimate
    this.x = this.x + K * (z - this.x);
    this.P = (1 - K) * this.P;

    return this.x;
  }

  setState(x, P = null) {
    this.x = x;
    if (P !== null) this.P = P;
  }
}

// filtros (inicializados en startGuidance)
let kfLat = null;
let kfLon = null;
let headingSmooth = null;

// DOM refs
const infoDiv = () => document.getElementById('info');
const arrowEl = () => document.getElementById('arrow');
const calibrateBtn = () => document.getElementById('calibrateBtn');
const startBtn = () => document.getElementById('startBtn');
const stopBtn = () => document.getElementById('stopBtn');

// Read params from URL (sin cambios)
function readParams() {
  const p = new URLSearchParams(window.location.search);
  const dest = p.has('dest') ? parseInt(p.get('dest')) : null;
  const origin = p.has('origin') ? (()=> {
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
    pois = await populateUiAndReturnPoisForAR();
  } catch(e) {
    console.error('No se pudieron cargar POIs', e);
    infoDiv().textContent = 'Error cargando POIs.';
    return;
  }

  const params = readParams();
  if (params.origin) {
    ENTRY_ORIGIN.lat = params.origin.lat;
    ENTRY_ORIGIN.lon = params.origin.lon;
    console.log('ENTRY_ORIGIN from URL', ENTRY_ORIGIN);
  }

  calibrateBtn().addEventListener('click', async ()=> {
    const ok = await requestOrientationPermissionIfNeeded();
    if (!ok) alert('No se concedió permiso de orientación.');
    installDeviceOrientationListener();
    alert('Gira 360° lentamente con el teléfono para calibrar brújula.');
  });

  startBtn().addEventListener('click', ensureAtOriginThenStart);
  stopBtn().addEventListener('click', stopGuidance);

  if (params.dest != null) {
    currentDestination = pois.find(p => p.id === params.dest);
    if (currentDestination) {
      document.getElementById('uiDestName').textContent = currentDestination.name;
      setTimeout(()=> handleAutoStartIfRequested(), 300);
    }
  }
})();

// --- Auto-start logic (sin cambios mayormente)
async function handleAutoStartIfRequested(){
  if (!currentDestination) return;
  if (ENTRY_ORIGIN.lat === null) {
    if (confirm('Iniciar guía hacia ' + currentDestination.name + '?')) ensureAtOriginThenStart();
    return;
  }
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

// --- Start / Stop guidance (integración Kalman y filtros)
function startGuidance() {
  if (!currentDestination) {
    const name = document.getElementById('uiDestName').textContent;
    currentDestination = pois.find(p => p.name === name);
  }
  if (!currentDestination) return alert('Destino no seleccionado.');

  infoDiv().textContent = `Destino: ${currentDestination.name}`;

  if (watchId) navigator.geolocation.clearWatch(watchId);

  // inicializar filtros (se actualizarán en la primera lectura real)
  kfLat = null;
  kfLon = null;
  headingSmooth = null;
  let isFirstPosition = true;

  watchId = navigator.geolocation.watchPosition(pos => {
    const rawLat = pos.coords.latitude;
    const rawLon = pos.coords.longitude;
    const accuracy = pos.coords.accuracy || 100;

    // Mostrar precisión en UI (debug)
    // (la actualización visual real la hace updateGuidance)
    // Ignorar lecturas con accuracy excesivo
    if (accuracy > MAX_ACCEPTABLE_ACCURACY) {
      infoDiv().textContent = `Lectura GPS muy imprecisa (±${Math.round(accuracy)} m). Intentando mejorar...`;
      return;
    }

    // Inicializar Kalman con la primera lectura
    if (!kfLat) {
      kfLat = new SimpleKalman({ initial: rawLat, initialP: accuracy*accuracy, Q: 1e-7 });
      kfLon = new SimpleKalman({ initial: rawLon, initialP: accuracy*accuracy, Q: 1e-7 });
      headingSmooth = null;
    }

    // R (varianza medida) tomada de la accuracy
    const R = Math.max(1, accuracy * accuracy);

    // actualizar Kalman (1D por componente)
    const filtLat = kfLat.update(rawLat, R);
    const filtLon = kfLon.update(rawLon, R);

    // Suavizar heading (brújula) con exponencial simple
    const rawHeading = getCurrentHeading(); // puede ser null
    if (rawHeading !== null) {
      if (headingSmooth === null) headingSmooth = rawHeading;
      else {
        const alpha = 0.3; // suavizado, 0..1 (sube si quieres menos lag)
        // manejo circular teclado (360->0)
        const diff = angleDiffSigned(rawHeading, headingSmooth);
        headingSmooth = normalizeAngle(headingSmooth + alpha * diff);
      }
    }

    // ARRIVAL adaptativo: si la precision es mala, aumenta el radio de llegada
    const adaptiveArrival = Math.max(ARRIVAL_DISTANCE_METERS, Math.round(accuracy * 0.6));

    // Si primera posición -> iniciar tracking
    if (isFirstPosition) {
      startNavigationTracking(filtLat, filtLon);
      isFirstPosition = false;
    } else {
      updateNavigationDistance(filtLat, filtLon);
    }

    // Llama a updateGuidance pasando accuracy y heading suavizado
    updateGuidance(filtLat, filtLon, { accuracy, heading: headingSmooth, adaptiveArrival });
  }, err => {
    console.error('geo error', err);
    infoDiv().textContent = 'Error de geolocalización: ' + (err.message || err);
  }, { enableHighAccuracy:true, maximumAge:1000, timeout:7000 });

  startBtn().style.display = 'none';
  stopBtn().style.display = 'inline-block';
  arrowEl().setAttribute('visible','true');
}

function stopGuidance(){
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  if (navigationStartTime) {
    completeNavigationTracking(false);
  }

  infoDiv().textContent = 'Guía detenida.';
  startBtn().style.display = 'inline-block';
  stopBtn().style.display = 'none';
  arrowEl().setAttribute('visible','false');
}

// --- updateGuidance: ahora acepta opciones con accuracy, heading y adaptiveArrival
function updateGuidance(userLat, userLon, opts = {}) {
  const destLat = currentDestination.lat, destLon = currentDestination.lon;
  const dist = distanceMeters(userLat, userLon, destLat, destLon);
  const bear = bearingDegrees(userLat, userLon, destLat, destLon);

  const accuracy = opts.accuracy || 0;
  const heading = (opts.heading === undefined ? null : opts.heading);
  const adaptiveArrival = opts.adaptiveArrival || ARRIVAL_DISTANCE_METERS;

  infoDiv().innerHTML = `Destino: <b>${currentDestination.name}</b><br>
    Distancia: ${Math.round(dist)} m<br>
    Rumbo: ${Math.round(bear)}°<br>
    Precisión GPS: ±${Math.round(accuracy)} m<br>
    Umbral llegada: ${adaptiveArrival} m`;

  // llegada con umbral adaptativo
  if (dist <= adaptiveArrival) {
    infoDiv().innerHTML += '<br><b>Has llegado 🎉</b>';
    completeNavigationTracking(true);
    stopGuidance();
    return;
  }

  // punto algunos metros adelante para colocar la flecha (igual que antes)
  const targetPt = destPoint(userLat, userLon, bear, GUIDE_AHEAD_METERS);

  const arrow = arrowEl();
  arrow.setAttribute('gps-entity-place', `latitude: ${targetPt.lat}; longitude: ${targetPt.lon};`);

  // computar yaw con heading suavizado si disponible
  let yaw;
  if (heading !== null) {
    const diff = angleDiffSigned(bear, heading);
    yaw = -diff;
  } else {
    yaw = (bear + 180) % 360;
  }
  arrow.setAttribute('rotation', `0 ${yaw} 0`);

  // escala visual
  const scale = Math.min(3, Math.max(0.8, dist / 30));
  arrow.setAttribute('scale', `${scale} ${scale} ${scale}`);
}
