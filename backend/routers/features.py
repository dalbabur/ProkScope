from __future__ import annotations

import logging
import tempfile
import os

from fastapi import APIRouter, File, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.models.schemas import Annotation
from backend.services import drive_client
from backend.services.feature_db import FeatureRecord, build_db_from_genbank_bytes, get_db, reload_db, set_db

logger = logging.getLogger(__name__)
router = APIRouter()


class SearchGenomeRequest(BaseModel):
    genome_sequence: str
    feature_ids: list[str] | None = None
    max_mismatches: int = 0


class UpdateTagsRequest(BaseModel):
    tags: list[str]


class BuildFromDriveRequest(BaseModel):
    session_token: str
    file_ids: list[str]
    filenames: list[str]


def _try_get_db():
    try:
        return get_db()
    except FileNotFoundError:
        return None


@router.get("", response_model=list[FeatureRecord])
def list_features(
    q: str | None = None,
    type: str | None = None,
    min_length: int | None = None,
    max_length: int | None = None,
    tag: str | None = None,
    response: Response = None,
) -> list[FeatureRecord]:
    db = _try_get_db()
    if db is None:
        if response is not None:
            response.headers["X-DB-Missing"] = "true"
        return []

    results = db.search(q or "")
    if type or min_length is not None or max_length is not None or tag:
        filter_results = db.filter(
            types=[type] if type else None,
            min_length=min_length,
            max_length=max_length,
            tags=[tag] if tag else None,
        )
        result_ids = {f.id for f in filter_results}
        results = [f for f in results if f.id in result_ids]
    return results


@router.get("/types", response_model=list[str])
def list_types() -> list[str]:
    db = _try_get_db()
    if db is None:
        return []
    return sorted(db._by_type.keys())


@router.get("/{feature_id}", response_model=FeatureRecord)
def get_feature(feature_id: str) -> FeatureRecord:
    db = _try_get_db()
    if db is None:
        raise HTTPException(status_code=404, detail="Feature database not loaded")
    feat = db._by_id.get(feature_id)
    if feat is None:
        raise HTTPException(status_code=404, detail=f"Feature not found: {feature_id}")
    return feat


@router.post("/search-genome", response_model=list[Annotation])
def search_genome(request: SearchGenomeRequest) -> list[Annotation]:
    if request.max_mismatches > 3:
        raise HTTPException(status_code=422, detail="max_mismatches must be <= 3")

    db = _try_get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Feature database not loaded")

    genome_len = len(request.genome_sequence)
    candidates = (
        [db._by_id[fid] for fid in request.feature_ids if fid in db._by_id]
        if request.feature_ids is not None
        else db.features
    )

    if genome_len * len(candidates) > 5_000_000_000:
        logger.warning(
            "Large search requested: genome=%d bp, features=%d. "
            "Consider reducing the feature selection.",
            genome_len,
            len(candidates),
        )

    return db.find_in_genome(
        request.genome_sequence,
        feature_ids=request.feature_ids,
        max_mismatches=request.max_mismatches,
    )


@router.post("/upload-db")
async def upload_db(file: UploadFile = File(...)) -> dict:
    contents = await file.read()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
    try:
        tmp.write(contents)
        tmp.flush()
        tmp.close()
        loaded_db = reload_db(tmp.name)
        return {"loaded": len(loaded_db.features)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


@router.post("/build-from-drive")
def build_from_drive(request: BuildFromDriveRequest) -> dict:
    if len(request.file_ids) != len(request.filenames):
        raise HTTPException(status_code=422, detail="file_ids and filenames must have the same length")
    if not request.file_ids:
        raise HTTPException(status_code=422, detail="At least one file is required")

    files: list[tuple[str, bytes]] = []
    errors: list[str] = []
    for file_id, filename in zip(request.file_ids, request.filenames):
        try:
            content = drive_client.download_file(request.session_token, file_id)
            files.append((filename, content))
        except Exception as exc:
            errors.append(f"{filename}: {exc}")

    if not files:
        raise HTTPException(status_code=400, detail="No files could be downloaded: " + "; ".join(errors))

    try:
        built_db = build_db_from_genbank_bytes(files)
        set_db(built_db)
        return {"loaded": len(built_db.features), "files": len(files), "errors": errors}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{feature_id}/tags", response_model=FeatureRecord)
def update_tags(feature_id: str, request: UpdateTagsRequest) -> FeatureRecord:
    db = _try_get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Feature database not loaded")
    try:
        return db.update_tags(feature_id, request.tags)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
