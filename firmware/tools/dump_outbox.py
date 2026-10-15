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
SAMPLE = struct.Struct('<II16sQqqffffII72s')


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
        if len(raw) != SAMPLE.size:
            raise ValueError('Unsupported sample layout; preserve the dump.')
        version, flags, boot, seq, uptime, utc, *tail = SAMPLE.unpack(raw)
        values, profile, reserved, identity = tail[:4], tail[4], tail[5], tail[6]
        if version != 1 or profile not in (1, 2) or flags & ~15 or reserved or b'\0' not in identity:
            raise ValueError('Invalid sample identity/schema; preserve the dump.')
        role = 'inlet' if profile == 1 else 'outlet'
        reading = {'node_id': role, 'message_id': f'test-{role}-{boot.hex()}-{seq}',
                   'timestamp': datetime.fromtimestamp(utc/1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z') if utc else None}
        for index, (name, value) in enumerate(zip(('co2', 'temperature', 'humidity', 'pm25'), values)):
            if flags & (1 << index):
                if not math.isfinite(value):
                    raise ValueError('Non-finite stored measurement.')
                scale = 1 if index == 0 else 10
                reading[name] = math.copysign(math.floor(abs(value)*scale+0.5)/scale, value)
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
