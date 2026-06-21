# ProkScope

Lightweight web app for bacterial genome sequence parsing, annotation overlay, and mutation comparison.

## Quick start (Docker)

```bash
cp .env.example .env
# Fill in GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET
docker compose up --build
# Open http://localhost:5173 for the UI
# Backend API remains on http://localhost:8000
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
6. Open forwarded port 5173 for the UI.
7. Use forwarded port 8000 for the backend API/docs.

Notes:
- This flow does not require installing Python packages in .venv.
- The frontend runs as a Vite dev server on port 5173 and proxies API requests to the backend on port 8000.

### Flow B (optional): run backend/frontend directly in the Codespace shell

Use this only if you want live frontend dev server behavior.

Dependencies are installed automatically when the Codespace boots (`postCreateCommand`).

1. Start backend (terminal 1, from repo root):
   ```bash
   set -a; source .env; set +a
   python -m uvicorn backend.main:app --reload --port 8000 
   ```
2. Start frontend (terminal 2):
   ```bash
   npm run dev --prefix frontend -- --host 0.0.0.0 --strictPort
   ```
3. Open forwarded port 5173 for UI and 8000 for API/docs.

Common pitfall:
- If you see "No module named uvicorn", run `pip install -r backend/requirements.txt` and retry.

## Google Drive setup

1. Go to console.cloud.google.com → New project
2. Enable "Google Drive API"
3. OAuth consent screen → External → add your email as test user
4. Credentials → OAuth 2.0 Client ID → Web application
5. Add authorized redirect URI: http://localhost:8000/auth/callback (or your Codespaces URL)
6. Copy Client ID and Secret into .env

Note for Codespaces:
- The Google OAuth redirect URI must be the public backend URL on port 8000, not `localhost`.
- The frontend now auto-detects the backend origin from the current 5173 URL in Codespaces, but the OAuth client in Google still needs the matching 8000 redirect URI registered.

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

## Bioinformatics Tools

ProkScope requires the following bioinformatics tools for the **Verify/Assemble** workflow:

- **minimap2**: Long-read alignment tool for ONT reads
- **samtools**: SAM/BAM file manipulation
- **medaka**: Consensus sequence polishing and variant calling from ONT reads

### Automatic Installation (Recommended)

**Using Docker or Devcontainer**: All tools are installed automatically when you build the container.

**Manual Installation**: Run the provided installation script:
```bash
sudo bash install_tools.sh
```

This script will:
1. Install minimap2 and samtools via apt
2. Install medaka via pip
3. Verify all tools are working correctly

### Manual Installation (Alternative)

If you prefer to install manually:

```bash
# Update package list
sudo apt-get update

# Install minimap2 and samtools
sudo apt-get install -y minimap2 samtools

# Install medaka (Python package)
pip install medaka

# Verify installations
minimap2 --version
samtools --version
medaka --version
```

**Note**: The Dockerfile and devcontainer.json are pre-configured to install these tools automatically. You only need manual installation if running outside these environments.

## Verify/Assemble Workflow

The **Verify/Assemble** tab provides quality control and consensus assembly for prokaryotic genomes:

### Mode 1: Compare Assembly
Compare a Plasmidsaurus (or other) assembled genome against a reference to assess quality.

**Inputs**:
- Reference genome (FASTA or GenBank)
- Assembled genome (FASTA or GenBank)
- Output directory path

**Outputs**:
- Identity percentage
- Mutation table (SNPs, insertions, deletions)
- Quality metrics with color-coded indicators
- Alignment visualization
- IGV genome browser view

### Mode 2: Assemble from ONT Reads
Generate a polished consensus genome from raw Oxford Nanopore (ONT) reads.

**Inputs**:
- Reference genome (FASTA or GenBank)
- Raw ONT reads (FASTQ or FASTQ.gz)
- Output directory path
- Medaka basecalling model (e.g., r941_min_high_g360)

**Pipeline**:
1. Align reads to reference with minimap2
2. Convert and sort alignments with samtools
3. Generate consensus with medaka consensus
4. Stitch consensus sequence
5. Compare consensus vs reference

**Outputs**:
- Polished consensus genome (consensus.fasta)
- Alignment files (aligned.bam + aligned.bam.bai)
- Quality metrics (identity %, coverage %, mutations)
- IGV visualization with reference and alignment tracks
- JSON result file

### Usage

1. Navigate to the **Verify/Assemble** tab
2. Select workflow mode (Compare Assembly or Assemble from ONT Reads)
3. Upload reference genome and assembly/reads files
4. Specify output directory where results will be saved
5. (Mode 2 only) Select appropriate medaka model for your sequencing chemistry
6. Click **Run Workflow**
7. Monitor job progress (pending → running → done)
8. View quality metrics and explore results in IGV browser

**Quality Indicators**:
- ✓ Green: Identity ≥ 95% (good quality)
- ⚠ Red: Identity < 95% (may need re-assembly)
