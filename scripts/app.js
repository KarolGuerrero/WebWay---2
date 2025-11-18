// scripts/app.js
export async function loadPois() {
  const res = await fetch('/data/pois.json');
  if (!res.ok) throw new Error('No se pudo cargar pois.json: ' + res.status);
  const pois = await res.json();
  return pois;
}

export function populateDestSelectInIndex(pois, selectEl) {
  selectEl.innerHTML = '<option value="">-- seleccionar --</option>';
  pois.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    selectEl.appendChild(opt);
  });
}

export async function populateUiAndReturnPoisForAR() {
  // When loaded in ar.html, fill UI fields and return pois
  const pois = await loadPois();
  // Update UI if present
  const destNameEl = document.getElementById('uiDestName');
  const params = new URLSearchParams(window.location.search);
  const destId = params.has('dest') ? parseInt(params.get('dest')) : null;
  if (destId !== null) {
    const p = pois.find(x => x.id === destId);
    if (p && destNameEl) destNameEl.textContent = p.name;
  }
  return pois;
}