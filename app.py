import time
import threading
import serial
from flask import Flask, render_template
from flask_socketio import SocketIO, emit

# =============================
# CONFIG
# =============================
SERIAL_PORT = "COM15"
SERIAL_BAUD = 9600

app = Flask(__name__)
app.config["SECRET_KEY"] = "dev"

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading"
)

# =============================
# STATE GLOBAL
# =============================
state = {
    "lat": 0.0,
    "lon": 0.0,
    "alt": 0.0,
    "battery": 0,
    "battery_v": 0.0,
    "fix": 0,
    "yaw": 0.0,
    "pitch": 0.0,
    "roll": 0.0,
    "mode": "UNKNOWN",
    "armed": False
}

state_lock = threading.Lock()

# =============================
# SERIAL READER (DATOS REALES)
# =============================
def serial_reader():
    global state

    try:
        ser = serial.Serial(SERIAL_PORT, SERIAL_BAUD, timeout=1)
        print("✅ Serial conectado")

        while True:
            line = ser.readline().decode("utf-8", errors="ignore").strip()
            if not line:
                continue

            print("📥 RX:", line)

            # RX > GPS:lat,lon|ALT:x|ATT:y,p,r|BAT:v,%|FIX:n|MODE:x
            try:
                payload = line.split("RX >")[1].strip()
                fields = payload.split("|")

                with state_lock:
                    for f in fields:
                        if f.startswith("GPS:"):
                            lat, lon = f.replace("GPS:", "").split(",")
                            state["lat"] = float(lat)
                            state["lon"] = float(lon)

                        elif f.startswith("ALT:"):
                            state["alt"] = float(f.replace("ALT:", ""))

                        elif f.startswith("ATT:"):
                            yaw, pitch, roll = f.replace("ATT:", "").split(",")
                            state["yaw"] = float(yaw)
                            state["pitch"] = float(pitch)
                            state["roll"] = float(roll)

                        elif f.startswith("BAT:"):
                            v, pct = f.replace("BAT:", "").split(",")
                            state["battery_v"] = float(v.replace("V", ""))
                            state["battery"] = int(pct.replace("%", ""))

                        elif f.startswith("FIX:"):
                            state["fix"] = int(f.replace("FIX:", ""))

                        elif f.startswith("MODE:"):
                            state["mode"] = f.replace("MODE:", "")

            except Exception as e:
                print("⚠️ Parse error:", e)

    except Exception as e:
        print("⚠️ Serial error:", e)

# =============================
# TELEMETRY PUBLISHER (20 Hz)
# =============================
def telemetry_publisher():
    while True:
        with state_lock:
            socketio.emit("telemetry", state)
        time.sleep(0.05)  # 20 Hz reales

# =============================
# SDR SIMULADO (por ahora)
# =============================
def sdr_publisher():
    import math
    t = 0.0
    while True:
        t += 0.1
        value = math.sin(t) + (math.sin(t * 3) * 0.3)

        socketio.emit("sdr", {
            "t": time.time(),
            "value": value
        })
        time.sleep(0.05)

# =============================
# FLASK
# =============================
@app.route("/")
def index():
    return render_template("index.html")

@socketio.on("connect")
def on_connect():
    emit("telemetry", state)

# =============================
# MAIN
# =============================
if __name__ == "__main__":
    threading.Thread(target=serial_reader, daemon=True).start()
    threading.Thread(target=telemetry_publisher, daemon=True).start()
    threading.Thread(target=sdr_publisher, daemon=True).start()

    socketio.run(
        app,
        host="0.0.0.0",
        port=5000,
        debug=False
    )
