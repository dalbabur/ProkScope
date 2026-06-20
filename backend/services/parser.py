from __future__ import annotations

import os
from io import StringIO

from Bio import SeqIO
from Bio.SeqUtils import gc_fraction

from backend.models.schemas import Feature, SequenceRecord


FORMAT_MAP = {
    ".fasta": "fasta",
    ".fa": "fasta",
    ".fna": "fasta",
    ".gb": "genbank",
    ".gbk": "genbank",
    ".genbank": "genbank",
    ".fastq": "fastq",
    ".fq": "fastq",
}


def _detect_sequence_format(filename: str) -> str:
    _, ext = os.path.splitext(filename.lower())
    if ext not in FORMAT_MAP:
        raise ValueError(f"Unsupported sequence file extension: {ext or filename}")
    return FORMAT_MAP[ext]


def parse_sequence_file(file_bytes: bytes, filename: str) -> list[SequenceRecord]:
    file_format = _detect_sequence_format(filename)
    handle = StringIO(file_bytes.decode("utf-8", errors="ignore"))

    records: list[SequenceRecord] = []
    for record in SeqIO.parse(handle, file_format):
        sequence = str(record.seq)
        features: list[Feature] = []
        if file_format == "genbank":
            for feature in getattr(record, "features", []):
                quals = dict(getattr(feature, "qualifiers", {}) or {})
                name = (
                    (quals.get("gene") or [None])[0]
                    or (quals.get("locus_tag") or [None])[0]
                    or (quals.get("product") or [None])[0]
                    or feature.type
                )
                strand = feature.location.strand if feature.location and feature.location.strand in (1, -1) else 1
                features.append(
                    Feature(
                        type=feature.type,
                        name=str(name),
                        start=int(feature.location.start) + 1,
                        end=int(feature.location.end),
                        strand=strand,
                        qualifiers=quals,
                    )
                )

        records.append(
            SequenceRecord(
                id=record.id,
                name=record.name,
                description=record.description,
                sequence=sequence,
                length=len(sequence),
                format=file_format,
                gc_content=round(gc_fraction(sequence) * 100, 4),
                features=features,
            )
        )

    return records
