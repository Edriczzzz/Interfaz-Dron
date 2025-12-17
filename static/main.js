// -----------------------------
// Socket.IO
// -----------------------------
const socket = io({
  transports: ["websocket"],
  upgrade: false
});

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

// "Dron" como cuadro (divIcon)
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

// =============================
// 3D Attitude Indicator (MOVERLO AQUÍ ARRIBA)
// =============================
const container = document.getElementById("attitude3d");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080d);

const camera = new THREE.PerspectiveCamera(
  45,
  container.clientWidth / container.clientHeight,
  0.1,
  100
);
camera.position.set(0, 2, 5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

// Luz
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(5, 10, 7);
scene.add(light);
scene.add(new THREE.AmbientLight(0x888888));

scene.add(new THREE.GridHelper(5, 10, 0x00ffcc, 0x003333));
scene.add(new THREE.AxesHelper(2));

// "Dron" simple (caja + brazos) - ⭐ DEFINIDO ANTES
const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.5, 0.3, 1.5),
  new THREE.MeshStandardMaterial({ color: 0x00d1ff })
);
scene.add(body);

// Render loop
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

// Resize responsivo
window.addEventListener("resize", () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});

// -----------------------------
// UI Telemetry (AHORA SÍ PUEDE USAR 'body')
// -----------------------------
function setText(id, val) {
  document.getElementById(id).textContent = val;
}

socket.on("telemetry", (t) => {
  // ---- UI texto ----
  setText("mode", t.mode ?? "—");
  setText("armed", t.armed ? "Sí" : "No");
  setText("battery", (t.battery ?? "—") + " %");
  setText("lat", (t.lat ?? 0).toFixed(7));
  setText("lon", (t.lon ?? 0).toFixed(7));
  setText("alt", (t.alt ?? 0).toFixed(1));

  // ---- MAPA ----
  if (Number.isFinite(t.lat) && Number.isFinite(t.lon)) {
    droneMarker.setLatLng([t.lat, t.lon]);

    trailPoints.push([t.lat, t.lon]);
    if (trailPoints.length > 150) trailPoints.shift();
    trail.setLatLngs(trailPoints);
  }

  // ---- ACTITUD 3D ---- ✅ AHORA FUNCIONA
  if (t.yaw !== undefined) {
    body.rotation.order = "ZYX";
    body.rotation.z = THREE.MathUtils.degToRad(t.roll);   // roll
    body.rotation.x = THREE.MathUtils.degToRad(t.pitch);  // pitch
    body.rotation.y = THREE.MathUtils.degToRad(t.yaw);    // yaw

    setText("yaw", t.yaw.toFixed(1));
    setText("pitch", t.pitch.toFixed(1));
    setText("roll", t.roll.toFixed(1));
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