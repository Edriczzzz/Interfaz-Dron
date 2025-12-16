// -----------------------------
// Socket.IO
// -----------------------------
const socket = io();
const connStatus = document.getElementById("connStatus");

socket.on("connect", () => {
  connStatus.textContent = "✅ Conectado al backend";
});

socket.on("disconnect", () => {
  connStatus.textContent = "❌ Desconectado";
});

// -----------------------------
// Leaflet Map
// -----------------------------
const map = L.map("map").setView([19.4326, -99.1332], 15);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

// “Dron” como cuadro (divIcon)
const droneIcon = L.divIcon({
  className: "drone-icon",
  html: `<div style="width:16px;height:16px;background:#00d1ff;border-radius:4px;border:2px solid #001a22"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

let droneMarker = L.marker([19.4326, -99.1332], { icon: droneIcon }).addTo(map);
let trail = L.polyline([], { weight: 3, opacity: 0.8 }).addTo(map);
let trailPoints = [];

document.getElementById("gotoBtn").addEventListener("click", () => {
  const lat = parseFloat(document.getElementById("latInput").value);
  const lon = parseFloat(document.getElementById("lonInput").value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  map.setView([lat, lon], 17);
});

// -----------------------------
// UI Telemetry
// -----------------------------
function setText(id, val) {
  document.getElementById(id).textContent = val;
}

socket.on("telemetry", (t) => {
  setText("mode", t.mode ?? "—");
  setText("armed", t.armed ? "Sí" : "No");
  setText("battery", (t.battery ?? "—") + " %");
  setText("lat", (t.lat ?? 0).toFixed(7));
  setText("lon", (t.lon ?? 0).toFixed(7));
  setText("alt", (t.alt ?? 0).toFixed(1));
  setText("gs", (t.groundspeed ?? 0).toFixed(1));
  setText("fix", t.fix_type ?? "—");
  setText("sats", t.satellites ?? "—");

  const lat = t.lat, lon = t.lon;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    droneMarker.setLatLng([lat, lon]);

    // trail (últimos 150 puntos)
    trailPoints.push([lat, lon]);
    if (trailPoints.length > 150) trailPoints.shift();
    trail.setLatLngs(trailPoints);
  }
});

// -----------------------------
// Commands: Flight Modes
// -----------------------------
async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

document.querySelectorAll(".modeBtn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const mode = btn.dataset.mode;
    const r = await postJSON("/api/command/mode", { mode });
    connStatus.textContent = r.ok ? `✅ Modo -> ${mode}` : `⚠️ ${r.message}`;
  });
});

document.getElementById("armBtn").addEventListener("click", async () => {
  const r = await postJSON("/api/command/arm", { arm: true });
  connStatus.textContent = r.ok ? "✅ ARM enviado" : `⚠️ ${r.message}`;
});
document.getElementById("disarmBtn").addEventListener("click", async () => {
  const r = await postJSON("/api/command/arm", { arm: false });
  connStatus.textContent = r.ok ? "✅ DISARM enviado" : `⚠️ ${r.message}`;
});

// -----------------------------
// SDR Plot (tiempo real)
// -----------------------------
const sdrDiv = document.getElementById("sdrPlot");
Plotly.newPlot(sdrDiv, [{
  x: [],
  y: [],
  mode: "lines",
  name: "SDR"
}], {
  margin: { t: 20, l: 40, r: 10, b: 30 },
  paper_bgcolor: "rgba(0,0,0,0)",
  plot_bgcolor: "rgba(0,0,0,0)",
  xaxis: { title: "Tiempo" },
  yaxis: { title: "Amplitud" }
}, {displayModeBar: false});

let sdrX = [];
let sdrY = [];

socket.on("sdr", (s) => {
  sdrX.push(new Date(s.t * 1000));
  sdrY.push(s.value);

  if (sdrX.length > 300) { sdrX.shift(); sdrY.shift(); }

  Plotly.update(sdrDiv, { x: [sdrX], y: [sdrY] });
});
