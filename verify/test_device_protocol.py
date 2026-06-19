import json
import time

import serial


def read_reply(port, timeout=30):
    deadline = time.time() + timeout
    lines = []
    while time.time() < deadline:
        line = port.readline().decode("utf-8", errors="replace").strip()
        if not line:
            continue
        lines.append(line)
        if line.startswith("{"):
            payload = json.loads(line)
            if "ok" in payload:
                return payload, lines
    raise TimeoutError("No JSON acknowledgement. Serial output:\n" + "\n".join(lines[-30:]))


def command(port, payload):
    port.write((json.dumps(payload, separators=(",", ":")) + "\n").encode())
    port.flush()
    reply, lines = read_reply(port)
    if reply.get("ok") not in (1, True):
        raise AssertionError(f"Device rejected {payload.get('op', 'command')}: {reply}\n" + "\n".join(lines))
    return reply


port = serial.Serial()
port.port = "COM5"
port.baudrate = 115200
port.timeout = 0.25
port.dtr = False
port.rts = False
port.open()
try:
    time.sleep(2.5)
    port.reset_input_buffer()
    initial = command(port, {"op": "get_status"})
    assert initial["firmware"] == "2.1.0", initial
    assert initial["protocol"] == 2, initial
    assert initial["powerLimitMa"] == 750, initial
    assert initial["caps"]["supportsOTA"] is False, initial
    original_count = initial["showCount"]

    command(port, {"op": "show_begin", "count": 2, "frameMs": 180, "brightness": 20})
    command(port, {"op": "show_frame", "index": 0, "pixels": "000000" * 280})
    command(port, {"op": "show_cancel"})
    cancelled = command(port, {"op": "get_status"})
    assert cancelled["showCount"] == original_count, (original_count, cancelled)
    assert cancelled["upload"]["active"] is False, cancelled

    command(port, {"op": "show_begin", "count": 2, "frameMs": 180, "brightness": 20})
    command(port, {"op": "show_frame", "index": 0, "pixels": "000000" * 280})
    command(port, {"op": "show_frame", "index": 1, "pixels": "001010" * 280})
    committed = command(port, {"op": "show_commit"})
    assert committed["done"] == 2, committed
    final = command(port, {"op": "get_status"})
    assert final["showCount"] == 2 and final["frameMs"] == 180, final
    print("PASS: firmware 2.1.0 status, 750 mA cap, cancel isolation, commit read-back, and 2-frame playback")
finally:
    port.close()
