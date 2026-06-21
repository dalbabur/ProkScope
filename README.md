# Genomics Tool

Lightweight web app for bacterial genome sequence parsing, annotation overlay, and mutation comparison.

## Quick start (Docker)

```bash
cp .env.example .env
# Fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
docker compose up --build
# Open http://localhost:8000
```

## Quick start (GitHub Codespaces, right after boot)

Use one of the two flows below. Flow A is recommended if you want it to work immediately after opening the Codespace.

### Flow A (recommended): run everything with Docker Compose

1. Open this repository in Codespaces.
2. Verify Docker is available:
   ```bash
   docker --version
   ```
   If you see "docker: command not found", rebuild the Codespace container once and retry.
3. Create an env file:
   ```bash
   cp .env.example .env
   ```
4. Fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.
5. Start the app:
   ```bash
   docker compose up --build
   ```
6. Open forwarded port 8000.

Notes:
- This flow does not require installing Python packages in .venv.
- Frontend is built into backend/static during Docker build, so port 5173 is not needed.

### Flow B (optional): run backend/frontend directly in the Codespace shell

Use this only if you want live frontend dev server behavior.

1. Create and activate a virtual environment:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```
2. Install backend dependencies:
   ```bash
   pip install -r backend/requirements.txt
   ```
3. Start backend (terminal 1, from repo root):
   ```bash
   python -m uvicorn backend.main:app --reload --port 8000
   ```
4. Start frontend (terminal 2):
   ```bash
   cd frontend && npm ci && npm run dev
   ```
5. Open forwarded port 5173 for UI and 8000 for API/docs.

Common pitfall:
- If you see "No module named uvicorn", you are running shell mode without installing backend requirements into the active .venv.

## Google Drive setup

1. Go to console.cloud.google.com → New project
2. Enable "Google Drive API"
3. OAuth consent screen → External → add your email as test user
4. Credentials → OAuth 2.0 Client ID → Web application
5. Add authorized redirect URI: http://localhost:8000/auth/callback (or your Codespaces URL)
6. Copy Client ID and Secret into .env

## Workflow

1. Connect Google Drive (or drag-and-drop files)
2. Load a reference sequence (FASTA or GenBank)
3. Load annotation file (BED, GFF3, or GenBank features auto-extracted)
4. Load one or more query sequences
5. Select reference + queries → click Compare
6. Inspect mutations in the genome viewer, mutation table, and alignment view
7. Export mutation table as CSV

## Supported formats

| Format | Sequences | Annotations |
|--------|-----------|-------------|
| FASTA (.fa, .fasta, .fna) | ✅ | — |
| GenBank (.gb, .gbk) | ✅ | ✅ (features auto-extracted) |
| FASTQ (.fastq, .fq) | ✅ | — |
| GFF3 (.gff, .gff3) | — | ✅ |
| BED (.bed) | — | ✅ |
