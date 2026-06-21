from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path

from backend.models.schemas import Annotation, IsolateResult, VariantRecord

logger = logging.getLogger(__name__)


# ─── Checkpoint helpers ───────────────────────────────────────────────────────
# Each step writes a small sentinel file (.done_<step>) when it completes.
# On resume (e.g. after a crash or timeout), completed steps are skipped.

def _sentinel(work_dir: Path, step: str) -> Path:
    return work_dir / f".done_{step}"

def _is_done(work_dir: Path, step: str) -> bool:
    return _sentinel(work_dir, step).exists()

def _mark_done(work_dir: Path, step: str) -> None:
    _sentinel(work_dir, step).touch()

def _clear_done(work_dir: Path, step: str) -> None:
    """Remove a checkpoint so the step will re-run (used when cleaning up partial output)."""
    try:
        _sentinel(work_dir, step).unlink()
    except FileNotFoundError:
        pass


def _run(cmd: list[str], step: str) -> subprocess.CompletedProcess:
    """Run a subprocess; raise RuntimeError with stderr on non-zero exit."""
    logger.info("Step [%s]: %s", step, " ".join(cmd))
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        stderr = proc.stderr.decode(errors="replace")
        logger.error("Step [%s] failed (exit %d):\n%s", step, proc.returncode, stderr)
        raise RuntimeError(f"[{step}] failed (exit {proc.returncode}):\n{stderr}")
    return proc


def _which_required(tool: str) -> str:
    path = shutil.which(tool)
    if not path:
        raise RuntimeError(
            f"'{tool}' not found in PATH. "
            "Run install_tools.sh or rebuild the Docker container."
        )
    return path


def _parse_vcf(vcf_path: str) -> list[VariantRecord]:
    """Parse a VCF file into VariantRecord objects."""
    variants: list[VariantRecord] = []
    try:
        with open(vcf_path, encoding="utf-8") as fh:
            for line in fh:
                if line.startswith("#"):
                    continue
                parts = line.rstrip("\n").split("\t")
                if len(parts) < 5:
                    continue
                _, pos_str, _, ref, alt = parts[:5]
                try:
                    pos = int(pos_str)
                except ValueError:
                    continue
                for a in alt.split(","):
                    if a in (".", "*"):
                        continue
                    if len(ref) == len(a) == 1:
                        vtype = "SNP"
                    elif len(ref) > len(a):
                        vtype = "deletion"
                    else:
                        vtype = "insertion"
                    variants.append(VariantRecord(position=pos, ref=ref, alt=a, type=vtype))
    except OSError as exc:
        logger.warning("Could not read VCF %s: %s", vcf_path, exc)
    return variants


# ─── Step A: minimap2 → sorted BAM (shared, for IGV visualisation) ────────────

def _build_sorted_bam(
    fastq_path: str,
    reference_path: str,
    work_dir: Path,
    bam_name: str = "aligned.bam",
) -> str:
    """
    Align reads to reference with minimap2, sort and index with samtools.

    Checkpointed: skipped automatically if the BAM + BAI already exist.
    Returns the path to the sorted BAM.
    """
    sorted_bam = str(work_dir / bam_name)
    bai_file   = sorted_bam + ".bai"
    step_key   = f"bam_{bam_name}"

    if _is_done(work_dir, step_key) and Path(sorted_bam).exists() and Path(bai_file).exists():
        logger.info("Checkpoint: sorted BAM exists at %s — skipping alignment", sorted_bam)
        return sorted_bam

    minimap2 = _which_required("minimap2")
    samtools = _which_required("samtools")

    # Clean up any partial outputs from a previous failed run
    sam_file     = str(work_dir / "_tmp_aligned.sam")
    unsorted_bam = str(work_dir / "_tmp_unsorted.bam")
    for path in (sam_file, unsorted_bam, sorted_bam, bai_file):
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
    _clear_done(work_dir, step_key)

    _run([minimap2, "-ax", "map-ont", reference_path, fastq_path, "-o", sam_file], "minimap2")
    _run([samtools, "view", "-bS", sam_file, "-o", unsorted_bam], "samtools-view")
    _run([samtools, "sort", unsorted_bam, "-o", sorted_bam], "samtools-sort")
    _run([samtools, "index", sorted_bam], "samtools-index")

    for path in (sam_file, unsorted_bam):
        try:
            os.unlink(path)
        except OSError:
            pass

    _mark_done(work_dir, step_key)
    return sorted_bam


# ─── assemble_consensus_medaka ────────────────────────────────────────────────

def assemble_consensus_medaka(
    fastq_path: str,
    reference_path: str,
    output_dir: str,
    medaka_model: str = "r941_min_high_g360",
) -> tuple[str, str]:
    """
    Generate a polished consensus FASTA from raw ONT reads using Medaka 2.x.

    Workflow:
        FASTQ ──┬──→ minimap2 → sorted BAM + BAI   (saved to output_dir for IGV)
                │
                └──→ medaka_consensus               (Medaka 2.x shell script)
                          -i FASTQ                  (reads — medaka aligns internally)
                          -d reference.fasta
                          -o medaka_output/
                          -m model
                     → medaka_output/consensus.fasta  (copied to output_dir)

    Each step is checkpointed: re-running after a crash resumes from the last
    successful step without starting over.

    Args:
        fastq_path:     Path to ONT reads (FASTQ or FASTQ.gz).
        reference_path: Path to reference genome (FASTA).
        output_dir:     Working/output directory — BAM and consensus.fasta land here.
        medaka_model:   Medaka model name. Passed to -m; if blank, medaka auto-selects.

    Returns:
        (consensus_fasta_path, sorted_bam_path)
    """
    work_dir = Path(output_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    sorted_bam      = str(work_dir / "aligned.bam")
    medaka_out_dir  = work_dir / "medaka_output"
    consensus_fasta = str(work_dir / "consensus.fasta")

    # ── Step A: minimap2 → sorted BAM (for IGV) ───────────────────────────────
    sorted_bam = _build_sorted_bam(fastq_path, reference_path, work_dir, "aligned.bam")

    # ── Step B: medaka_consensus ───────────────────────────────────────────────
    #
    # Medaka 2.x usage:
    #   medaka_consensus -i <reads.fastq> -d <reference.fasta> -o <out_dir> [-m model] [-t threads]
    #
    # medaka_consensus runs its own internal minimap2 alignment; it does NOT
    # accept a pre-built BAM.  The BAM we built in Step A is only for IGV.
    #
    if _is_done(work_dir, "medaka_consensus") and Path(consensus_fasta).exists():
        logger.info("Checkpoint: consensus.fasta exists — skipping medaka_consensus")
    else:
        medaka = _which_required("medaka_consensus")

        # Remove any partial medaka output directory from a previous failed run
        if medaka_out_dir.exists():
            shutil.rmtree(medaka_out_dir)
        _clear_done(work_dir, "medaka_consensus")

        cmd = [
            medaka,
            "-i", fastq_path,
            "-d", reference_path,
            "-o", str(medaka_out_dir),
            "-t", "2",
            "--bacteria",
        ]
        # Only pass -m if a model was specified; omitting it lets medaka auto-detect.
        if medaka_model and medaka_model.strip():
            cmd += ["-m", medaka_model]

        _run(cmd, "medaka_consensus")

        # medaka_consensus writes consensus.fasta inside the output directory
        candidate = medaka_out_dir / "consensus.fasta"
        if not candidate.exists():
            contents = list(medaka_out_dir.iterdir()) if medaka_out_dir.exists() else []
            raise RuntimeError(
                f"medaka_consensus finished but consensus.fasta not found in "
                f"{medaka_out_dir}. Directory contents: {[p.name for p in contents]}"
            )

        shutil.copy2(str(candidate), consensus_fasta)
        _mark_done(work_dir, "medaka_consensus")

    return (consensus_fasta, sorted_bam)


# ─── call_variants_medaka ─────────────────────────────────────────────────────

def call_variants_medaka(
    fastq_path: str,
    reference_path: str,
    output_dir: str,
    isolate_name: str,
    medaka_model: str = "r941_min_high_g360",
) -> IsolateResult:
    """
    Align FASTQ to reference and call variants with medaka.

    Pipeline (checkpointed):
        FASTQ → minimap2 → sorted BAM + BAI
              → medaka_haploid_variant -i FASTQ -r reference -o medaka_dir -m model

    Returns an IsolateResult with the BAM path and called variants.
    """
    work_dir = Path(output_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    medaka_dir = str(work_dir / "medaka_variants")
    vcf_cache  = str(work_dir / "medaka_variants_cache.json")

    # ── Step A: alignment ─────────────────────────────────────────────────────
    sorted_bam = _build_sorted_bam(fastq_path, reference_path, work_dir, f"{isolate_name}.bam")

    # ── Step B: medaka variant calling ────────────────────────────────────────
    variants: list[VariantRecord] = []

    if _is_done(work_dir, "medaka_variants") and Path(vcf_cache).exists():
        logger.info("Checkpoint: medaka variants already called — loading cache")
        with open(vcf_cache) as fh:
            variants = [VariantRecord(**v) for v in json.load(fh)]
    else:
        medaka_haploid = shutil.which("medaka_haploid_variant")
        if medaka_haploid:
            if Path(medaka_dir).exists():
                shutil.rmtree(medaka_dir)
            _clear_done(work_dir, "medaka_variants")

            cmd = [
                medaka_haploid,
                "-i", fastq_path,
                "-r", reference_path,
                "-o", medaka_dir,
                "-t", "2",
            ]
            if medaka_model and medaka_model.strip():
                cmd += ["-m", medaka_model]

            try:
                _run(cmd, "medaka_haploid_variant")
                for candidate in (
                    os.path.join(medaka_dir, "medaka.annotated.vcf"),
                    os.path.join(medaka_dir, "medaka.vcf"),
                ):
                    if Path(candidate).exists():
                        variants = _parse_vcf(candidate)
                        break
            except RuntimeError as exc:
                logger.warning("medaka_haploid_variant failed — continuing without variants: %s", exc)

            # Cache so resume doesn't re-run medaka
            with open(vcf_cache, "w") as fh:
                json.dump([v.model_dump() for v in variants], fh)
            _mark_done(work_dir, "medaka_variants")
        else:
            logger.warning("medaka_haploid_variant not found — skipping variant calling for %s", isolate_name)

    return IsolateResult(
        name=isolate_name,
        bam_file=os.path.basename(sorted_bam),
        variants=variants,
    )


# ─── annotation helpers ───────────────────────────────────────────────────────

def annotate_variants(
    variants: list[VariantRecord],
    feature_hits: list[Annotation],
) -> list[VariantRecord]:
    """Enrich each variant with the name of the feature it falls within, if any."""
    annotated: list[VariantRecord] = []
    for variant in variants:
        in_feature = next(
            (hit.name for hit in feature_hits if hit.start <= variant.position <= hit.end),
            None,
        )
        annotated.append(variant.model_copy(update={"in_feature": in_feature}))
    return annotated


def summarize_across_isolates(isolates: list[IsolateResult]) -> dict:
    """Build a cross-isolate summary: mutation hotspots across isolates."""
    position_counts: dict[int, list[str]] = {}
    for iso in isolates:
        for variant in iso.variants:
            position_counts.setdefault(variant.position, []).append(iso.name)

    hotspots = sorted(
        [{"position": pos, "isolates": names, "count": len(names)} for pos, names in position_counts.items()],
        key=lambda x: -x["count"],
    )

    return {
        "total_isolates": len(isolates),
        "isolates_with_variants": sum(1 for iso in isolates if iso.variants),
        "total_variant_positions": len(position_counts),
        "shared_variants": [h for h in hotspots if h["count"] > 1],
        "hotspots": hotspots[:20],
    }