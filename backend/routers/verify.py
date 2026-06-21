from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

from backend.models.schemas import (
    Annotation,
    JobStatus,
    Mutation,
    QualityMetrics,
    VerifyResult,
)
from backend.services import aligner, parser, variant_caller

logger = logging.getLogger(__name__)
router = APIRouter()

_jobs: dict[str, JobStatus] = {}
_job_metadata: dict[str, dict] = {}  # Maps job_id -> {output_dir: str, ...}


def _validate_output_dir(output_dir: str) -> None:
    """Validate that output directory exists and is writable."""
    path = Path(output_dir)
    if not path.exists():
        raise HTTPException(400, f"Output directory does not exist: {output_dir}")
    if not path.is_dir():
        raise HTTPException(400, f"Output path is not a directory: {output_dir}")
    if not os.access(output_dir, os.W_OK):
        raise HTTPException(400, f"Output directory is not writable: {output_dir}")


def _run_compare_assembly_job(
    job_id: str,
    reference_path: str,
    assembly_path: str,
    output_dir: str,
) -> None:
    """Background worker for Mode 1: Compare assembly to reference."""
    _jobs[job_id] = JobStatus(job_id=job_id, status="running")
    try:
        # Parse both sequence files
        ref_records = parser.parse_sequence_file(
            Path(reference_path).read_bytes(),
            os.path.basename(reference_path),
        )
        asm_records = parser.parse_sequence_file(
            Path(assembly_path).read_bytes(),
            os.path.basename(assembly_path),
        )

        if not ref_records or not asm_records:
            raise RuntimeError("Failed to parse reference or assembly file")

        # Align sequences
        result = aligner.align_pair(ref_records[0].sequence, asm_records[0].sequence)

        # Convert mutations to Mutation objects
        mutations = [
            Mutation(
                position=m["position"],
                ref=m["ref"],
                alt=m["alt"],
                type=m["type"],
            )
            for m in result["mutations"]
        ]

        # Calculate quality metrics
        metrics = QualityMetrics(
            identity_percent=result["identity"],
            total_mutations=len(mutations),
            snps=sum(1 for m in mutations if m.type == "SNP"),
            insertions=sum(1 for m in mutations if m.type == "insertion"),
            deletions=sum(1 for m in mutations if m.type == "deletion"),
        )

        # Create result
        verify_result = VerifyResult(
            job_id=job_id,
            mode="compare",
            quality_metrics=metrics,
            mutations=mutations,
            alignment=result["alignment"],
            reference_name=ref_records[0].id,
            assembly_or_reads_name=asm_records[0].id,
        )

        # Write result to output directory
        result_path = os.path.join(output_dir, f"verify_result_{job_id}.json")
        with open(result_path, "w") as f:
            json.dump(verify_result.model_dump(), f, indent=2)

        _jobs[job_id] = JobStatus(job_id=job_id, status="done")
        logger.info("Compare assembly job %s completed successfully", job_id)

    except Exception as exc:
        logger.exception("Compare assembly job %s failed", job_id)
        _jobs[job_id] = JobStatus(job_id=job_id, status="error", error=str(exc))
    finally:
        # Clean up temporary input files
        try:
            os.unlink(reference_path)
            os.unlink(assembly_path)
        except OSError:
            pass


def _calculate_coverage(bam_path: str) -> float | None:
    """Calculate average coverage from BAM file using samtools depth."""
    try:
        samtools = shutil.which("samtools")
        if not samtools:
            return None

        import subprocess

        result = subprocess.run(
            [samtools, "depth", bam_path],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return None

        # Parse depth output: chrom, position, depth
        depths = []
        for line in result.stdout.strip().split("\n"):
            if line:
                parts = line.split("\t")
                if len(parts) >= 3:
                    depths.append(int(parts[2]))

        if depths:
            return sum(depths) / len(depths)
        return None

    except Exception as exc:
        logger.warning("Failed to calculate coverage: %s", exc)
        return None


def _run_assemble_consensus_job(
    job_id: str,
    reference_path: str,
    fastq_path: str,
    output_dir: str,
    medaka_model: str,
) -> None:
    """Background worker for Mode 2: Assemble consensus from ONT reads."""
    _jobs[job_id] = JobStatus(job_id=job_id, status="running")
    temp_work_dir = None

    try:
        # Create temporary working directory
        temp_work_dir = os.path.join(tempfile.gettempdir(), f"prokscope_{job_id}")
        os.makedirs(temp_work_dir, exist_ok=True)

        # Run medaka consensus assembly
        logger.info("Starting medaka consensus assembly for job %s", job_id)
        consensus_fasta, bam_path = variant_caller.assemble_consensus_medaka(
            fastq_path=fastq_path,
            reference_path=reference_path,
            output_dir=temp_work_dir,
            medaka_model=medaka_model,
        )

        # Parse reference and consensus sequences
        ref_records = parser.parse_sequence_file(
            Path(reference_path).read_bytes(),
            os.path.basename(reference_path),
        )
        consensus_records = parser.parse_sequence_file(
            Path(consensus_fasta).read_bytes(),
            os.path.basename(consensus_fasta),
        )

        if not ref_records or not consensus_records:
            raise RuntimeError("Failed to parse reference or consensus file")

        # Compare consensus vs reference
        logger.info("Comparing consensus vs reference for job %s", job_id)
        result = aligner.align_pair(ref_records[0].sequence, consensus_records[0].sequence)

        # Convert mutations to Mutation objects
        mutations = [
            Mutation(
                position=m["position"],
                ref=m["ref"],
                alt=m["alt"],
                type=m["type"],
            )
            for m in result["mutations"]
        ]

        # Calculate coverage
        coverage = _calculate_coverage(bam_path)

        # Calculate quality metrics
        metrics = QualityMetrics(
            identity_percent=result["identity"],
            coverage_percent=coverage,
            total_mutations=len(mutations),
            snps=sum(1 for m in mutations if m.type == "SNP"),
            insertions=sum(1 for m in mutations if m.type == "insertion"),
            deletions=sum(1 for m in mutations if m.type == "deletion"),
        )

        # Copy output files to user's output directory
        final_consensus = os.path.join(output_dir, "consensus.fasta")
        final_bam = os.path.join(output_dir, "aligned.bam")
        final_bai = os.path.join(output_dir, "aligned.bam.bai")

        shutil.copy2(consensus_fasta, final_consensus)
        shutil.copy2(bam_path, final_bam)
        if os.path.exists(bam_path + ".bai"):
            shutil.copy2(bam_path + ".bai", final_bai)

        # Create result
        verify_result = VerifyResult(
            job_id=job_id,
            mode="assemble",
            quality_metrics=metrics,
            mutations=mutations,
            alignment=result["alignment"],
            consensus_fasta_path=final_consensus,
            bam_file=os.path.basename(final_bam),
            reference_name=ref_records[0].id,
            assembly_or_reads_name=os.path.basename(fastq_path),
        )

        # Write result to output directory
        result_path = os.path.join(output_dir, f"verify_result_{job_id}.json")
        with open(result_path, "w") as f:
            json.dump(verify_result.model_dump(), f, indent=2)

        _jobs[job_id] = JobStatus(job_id=job_id, status="done")
        logger.info("Assemble consensus job %s completed successfully", job_id)

    except Exception as exc:
        logger.exception("Assemble consensus job %s failed", job_id)
        _jobs[job_id] = JobStatus(job_id=job_id, status="error", error=str(exc))
    finally:
        # Clean up temporary input files and working directory
        try:
            os.unlink(reference_path)
            os.unlink(fastq_path)
        except OSError:
            pass

        if temp_work_dir and os.path.exists(temp_work_dir):
            try:
                shutil.rmtree(temp_work_dir)
            except OSError:
                pass


@router.post("/compare-assembly", response_model=dict)
async def compare_assembly(
    background_tasks: BackgroundTasks,
    reference: UploadFile = File(...),
    assembly: UploadFile = File(...),
    output_dir: str = Form(...),
) -> dict:
    """Mode 1: Compare Plasmidsaurus assembly to reference.

    Returns job_id for status polling.

    Workflow:
    1. Parse both files (support FASTA/GenBank)
    2. Run aligner.align_pair() for sequence comparison
    3. Calculate quality metrics (identity %, mutation counts)
    4. Write result JSON to user-specified output_dir
    """
    # Validate output directory
    _validate_output_dir(output_dir)

    # Generate job ID
    job_id = str(uuid.uuid4())

    # Save uploaded files to temporary locations
    temp_dir = tempfile.mkdtemp(prefix=f"prokscope_verify_{job_id}_")
    reference_path = os.path.join(temp_dir, reference.filename or "reference")
    assembly_path = os.path.join(temp_dir, assembly.filename or "assembly")

    with open(reference_path, "wb") as f:
        f.write(await reference.read())
    with open(assembly_path, "wb") as f:
        f.write(await assembly.read())

    # Store job metadata
    _jobs[job_id] = JobStatus(job_id=job_id, status="pending")
    _job_metadata[job_id] = {"output_dir": output_dir, "mode": "compare"}

    # Launch background task
    background_tasks.add_task(
        _run_compare_assembly_job,
        job_id,
        reference_path,
        assembly_path,
        output_dir,
    )

    return {"job_id": job_id}


@router.post("/assemble-consensus", response_model=dict)
async def assemble_consensus(
    background_tasks: BackgroundTasks,
    reference: UploadFile = File(...),
    fastq: UploadFile = File(...),
    output_dir: str = Form(...),
    medaka_model: str = Form("r941_min_high_g360"),
) -> dict:
    """Mode 2: Assemble consensus from ONT reads.

    Returns job_id for status polling.

    Workflow:
    1. Save reference and FASTQ to temp processing location
    2. Run variant_caller.assemble_consensus_medaka():
       - minimap2 alignment
       - samtools sort/index
       - medaka consensus + stitch
    3. Compare consensus.fasta vs reference
    4. Write consensus.fasta, BAM, BAI, result.json to output_dir
    """
    # Validate output directory
    _validate_output_dir(output_dir)

    # Generate job ID
    job_id = str(uuid.uuid4())

    # Save uploaded files to temporary locations
    temp_dir = tempfile.mkdtemp(prefix=f"prokscope_verify_{job_id}_")
    reference_path = os.path.join(temp_dir, reference.filename or "reference")
    fastq_path = os.path.join(temp_dir, fastq.filename or "reads.fastq")

    with open(reference_path, "wb") as f:
        f.write(await reference.read())
    with open(fastq_path, "wb") as f:
        f.write(await fastq.read())

    # Store job metadata
    _jobs[job_id] = JobStatus(job_id=job_id, status="pending")
    _job_metadata[job_id] = {"output_dir": output_dir, "mode": "assemble"}

    # Launch background task
    background_tasks.add_task(
        _run_assemble_consensus_job,
        job_id,
        reference_path,
        fastq_path,
        output_dir,
        medaka_model,
    )

    return {"job_id": job_id}


@router.get("/status/{job_id}", response_model=JobStatus)
async def get_status(job_id: str) -> JobStatus:
    """Poll job status (pending, running, done, error)."""
    if job_id not in _jobs:
        raise HTTPException(404, "Job not found")
    return _jobs[job_id]


@router.get("/result/{job_id}", response_model=VerifyResult)
async def get_result(job_id: str) -> VerifyResult:
    """Fetch completed job result."""
    if job_id not in _jobs:
        raise HTTPException(404, "Job not found")

    job_status = _jobs[job_id]
    if job_status.status != "done":
        raise HTTPException(400, f"Job not completed yet. Status: {job_status.status}")

    # Load result from output directory
    if job_id not in _job_metadata:
        raise HTTPException(404, "Job metadata not found")

    output_dir = _job_metadata[job_id]["output_dir"]
    result_path = os.path.join(output_dir, f"verify_result_{job_id}.json")

    if not os.path.exists(result_path):
        raise HTTPException(404, f"Result file not found: {result_path}")

    with open(result_path) as f:
        data = json.load(f)

    return VerifyResult(**data)


@router.get("/files/{job_id}/{filename}")
async def serve_file(request: Request, job_id: str, filename: str) -> FileResponse:
    """Serve files for IGV visualization (FASTA, FAI, BAM, BAI).

    Supports HTTP Range requests for streaming large BAM files.
    """
    # Validate job exists
    if job_id not in _job_metadata:
        raise HTTPException(404, "Job not found")

    # Validate filename (no path traversal)
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")

    # Get output directory from job metadata
    output_dir = _job_metadata[job_id]["output_dir"]
    file_path = os.path.join(output_dir, filename)

    # Validate file exists
    if not os.path.exists(file_path):
        raise HTTPException(404, f"File not found: {filename}")

    # Determine media type
    media_type = "application/octet-stream"
    if filename.endswith(".fasta") or filename.endswith(".fa"):
        media_type = "text/plain"
    elif filename.endswith(".bam"):
        media_type = "application/octet-stream"
    elif filename.endswith(".bai"):
        media_type = "application/octet-stream"
    elif filename.endswith(".fai"):
        media_type = "text/plain"

    # Return file with Range support for BAM files
    return FileResponse(
        file_path,
        media_type=media_type,
        filename=filename,
    )
