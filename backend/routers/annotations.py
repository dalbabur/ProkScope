from __future__ import annotations

import os
from io import StringIO

from Bio import SeqIO
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.models.schemas import Annotation
from backend.services import drive_client

router = APIRouter()


class DriveAnnotationRequest(BaseModel):
    session_token: str
    file_id: str
    filename: str


def _parse_attributes(value: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for item in value.split(";"):
        if "=" in item:
            key, attr_value = item.split("=", 1)
            attrs[key.strip()] = attr_value.strip()
    return attrs


def parse_annotation_file(file_bytes: bytes, filename: str) -> list[Annotation]:
    ext = os.path.splitext(filename.lower())[1]
    text = file_bytes.decode("utf-8", errors="ignore")

    if ext == ".bed":
        annotations: list[Annotation] = []
        for line in text.splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            annotations.append(
                Annotation(
                    chrom=parts[0],
                    start=int(parts[1]),
                    end=int(parts[2]),
                    name=parts[3] if len(parts) > 3 else "feature",
                    score=float(parts[4]) if len(parts) > 4 and parts[4] not in {"", "."} else None,
                    strand=parts[5] if len(parts) > 5 else None,
                    source="BED",
                    feature_type="BED",
                )
            )
        return annotations

    if ext in {".gff", ".gff3"}:
        annotations = []
        for line in text.splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < 9:
                continue
            attrs = _parse_attributes(parts[8])
            annotations.append(
                Annotation(
                    chrom=parts[0],
                    start=int(parts[3]),
                    end=int(parts[4]),
                    name=attrs.get("Name") or attrs.get("ID") or parts[2],
                    score=float(parts[5]) if parts[5] not in {"", "."} else None,
                    strand=parts[6] if parts[6] not in {"", "."} else None,
                    source=parts[1],
                    feature_type=parts[2],
                )
            )
        return annotations

    if ext in {".gb", ".gbk", ".genbank"}:
        annotations = []
        for record in SeqIO.parse(StringIO(text), "genbank"):
            for feature in record.features:
                quals = feature.qualifiers or {}
                name = (quals.get("gene") or quals.get("locus_tag") or quals.get("product") or [feature.type])[0]
                annotations.append(
                    Annotation(
                        chrom=record.id,
                        start=int(feature.location.start) + 1,
                        end=int(feature.location.end),
                        name=name,
                        score=None,
                        strand="+" if feature.location.strand != -1 else "-",
                        source="GenBank",
                        feature_type=feature.type,
                    )
                )
        return annotations

    raise ValueError(f"Unsupported annotation format: {ext}")


@router.post("/upload", response_model=list[Annotation])
async def upload_annotation(file: UploadFile = File(...)) -> list[Annotation]:
    try:
        payload = await file.read()
        return parse_annotation_file(payload, file.filename or "")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/from-drive", response_model=list[Annotation])
async def annotation_from_drive(request: DriveAnnotationRequest) -> list[Annotation]:
    try:
        payload = drive_client.download_file(request.session_token, request.file_id)
        return parse_annotation_file(payload, request.filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
