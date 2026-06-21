from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from backend.models.schemas import DriveFile
from backend.services import drive_client

router = APIRouter()


class CallbackBody(BaseModel):
    code: str
    redirect_uri: str
    state: str


@router.get("/auth-url")
def auth_url(redirect_uri: str = Query(...)) -> dict[str, str]:
    try:
        return {"auth_url": drive_client.get_auth_url(redirect_uri)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/callback")
def callback(body: CallbackBody) -> dict[str, str]:
    try:
        return {"session_token": drive_client.exchange_code_for_session(body.code, body.redirect_uri, body.state)}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/files", response_model=list[DriveFile])
def files(session_token: str, folder_id: str | None = None, query: str | None = None) -> list[DriveFile]:
    try:
        return drive_client.list_files(session_token=session_token, folder_id=folder_id, query=query)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/folders", response_model=list[DriveFile])
def folders(session_token: str, parent_id: str | None = None) -> list[DriveFile]:
    try:
        return drive_client.list_folders(session_token=session_token, parent_id=parent_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
