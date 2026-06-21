from __future__ import annotations

import json
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from backend.routers import annotations, comparison, drive, sequences

app = FastAPI(title="Genomics Tool")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def root() -> dict[str, str]:
    return {
        "message": "Backend is running. Use /docs or start the Vite frontend on port 5173.",
    }


@app.get("/auth/callback", response_class=HTMLResponse)
def auth_callback(code: str | None = None, state: str | None = None, error: str | None = None) -> str:
    message = {"code": code, "state": state, "error": error or (None if code else "Missing OAuth code in callback URL.")}
    payload = json.dumps(message)

    return f"""
<!doctype html>
<html>
    <body style=\"font-family: sans-serif; padding: 24px;\">
        <p>Authentication complete. You can close this window.</p>
        <script>
            const payload = {payload};
            if (window.opener) {{
                window.opener.postMessage(payload, '*');
            }}
            window.close();
        </script>
    </body>
</html>
"""


app.include_router(sequences.router, prefix="/api/sequences", tags=["sequences"])
app.include_router(annotations.router, prefix="/api/annotations", tags=["annotations"])
app.include_router(comparison.router, prefix="/api/comparison", tags=["comparison"])
app.include_router(drive.router, prefix="/api/drive", tags=["drive"])

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
