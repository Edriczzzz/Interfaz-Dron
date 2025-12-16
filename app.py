import time
import threading
import random
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

# MAVLink
from pymavlink import mavutil

app = Flask(__name__)
app.config["SECRET_KEY"] = "dev"
socketio = SocketIO(app, cors_allowed_origins="*")

# -----------------------------
# Config: Pixhawk connection
# -----------------------------
# Ejemplos:
#   USB:   "COM5" (Windows) o "/dev/ttyACM0" (Linux)
#   TELEM: "/dev/ttyUSB0"
#   UDP SITL: "udp:127.0.0.1:14550"
MAVLINK_ENDPOINT = "udp:127.0.0.1:14550"  # Cambia a tu puerto real
mav = None
mav_connected = False

# Estado cacheado para mandar a la web
state = {
    "lat": 19.4326,
    "lon": -99.1332,
    "alt": 0.0,
    "groundspeed": 0.0,
    "battery": 100,
    "mode": "UNKNOWN",
    "armed": False,
    "fix_type": 0,
    "satellites": 0,
}

def connect_mavlink():
    global mav, mav_connected
    try:
        mav = mavutil.mavlink_connection(MAVLINK_ENDPOINT, autoreconnect=True)
        mav.wait_heartbeat(timeout=10)
        mav_connected = True
        print("✅ MAVLink conectado. Heartbeat OK.")
    except Exception as e:
        mav_connected = False
        print("❌ No se pudo conectar MAVLink:", e)

def mavlink_reader():
    """Lee mensajes MAVLink y actualiza state + emite a la web."""
    global mav, mav_connected

    while True:
        if not mav_connected or mav is None:
            connect_mavlink()
            time.sleep(1)
            continue

        try:
            msg = mav.recv_match(blocking=True, timeout=1)
            if msg is None:
                continue

            mtype = msg.get_type()

            if mtype == "GLOBAL_POSITION_INT":
                state["lat"] = msg.lat / 1e7
                state["lon"] = msg.lon / 1e7
                state["alt"] = msg.relative_alt / 1000.0  # mm -> m

            elif mtype == "VFR_HUD":
                state["groundspeed"] = float(msg.groundspeed)

            elif mtype == "SYS_STATUS":
                # battery_remaining es %
                if msg.battery_remaining != -1:
                    state["battery"] = int(msg.battery_remaining)

            elif mtype == "HEARTBEAT":
                # modo y armado
                state["mode"] = mavutil.mode_string_v10(msg)
                state["armed"] = (msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED) != 0

            elif mtype == "GPS_RAW_INT":
                state["fix_type"] = int(msg.fix_type)
                state["satellites"] = int(msg.satellites_visible)

            # Emitir a todos los clientes conectados
            socketio.emit("telemetry", state)

        except Exception as e:
            print("⚠️ Error leyendo MAVLink:", e)
            mav_connected = False
            time.sleep(1)

def sdr_stream_simulated():
    """Simula datos SDR en tiempo real (cámbialo por tu lectura real)."""
    t = 0
    while True:
        # Ejemplo: señal + ruido
        t += 1
        sample = {
            "t": time.time(),
            "value": (random.random() - 0.5) * 0.3 + 0.8 * (1 if (t % 30) < 15 else 0)
        }
        socketio.emit("sdr", sample)
        time.sleep(0.05)  # 20 Hz

def set_mode(mode_str: str):
    """Cambia modo usando pymavlink."""
    if not mav_connected:
        return False, "MAVLink no conectado"

    mode_mapping = mav.mode_mapping()
    if mode_str not in mode_mapping:
        return False, f"Modo no válido para este firmware: {mode_str}"

    mode_id = mode_mapping[mode_str]
    mav.mav.set_mode_send(
        mav.target_system,
        mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
        mode_id
    )
    return True, "OK"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/command/mode", methods=["POST"])
def api_set_mode():
    data = request.get_json(force=True)
    mode = data.get("mode", "")
    ok, msg = set_mode(mode)
    return jsonify({"ok": ok, "message": msg})

# Opcional: ARM/DISARM
@app.route("/api/command/arm", methods=["POST"])
def api_arm():
    if not mav_connected:
        return jsonify({"ok": False, "message": "MAVLink no conectado"})
    data = request.get_json(force=True)
    arm = bool(data.get("arm", True))

    mav.mav.command_long_send(
        mav.target_system,
        mav.target_component,
        mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM,
        0,
        1.0 if arm else 0.0, 0, 0, 0, 0, 0, 0
    )
    return jsonify({"ok": True, "message": "OK"})

@socketio.on("connect")
def on_connect():
    emit("telemetry", state)

def start_threads():
    threading.Thread(target=mavlink_reader, daemon=True).start()
    threading.Thread(target=sdr_stream_simulated, daemon=True).start()

if __name__ == "__main__":
    start_threads()
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
