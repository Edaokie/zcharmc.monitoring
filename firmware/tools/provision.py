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
if len(encoded) > 1023:
    parser.error('Provisioning input exceeds device limit')
with serial.Serial(args.port, 115200, timeout=1) as port:
    # Opening some USB adapters resets the board. Wait for startup before sending.
    time.sleep(2)
    port.reset_input_buffer()
    port.write(encoded)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        line = port.readline()
        if b'ZC: provisioning saved' in line:
            print('Provisioning saved; board is rebooting.')
            break
        if b'ZC: provisioning rejected' in line or b'already provisioned' in line:
            raise SystemExit('Device rejected provisioning; verify profile/hardware and first-boot state.')
    else:
        raise SystemExit('No provisioning acknowledgement. Check the USB serial port and running firmware.')
