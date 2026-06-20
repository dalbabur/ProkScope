# Genomics Tool

Lightweight web app for bacterial genome sequence parsing, annotation overlay, and mutation comparison.

## Quick start (Docker)

```bash
cp .env.example .env
# Fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
docker compose up --build
# Open http://localhost:8000
```

## Quick start (GitHub Codespaces)

1. Open repo in Codespaces
2. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as Codespaces secrets
3. In two terminals:
   Terminal 1: cd backend && uvicorn main:app --reload --port 8000
   Terminal 2: cd frontend && npm run dev
4. Codespaces will auto-forward port 8000 and open the browser

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

## Feature database

prokscope can search any loaded genome for sequences from your parts library.

### Build the database
Put all your Benchling `.gb` exports in one folder, then run:

```bash
python build_feature_db.py --input ./plasmids --output feature_db.json
```

Re-run whenever you add new plasmid files. The script deduplicates features
across files automatically.

### Use in prokscope
1. Load a reference genome (FASTA or GenBank)
2. Open the **Feature Library** panel in the sidebar
3. Search or filter for features of interest
4. Select features and click **Find in Genome**
5. Hits appear as a colored track using the original Benchling colors

You can also upload a `feature_db.json` directly in the UI without restarting
the server.

### Environment variable
```
FEATURE_DB_PATH=./feature_db.json   # default; override if stored elsewhere
```

## Supported formats

| Format | Sequences | Annotations |
|--------|-----------|-------------|
| FASTA (.fa, .fasta, .fna) | ✅ | — |
| GenBank (.gb, .gbk) | ✅ | ✅ (features auto-extracted) |
| FASTQ (.fastq, .fq) | ✅ | — |
| GFF3 (.gff, .gff3) | — | ✅ |
| BED (.bed) | — | ✅ |
