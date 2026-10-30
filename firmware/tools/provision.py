"""Send a private JSON provisioning file over USB once; never prints its contents."""
import argparse
import json
import time
from pathlib import Path
import serial

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', required=True)
parser.add_argument('--file', type=Path, required=True)
args = parser.parse_args()
data = json.loads(args.file.read_text())
required = {'device_id', 'device_token', 'profile', 'hardware', 'backend', 'ssid', 'password'}
if not required <= data.keys():
    parser.error('Provisioning file needs device identity, credential, profile, hardware, HTTPS backend and Wi-Fi settings')
data['command'] = 'provision'
encoded = json.dumps(data, separators=(',', ':')).encode() + b'\n'
if str(data.get('ingest_key', '')).startswith('replace'):
    parser.error('ingest_key is still the example placeholder; use the private key set on the backend')
if len(encoded) > 1023:
    parser.error('Provisioning input exceeds device limit')
# The board reads the console UART without a driver buffer: only the 128-byte hardware
# FIFO holds input while the serial task sleeps (50 ms after an empty read). A line
# sent in one burst overflows it and arrives corrupted, so send small paced chunks.
CHUNK_BYTES = 16
CHUNK_PAUSE_S = 0.06
with serial.Serial(args.port, 115200, timeout=1) as port:
    # Opening some USB adapters resets the board. Wait for startup before sending.
    time.sleep(2)
    port.reset_input_buffer()
    for start in range(0, len(encoded), CHUNK_BYTES):
        port.write(encoded[start:start + CHUNK_BYTES])
        port.flush()
        time.sleep(CHUNK_PAUSE_S)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        line = port.readline()
        if b'ZC: provisioning saved' in line:
            print('Provisioning saved; board is rebooting.')
            break
        if b'ZC: provisioning rejected' in line or b'already provisioned' in line:
            raise SystemExit('Device rejected or could not read the provisioning line; verify profile/hardware and first-boot state.')
    else:
        raise SystemExit('No provisioning acknowledgement. Check the USB serial port and running firmware.')
