from __future__ import annotations

import os
import uuid
from io import BytesIO
from pathlib import Path

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaIoBaseDownload
from google_auth_oauthlib.flow import Flow

from backend.models.schemas import DriveFile

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
SESSION_STORE: dict[str, object] = {}
OAUTH_PENDING: dict[str, dict[str, str]] = {}
SUPPORTED_EXTENSIONS = [".fasta", ".fa", ".fna", ".fastq", ".fq", ".gb", ".gbk", ".genbank", ".gff", ".gff3", ".bed"]


def _format_drive_http_error(exc: HttpError) -> str:
    message = str(exc)
    if "accessNotConfigured" in message or "Drive API has not been used" in message:
        return (
            "Google Drive API is not enabled for this Google Cloud project. "
            "Open Google Cloud Console, enable 'Google Drive API', then wait a few minutes and retry."
        )
    return f"Google Drive request failed: {message}"

def _load_env_from_file() -> None:
    # Fallback for local/Codespaces runs where uvicorn starts without exported env vars.
    candidates = [Path.cwd() / ".env", Path(__file__).resolve().parents[2] / ".env"]
    for env_path in candidates:
        if not env_path.exists():
            continue
        for raw in env_path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and value and not os.getenv(key):
                os.environ[key] = value
        break


def _client_config() -> dict:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        _load_env_from_file()
        client_id = os.getenv("GOOGLE_CLIENT_ID")
        client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise ValueError(
            "Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET. "
            "Set them in the process environment, or create a .env file in the repo root."
        )
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
    url, state = flow.authorization_url(access_type="offline", include_granted_scopes="true", prompt="consent")
    if flow.code_verifier:
        OAUTH_PENDING[state] = {"redirect_uri": redirect_uri, "code_verifier": flow.code_verifier}
    return url


def exchange_code_for_session(code: str, redirect_uri: str, state: str) -> str:
    pending = OAUTH_PENDING.pop(state, None)
    if not pending or not pending.get("code_verifier"):
        raise ValueError("OAuth session expired or invalid. Please click Connect Google Drive again.")

    expected_redirect = pending.get("redirect_uri")
    if expected_redirect and expected_redirect != redirect_uri:
        raise ValueError("Redirect URI mismatch for OAuth session. Please retry Drive sign-in.")

    flow = Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        redirect_uri=expected_redirect or redirect_uri,
        state=state,
        code_verifier=pending["code_verifier"],
        autogenerate_code_verifier=False,
    )
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
    q = query or "trashed=false"
    if folder_id:
        q = f"'{folder_id}' in parents and ({q})"

    try:
        response = (
            service.files()
            .list(
                q=q,
                fields="files(id,name,mimeType,modifiedTime,size)",
                pageSize=200,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
    except HttpError as exc:
        raise ValueError(_format_drive_http_error(exc)) from exc

    files = response.get("files", [])
    if query is None:
        files = [item for item in files if any(item.get("name", "").lower().endswith(ext) for ext in SUPPORTED_EXTENSIONS)]

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
