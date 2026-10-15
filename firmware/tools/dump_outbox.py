"""Decode a read-only USB dump of the reserved flash queue to JSON lines.

No credentials are read by this tool. Unsynchronized records retain timestamp=null,
boot ID and uptime; a missing UTC timestamp is never fabricated.
"""
import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import struct
import zlib

FORMAT = b'ZCHARMC-OUTBOX1\0'
SAMPLE_V1 = struct.Struct('<II16sQqqffffII72s')
SAMPLE_V2 = struct.Struct('<II16sQqq14f4I72s')


def decode(content):
    if len(content) < 8192 or len(content) % 4096 or content[:16] != FORMAT:
        raise ValueError('Not a supported outbox partition dump; do not erase the original.')
    records = []
    for offset in range(4096, len(content), 256):
        raw = content[offset:offset+256]
        state = struct.unpack_from('<I', raw, 252)[0]
        if state not in (0xfffffffe, 0xfffffffc):
            continue
        magic, length, order, parent = struct.unpack_from('<IIQQ', raw)
        valid = magic == 0x5a435131 and 0 < length <= 224 and 0 <= parent < order and zlib.crc32(raw[:248]) == struct.unpack_from('<I', raw, 248)[0]
        if not valid:
            if state == 0xfffffffc:
                continue
            raise ValueError(f'Committed record corruption at offset {offset}; preserve the dump.')
        records.append((state, order, parent, raw[24:24+length]))
    superseded = {parent for _, _, parent, _ in records if parent}
    for state, order, _, raw in sorted(records, key=lambda item: item[1]):
        if state != 0xfffffffe or order in superseded:
            continue
        if len(raw) == SAMPLE_V1.size and struct.unpack_from('<I', raw)[0] == 1:
            version, flags, boot, seq, uptime, utc, *tail = SAMPLE_V1.unpack(raw)
            values, profile, reserved, identity = tail[:4], tail[4], tail[5], tail[6]
            names = ('co2', 'temperature', 'humidity', 'pm25')
            valve_bits = control_flags = 0
            weights = ()
            if flags & ~15 or profile not in (1, 2):
                raise ValueError('Invalid legacy sample.')
        elif len(raw) == SAMPLE_V2.size and struct.unpack_from('<I', raw)[0] == 2:
            version, flags, boot, seq, uptime, utc, *tail = SAMPLE_V2.unpack(raw)
            values, weights = tail[:12], tail[12:14]
            profile, valve_bits, control_flags, reserved, identity = tail[14:]
            names = ('co2', 'temperature', 'humidity', 'ph', 'pm25', 'flow_rate', 'level', 'weight', 'no2', 'so2', 'pressure1', 'pressure2')
            if flags & ~4095 or valve_bits & ~15 or control_flags & ~7:
                raise ValueError('Invalid v2 flags.')
        else:
            raise ValueError('Unsupported sample layout; preserve the dump.')
        if profile not in (1, 2, 3) or reserved or b'\0' not in identity or uptime < 0 or utc < 0:
            raise ValueError('Invalid sample identity/schema; preserve the dump.')
        role = {1: 'inlet', 2: 'outlet', 3: 'control'}[profile]
        reading = {'node_id': role, 'message_id': f'test-{role}-{boot.hex()}-{seq}',
                   'timestamp': datetime.fromtimestamp(utc/1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z') if utc else None}
        def rounded(value, scale=10):
            if not math.isfinite(value):
                raise ValueError('Non-finite stored measurement.')
            return math.copysign(math.floor(abs(value)*scale+0.5)/scale, value)
        for index, (name, value) in enumerate(zip(names, values)):
            if flags & (1 << index):
                reading[name] = rounded(value, 1 if name == 'co2' else 10)
        if role == 'control':
            if version != 2 or control_flags != 7:
                raise ValueError('Incomplete control snapshot.')
            reading['valves'] = {f'sv{i+1}': bool(valve_bits & (1 << i)) for i in range(4)}
            reading['weights'] = {'weight1': rounded(weights[0]), 'weight2': rounded(weights[1])}
        yield {'source': 'simulated', 'device_id': identity.split(b'\0')[0].decode('ascii'),
               'boot_id': boot.hex(), 'sample_uptime_ms': uptime, 'queue_order': order, 'reading': reading}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dump', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        rows = list(decode(args.dump.read_bytes()))
        # Exclusive, private output: never overwrite an earlier recovery record.
        with open(args.output, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
            for row in rows:
                stream.write(json.dumps(row, allow_nan=False) + '\n')
    except (OSError, ValueError) as error:
        parser.exit(1, f'Export failed: {error}\n')
    print(f'Exported {len(rows)} pending simulated readings; original flash dump unchanged.')


if __name__ == '__main__':
    main()
