#!/usr/bin/env python3
"""Read complete NDJSON frames from a file and publish outside the trading process."""
import argparse
import json
import os
import time
import urllib.request
import urllib.error
from pathlib import Path


def publish(url, token, payload, retries=8):
    encoded = json.dumps(payload, separators=(',', ':'), allow_nan=False).encode()
    if len(encoded) > 128 * 1024:
        raise ValueError('Encoded frame exceeds server limit')
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, encoded, {
                'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token
            }, method='POST')
            with urllib.request.urlopen(request, timeout=5) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code < 500:
                raise RuntimeError(error.read().decode()) from error
            if attempt == retries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
        time.sleep(min(0.25 * 2 ** attempt, 5))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    parser.add_argument('--session', required=True, help='Unique ID for this capture; reuse only for an identical resend')
    parser.add_argument('--label')
    parser.add_argument('--source', choices=['telemetry', 'example', 'demo'], default='telemetry')
    parser.add_argument('--url', default='http://127.0.0.1:8787/api/ingest')
    parser.add_argument('--token-file', type=Path, default=Path('data/ingest-token'))
    parser.add_argument('--follow', action='store_true', help='Wait for complete appended lines; detects truncation/rotation')
    args = parser.parse_args()
    token = os.environ.get('NEXUS_INGEST_TOKEN') or args.token_file.read_text().strip()
    position = 0
    with args.file.open('rb') as stream:
        initial = os.fstat(stream.fileno())
        while True:
            start = stream.tell()
            line = stream.readline(128 * 1024 + 1)
            if len(line) > 128 * 1024:
                raise ValueError('NDJSON line exceeds 128 KiB')
            if not line or not line.endswith(b'\n'):
                if not args.follow:
                    if line:
                        raise ValueError('Incomplete final record: append a newline before ingesting')
                    break
                stream.seek(start)
                current = args.file.stat()
                if (current.st_dev, current.st_ino) != (initial.st_dev, initial.st_ino) or current.st_size < start:
                    raise RuntimeError('Log rotated or truncated; start a new capture/session explicitly')
                time.sleep(0.1)
                continue
            if not line.strip():
                continue
            frame = json.loads(line)
            frame['source'] = args.source
            result = publish(args.url, token, {
                'sessionId': args.session,
                'source': args.source,
                'label': args.label or args.session,
                'frame': frame
            })
            position += 1
            if position % 100 == 0:
                print(f'{position} frames accepted; latest sequence {result["seq"]}', flush=True)
    print(f'Complete: {position} frames. Session: {args.session}')


if __name__ == '__main__':
    main()
