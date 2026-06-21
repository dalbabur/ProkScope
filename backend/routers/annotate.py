from __future__ import annotations

import logging
import os
import tempfile

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile

from backend.models.schemas import Annotation
from backend.services import parser
from backend.services.feature_db import FeatureRecord, get_db, reload_db

logger = logging.getLogger(__name__)
router = APIRouter()


def _try_get_db():
    try:
        return get_db()
    except FileNotFoundError:
        return None


@router.post("/genome", response_model=list[Annotation])
async def annotate_genome(
    genome: UploadFile = File(...),
    feature_ids: str = Form(default=""),
    max_mismatches: int = Form(default=0),
) -> list[Annotation]:
    """Search a genome file for features from the loaded feature database.

    - **genome**: FASTA or GenBank file to search in.
    - **feature_ids**: comma-separated feature IDs to restrict the search (empty = all features).
    - **max_mismatches**: allow up to this many mismatches (0–3).
    """
    if max_mismatches > 3:
        raise HTTPException(status_code=422, detail="max_mismatches must be <= 3")

    db = _try_get_db()
    if db is None:
        raise HTTPException(status_code=503, detail="Feature database not loaded")

    try:
        payload = await genome.read()
        records = parser.parse_sequence_file(payload, genome.filename or "genome.fasta")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not records:
        raise HTTPException(status_code=400, detail="No sequences found in the uploaded file")

    genome_seq = records[0].sequence

    ids: list[str] | None = [fid.strip() for fid in feature_ids.split(",") if fid.strip()] or None

    return db.find_in_genome(genome_seq, feature_ids=ids, max_mismatches=max_mismatches)


@router.post("/upload-db")
async def upload_db(db_file: UploadFile = File(...)) -> dict:
    """Upload a feature_db.json and reload the feature database.

    Returns ``{"loaded": N}`` where N is the number of features loaded.
    """
    contents = await db_file.read()
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


@router.get("/features", response_model=list[FeatureRecord])
def list_features(
    q: str | None = None,
    type: str | None = None,
    min_length: int | None = None,
    max_length: int | None = None,
    response: Response = None,
) -> list[FeatureRecord]:
    """List features from the loaded feature database.

    Supports text search (``q``) and filtering by ``type``, ``min_length``, ``max_length``.
    """
    db = _try_get_db()
    if db is None:
        if response is not None:
            response.headers["X-DB-Missing"] = "true"
        return []

    results = db.search(q or "")
    if type or min_length is not None or max_length is not None:
        filter_results = db.filter(
            types=[type] if type else None,
            min_length=min_length,
            max_length=max_length,
        )
        result_ids = {f.id for f in filter_results}
        results = [f for f in results if f.id in result_ids]
    return results


@router.get("/feature-types", response_model=list[str])
def list_feature_types() -> list[str]:
    """Return the unique feature types present in the loaded feature database."""
    db = _try_get_db()
    if db is None:
        return []
    return sorted(db._by_type.keys())
