#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path


MAGIC = b"ACB1"


def build_bundle(wasm_path: Path, model_path: Path, output_path: Path) -> None:
    files = [
        ("dsp.wasm", wasm_path.read_bytes()),
        ("accent.model", model_path.read_bytes()),
    ]

    manifest = {"files": []}
    offset = 0
    payload_parts: list[bytes] = []
    for name, content in files:
        manifest["files"].append({"name": name, "offset": offset, "size": len(content)})
        payload_parts.append(content)
        offset += len(content)

    manifest_bytes = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
    bundle = b"".join(
        [
            MAGIC,
            struct.pack("<I", len(manifest_bytes)),
            manifest_bytes,
            *payload_parts,
        ]
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(bundle)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a single AccentAI DSP asset bundle.")
    parser.add_argument("--wasm", required=True, help="Path to dsp.wasm")
    parser.add_argument("--model", required=True, help="Path to accent.model")
    parser.add_argument("--output", required=True, help="Path to write the bundle")
    args = parser.parse_args()

    build_bundle(Path(args.wasm), Path(args.model), Path(args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
