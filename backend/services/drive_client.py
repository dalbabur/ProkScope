from __future__ import annotations

import os
import uuid
from io import BytesIO

from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google_auth_oauthlib.flow import Flow

from backend.models.schemas import DriveFile

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
SESSION_STORE: dict[str, object] = {}


def _client_config() -> dict:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise ValueError("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET")
    return {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/callback")],
        }
    }


def get_auth_url(redirect_uri: str) -> str:
    flow = Flow.from_client_config(_client_config(), scopes=SCOPES, redirect_uri=redirect_uri)
    url, _ = flow.authorization_url(access_type="offline", include_granted_scopes="true", prompt="consent")
    return url


def exchange_code_for_session(code: str, redirect_uri: str) -> str:
    flow = Flow.from_client_config(_client_config(), scopes=SCOPES, redirect_uri=redirect_uri)
    flow.fetch_token(code=code)
    session_token = str(uuid.uuid4())
    SESSION_STORE[session_token] = flow.credentials
    return session_token


def _get_service(session_token: str):
    creds = SESSION_STORE.get(session_token)
    if creds is None:
        raise ValueError("Invalid or expired session token")
    return build("drive", "v3", credentials=creds)


def list_files(session_token: str, folder_id: str | None = None, query: str | None = None) -> list[DriveFile]:
    service = _get_service(session_token)
    extension_filter = " or ".join(
        [f"name contains '{ext}'" for ext in [".fasta", ".fa", ".fna", ".fastq", ".fq", ".gb", ".gbk", ".genbank", ".gff", ".gff3", ".bed"]]
    )
    q = query or f"trashed=false and ({extension_filter})"
    if folder_id:
        q = f"'{folder_id}' in parents and ({q})"

    response = (
        service.files()
        .list(q=q, fields="files(id,name,mimeType,modifiedTime,size)", pageSize=200, supportsAllDrives=True, includeItemsFromAllDrives=True)
        .execute()
    )
    files = response.get("files", [])
    return [
        DriveFile(
            id=item["id"],
            name=item["name"],
            mime_type=item.get("mimeType", ""),
            modified_time=item.get("modifiedTime", ""),
            size=item.get("size"),
        )
        for item in files
    ]


def list_folders(session_token: str, parent_id: str | None = None) -> list[DriveFile]:
    q = "mimeType='application/vnd.google-apps.folder' and trashed=false"
    if parent_id:
        q = f"'{parent_id}' in parents and {q}"
    return list_files(session_token=session_token, query=q)


def download_file(session_token: str, file_id: str) -> bytes:
    service = _get_service(session_token)
    request = service.files().get_media(fileId=file_id)
    fh = BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return fh.getvalue()
