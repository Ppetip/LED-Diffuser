import json
import time

import serial


def command(port, payload, timeout=30):
    port.write((json.dumps(payload, separators=(",", ":")) + "\n").encode())
    port.flush()
    deadline = time.time() + timeout
    lines = []
    while time.time() < deadline:
        line = port.readline().decode("utf-8", errors="replace").strip()
        if not line:
            continue
        lines.append(line)
        if line.startswith("{"):
            reply = json.loads(line)
            if reply.get("ok") not in (1, True):
                raise AssertionError(f"Rejected command: {reply}")
            return reply
    raise TimeoutError("No acknowledgement:\n" + "\n".join(lines[-30:]))


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
    command(port, {"op": "show_begin", "count": 24, "frameMs": 100, "brightness": 20})
    for index in range(24):
        level = index % 16
        pixel = f"{level:02x}{(15-level):02x}10"
        reply = command(port, {"op": "show_frame", "index": index, "pixels": pixel * 280})
        assert reply["i"] == index, reply
    committed = command(port, {"op": "show_commit"})
    assert committed["done"] == 24, committed
    status = command(port, {"op": "get_status"})
    assert status["showCount"] == 24 and status["frameMs"] == 100, status
    assert status["upload"]["active"] is False, status
    print("PASS: full 24-frame upload acknowledged, verified, committed, and playing")
finally:
    port.close()
