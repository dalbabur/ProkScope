from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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


app.include_router(sequences.router, prefix="/api/sequences", tags=["sequences"])
app.include_router(annotations.router, prefix="/api/annotations", tags=["annotations"])
app.include_router(comparison.router, prefix="/api/comparison", tags=["comparison"])
app.include_router(drive.router, prefix="/api/drive", tags=["drive"])

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
