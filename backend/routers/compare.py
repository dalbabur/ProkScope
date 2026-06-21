from __future__ import annotations

import json
import logging
import os
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from backend.models.schemas import Annotation, CompareResult, IsolateResult, JobStatus
from backend.services import feature_db as fdb
from backend.services import parser, variant_caller

logger = logging.getLogger(__name__)
router = APIRouter()

_JOBS_BASE = os.environ.get("PROKSCOPE_JOBS_DIR", os.path.join(tempfile.gettempdir(), "prokscope_jobs"))
_jobs: dict[str, JobStatus] = {}


def _job_dir(job_id: str) -> str:
    return os.path.join(_JOBS_BASE, job_id)


def _run_compare_job(
    job_id: str,
    reference_path: str,
    reference_name: str,
    isolate_paths: list[tuple[str, str]],  # [(fastq_path, isolate_name), ...]
    medaka_model: str,
    feature_ids: list[str] | None,
    max_mismatches: int,
) -> None:
    """Background worker: run full compare pipeline and write result.json."""
    _jobs[job_id] = JobStatus(job_id=job_id, status="running")
    job_dir = _job_dir(job_id)
    result_path = os.path.join(job_dir, "result.json")

    try:
        # 1. Call variants for each isolate in parallel
        isolate_results: list[IsolateResult] = []
        errors: list[str] = []

        def _call_one(item: tuple[str, str]) -> IsolateResult | None:
            fastq_path, isolate_name = item
            iso_output_dir = os.path.join(job_dir, isolate_name)
            try:
                result = variant_caller.call_variants_medaka(
                    fastq_path=fastq_path,
                    reference_path=reference_path,
                    output_dir=iso_output_dir,
                    isolate_name=isolate_name,
                    medaka_model=medaka_model,
                )
                # Copy BAM/BAI to job root for easy serving
                if result.bam_file:
                    src_bam = os.path.join(iso_output_dir, result.bam_file)
                    dst_bam = os.path.join(job_dir, result.bam_file)
                    bai_src = src_bam + ".bai"
                    bai_dst = dst_bam + ".bai"
                    if os.path.exists(src_bam) and src_bam != dst_bam:
                        import shutil as _shutil
                        _shutil.copy2(src_bam, dst_bam)
                        if os.path.exists(bai_src):
                            _shutil.copy2(bai_src, bai_dst)
                return result
            except Exception as exc:
                errors.append(f"{isolate_name}: {exc}")
                logger.exception("Variant calling failed for %s", isolate_name)
                return IsolateResult(name=isolate_name, variants=[])

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(_call_one, isolate_paths))
        isolate_results = [r for r in results if r is not None]

        # 2. Find features in reference genome
        feature_hits: list[Annotation] = []
        try:
            records = parser.parse_sequence_file(
                Path(reference_path).read_bytes(), os.path.basename(reference_path)
            )
            if records:
                db = fdb.get_db()
                feature_hits = db.find_in_genome(
                    records[0].sequence,
                    feature_ids=feature_ids,
                    max_mismatches=max_mismatches,
                )
        except FileNotFoundError:
            logger.info("Feature DB not loaded — skipping feature annotation in compare job %s", job_id)
        except Exception as exc:
            logger.warning("Feature search failed for job %s: %s", job_id, exc)

        # 3. Annotate variants with feature hits
        for iso in isolate_results:
            iso.variants = variant_caller.annotate_variants(iso.variants, feature_hits)

        # 4. Summarize across isolates
        summary = variant_caller.summarize_across_isolates(isolate_results)

        # 5. Write result.json
        compare_result = CompareResult(
            job_id=job_id,
            reference_name=reference_name,
            isolates=isolate_results,
            feature_hits=feature_hits,
            summary=summary,
        )
        Path(result_path).write_text(
            compare_result.model_dump_json(indent=2), encoding="utf-8"
        )

        if errors:
            summary["pipeline_errors"] = errors

        _jobs[job_id] = JobStatus(job_id=job_id, status="done")

    except Exception as exc:
        logger.exception("Compare job %s failed", job_id)
        _jobs[job_id] = JobStatus(job_id=job_id, status="error", error=str(exc))


@router.post("/run", response_model=JobStatus)
async def run_compare(
    background_tasks: BackgroundTasks,
    reference: UploadFile = File(...),
    isolates: list[UploadFile] = File(...),
    isolate_names: str = Form(default=""),
    medaka_model: str = Form(default="r941_min_high_g360"),
    feature_ids: str = Form(default=""),
    max_mismatches: int = Form(default=0),
) -> JobStatus:
    """Start a background compare job.

    Upload a reference (FASTA/GenBank) and one or more isolate FASTQ files.
    Returns a ``job_id`` immediately; poll ``/status/{job_id}`` for progress.
    """
    if not isolates:
        raise HTTPException(status_code=422, detail="At least one isolate file is required")
    if len(isolates) > 20:
        raise HTTPException(status_code=422, detail="At most 20 isolates are supported per run")
    if max_mismatches > 3:
        raise HTTPException(status_code=422, detail="max_mismatches must be <= 3")

    job_id = str(uuid.uuid4())
    job_dir = _job_dir(job_id)
    os.makedirs(job_dir, exist_ok=True)

    # Save reference
    ref_filename = reference.filename or "reference.fasta"
    ref_path = os.path.join(job_dir, ref_filename)
    Path(ref_path).write_bytes(await reference.read())

    # Parse isolate names
    names_list = [n.strip() for n in isolate_names.split(",") if n.strip()]
    isolate_paths: list[tuple[str, str]] = []
    for i, iso_file in enumerate(isolates):
        name = names_list[i] if i < len(names_list) else (iso_file.filename or f"isolate_{i + 1}")
        safe_name = name.replace("/", "_").replace("\\", "_").replace("..", "_")
        fastq_path = os.path.join(job_dir, f"{safe_name}.fastq")
        Path(fastq_path).write_bytes(await iso_file.read())
        isolate_paths.append((fastq_path, safe_name))

    fid_list: list[str] | None = [f.strip() for f in feature_ids.split(",") if f.strip()] or None

    _jobs[job_id] = JobStatus(job_id=job_id, status="pending")

    background_tasks.add_task(
        _run_compare_job,
        job_id=job_id,
        reference_path=ref_path,
        reference_name=os.path.splitext(ref_filename)[0],
        isolate_paths=isolate_paths,
        medaka_model=medaka_model,
        feature_ids=fid_list,
        max_mismatches=max_mismatches,
    )

    return _jobs[job_id]


@router.get("/status/{job_id}", response_model=JobStatus)
def get_status(job_id: str) -> JobStatus:
    """Poll the status of a compare job."""
    status = _jobs.get(job_id)
    if status is None:
        # Check if a result file exists (e.g. after server restart)
        result_path = os.path.join(_job_dir(job_id), "result.json")
        if os.path.exists(result_path):
            return JobStatus(job_id=job_id, status="done")
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    return status


@router.get("/result/{job_id}", response_model=CompareResult)
def get_result(job_id: str) -> CompareResult:
    """Retrieve the result of a completed compare job."""
    status = _jobs.get(job_id)
    if status is not None and status.status == "error":
        raise HTTPException(status_code=500, detail=status.error or "Job failed")
    if status is not None and status.status in ("pending", "running"):
        raise HTTPException(status_code=202, detail="Job is still running")

    result_path = os.path.join(_job_dir(job_id), "result.json")
    if not os.path.exists(result_path):
        raise HTTPException(status_code=404, detail=f"Result not found for job: {job_id}")

    try:
        data = json.loads(Path(result_path).read_text(encoding="utf-8"))
        return CompareResult(**data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not parse result: {exc}") from exc


@router.get("/files/{job_id}/{filename}")
async def serve_file(job_id: str, filename: str, request: Request) -> FileResponse:
    """Serve a BAM, BAI, or reference FASTA file for IGV.js.

    Supports HTTP ``Range`` requests for partial content streaming.
    """
    # Prevent path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = os.path.join(_job_dir(job_id), filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    media_type = "application/octet-stream"
    if filename.endswith(".bam"):
        media_type = "application/octet-stream"
    elif filename.endswith(".bai") or filename.endswith(".bam.bai"):
        media_type = "application/octet-stream"
    elif filename.endswith(".fasta") or filename.endswith(".fa") or filename.endswith(".fna"):
        media_type = "text/plain"
    elif filename.endswith(".fai"):
        media_type = "text/plain"

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=filename,
        headers={"Accept-Ranges": "bytes"},
    )
