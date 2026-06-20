#!/usr/bin/env python3
"""Build a feature database JSON from Benchling-exported GenBank files."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from Bio import SeqIO
except ImportError:
    print("Error: biopython is required. Install with: pip install biopython", file=sys.stderr)
    sys.exit(1)

_LABEL_QUALIFIERS = ["label", "note", "gene", "product", "standard_name"]
_COLOR_QUALIFIERS = ["ApEinfo_fwdcolor", "ApEinfo_revcolor"]
_DESCRIPTION_QUALIFIERS = ["note", "product", "gene"]
_GENBANK_EXTS = {"*.gb", "*.gbk", "*.genbank"}

_DEFAULT_EXCLUDE = {"primer", "primer_bind"}
_DEFAULT_MIN_LENGTH = 6
_DEFAULT_OUTPUT = "feature_db.json"


def _first_qualifier(qualifiers: dict, keys: list[str]) -> str | None:
    for key in keys:
        values = qualifiers.get(key)
        if values:
            v = values[0].strip() if isinstance(values, list) else str(values).strip()
            if v:
                return v
    return None


def _build_description(qualifiers: dict, label: str) -> str:
    parts: list[str] = []
    for key in _DESCRIPTION_QUALIFIERS:
        values = qualifiers.get(key)
        if not values:
            continue
        v = values[0].strip() if isinstance(values, list) else str(values).strip()
        if v and v != label:
            parts.append(v)
    return "; ".join(dict.fromkeys(parts))


def build_db(
    input_dir: str,
    output_path: str = _DEFAULT_OUTPUT,
    min_length: int = _DEFAULT_MIN_LENGTH,
    exclude_types: set[str] | None = None,
    dedup: bool = True,
) -> None:
    if exclude_types is None:
        exclude_types = _DEFAULT_EXCLUDE

    input_root = Path(input_dir)
    genbank_files: list[Path] = []
    for pattern in _GENBANK_EXTS:
        genbank_files.extend(input_root.rglob(pattern))
    genbank_files = sorted(set(genbank_files))

    if not genbank_files:
        print(f"No GenBank files found in {input_dir}", file=sys.stderr)
        sys.exit(1)

    # key -> (label, sequence_upper); value -> feature dict with longest description
    seen: dict[tuple[str, str], dict] = {}
    source_files: list[str] = []

    for gb_path in genbank_files:
        source_files.append(gb_path.name)
        try:
            records = list(SeqIO.parse(str(gb_path), "genbank"))
        except Exception as exc:
            print(f"Warning: could not parse {gb_path}: {exc}", file=sys.stderr)
            continue

        for record in records:
            record_seq = str(record.seq)
            plasmid_name = record.name or gb_path.stem

            for feature in record.features:
                feat_type = feature.type
                if feat_type.lower() in {e.lower() for e in exclude_types}:
                    continue

                loc = feature.location
                feat_seq = record_seq[loc.start:loc.end]
                if len(feat_seq) < min_length:
                    continue

                qualifiers = feature.qualifiers or {}
                label = _first_qualifier(qualifiers, _LABEL_QUALIFIERS)
                if label is None:
                    continue

                color = _first_qualifier(qualifiers, _COLOR_QUALIFIERS) or "#888888"
                description = _build_description(qualifiers, label)
                strand = "+" if (loc.strand is None or loc.strand >= 0) else "-"

                entry: dict = {
                    "label": label,
                    "type": feat_type,
                    "length": len(feat_seq),
                    "strand": strand,
                    "color": color,
                    "sequence": feat_seq,
                    "description": description,
                    "source_plasmid": plasmid_name,
                    "source_file": gb_path.name,
                    "tags": [],
                }

                if dedup:
                    key = (label.lower(), feat_seq.upper())
                    existing = seen.get(key)
                    if existing is None or len(description) > len(existing["description"]):
                        seen[key] = entry
                else:
                    # Use a unique key so nothing is merged
                    key = (label.lower(), feat_seq.upper(), gb_path.name, str(loc.start))
                    seen[key] = entry  # type: ignore[assignment]

    features = list(seen.values())
    features.sort(key=lambda f: (f["source_file"], f["label"]))

    output: dict = {
        "version": "1.0",
        "generated": datetime.now(timezone.utc).isoformat(),
        "source_files": [p.name for p in genbank_files],
        "features": [
            {"id": f"feat_{i + 1:04d}", **feat}
            for i, feat in enumerate(features)
        ],
    }

    Path(output_path).write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"Wrote {len(features)} features to {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build prokscope feature database from Benchling GenBank exports."
    )
    parser.add_argument("--input", required=True, help="Folder containing .gb/.gbk/.genbank files")
    parser.add_argument("--output", default=_DEFAULT_OUTPUT, help=f"Output JSON path (default: {_DEFAULT_OUTPUT})")
    parser.add_argument("--min-length", type=int, default=_DEFAULT_MIN_LENGTH, help="Minimum feature length in bp")
    parser.add_argument(
        "--exclude-types",
        nargs="*",
        default=list(_DEFAULT_EXCLUDE),
        help="Feature types to exclude (default: primer primer_bind)",
    )
    parser.add_argument("--no-dedup", action="store_true", help="Disable deduplication on (label, sequence)")
    args = parser.parse_args()

    build_db(
        input_dir=args.input,
        output_path=args.output,
        min_length=args.min_length,
        exclude_types=set(args.exclude_types),
        dedup=not args.no_dedup,
    )


if __name__ == "__main__":
    main()
