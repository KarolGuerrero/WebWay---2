// scripts/orientation.js
export let deviceHeadingAvailable = false;
export let smoothedHeading = null;
const HEADING_SMOOTHING = 0.12;

function toDeg(r){ return r * 180 / Math.PI; }
function normalizeAngle(a){ return ((a % 360) + 360) % 360; }
function angleDiffSigned(a,b){
  let d = normalizeAngle(a) - normalizeAngle(b);
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export async function requestOrientationPermissionIfNeeded() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const r = await DeviceOrientationEvent.requestPermission();
      return r === 'granted';
    } catch(e) {
      console.warn('requestPermission failed', e);
      return false;
    }
  }
  return true;
}

export function installDeviceOrientationListener() {
  function onOrient(e) {
    let heading = null;
    if (typeof e.webkitCompassHeading !== 'undefined' && e.webkitCompassHeading !== null) {
      // iOS
      heading = e.webkitCompassHeading;
    } else if (typeof e.alpha === 'number') {
      // Android: alpha relative to device frame; we convert to rough heading
      // account for screen orientation
      const screenAngle = (screen.orientation && screen.orientation.angle) ? screen.orientation.angle : (window.orientation || 0);
      heading = e.alpha - screenAngle;
      heading = normalizeAngle(heading);
    } else {
      return; // no sensor
    }

    deviceHeadingAvailable = true;
    if (smoothedHeading === null) smoothedHeading = heading;
    else {
      const d = angleDiffSigned(heading, smoothedHeading);
      smoothedHeading = normalizeAngle(smoothedHeading + HEADING_SMOOTHING * d);
    }
  }

  window.addEventListener('deviceorientation', onOrient, true);
}

// exported helper: returns current heading in degrees (0..360) or null
export function getCurrentHeading() {
  return deviceHeadingAvailable ? smoothedHeading : null;
}