from __future__ import annotations

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.models.schemas import SequenceRecord
from backend.services import drive_client, parser

router = APIRouter()


class DriveSequenceRequest(BaseModel):
    session_token: str
    file_id: str
    filename: str | None = None


@router.post("/upload", response_model=list[SequenceRecord])
async def upload_sequence(file: UploadFile = File(...)) -> list[SequenceRecord]:
    try:
        payload = await file.read()
        return parser.parse_sequence_file(payload, file.filename or "")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/from-drive", response_model=list[SequenceRecord])
async def sequence_from_drive(request: DriveSequenceRequest) -> list[SequenceRecord]:
    try:
        payload = drive_client.download_file(request.session_token, request.file_id)
        filename = request.filename or request.file_id
        return parser.parse_sequence_file(payload, filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
