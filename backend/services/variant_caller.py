from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path

from backend.models.schemas import Annotation, IsolateResult, VariantRecord

logger = logging.getLogger(__name__)


def _which_required(tool: str) -> str:
    path = shutil.which(tool)
    if not path:
        raise RuntimeError(f"{tool!r} not found in PATH — please install it")
    return path


def _parse_vcf(vcf_path: str) -> list[VariantRecord]:
    """Parse a VCF file into a list of VariantRecord objects."""
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
                alts = alt.split(",")
                for a in alts:
                    if a == ".":
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


def call_variants_medaka(
    fastq_path: str,
    reference_path: str,
    output_dir: str,
    isolate_name: str,
    medaka_model: str = "r941_min_high_g360",
) -> IsolateResult:
    """Align a FASTQ to the reference with minimap2 and call variants with medaka.

    Returns an IsolateResult with the BAM file path and called variants.
    Raises RuntimeError if required tools are missing or a subprocess fails.
    """
    work_dir = Path(output_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    sam_file = str(work_dir / "aligned.sam")
    unsorted_bam = str(work_dir / "aligned_unsorted.bam")
    sorted_bam = str(work_dir / f"{isolate_name}.bam")
    bai_file = sorted_bam + ".bai"

    # 1. Align with minimap2
    minimap2 = _which_required("minimap2")
    logger.info("Aligning %s with minimap2", isolate_name)
    result = subprocess.run(
        [minimap2, "-ax", "map-ont", reference_path, fastq_path, "-o", sam_file],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"minimap2 failed for {isolate_name}: {result.stderr.decode()}")

    # 2. Sort and index BAM with samtools
    samtools = _which_required("samtools")
    logger.info("Converting SAM to sorted BAM for %s", isolate_name)
    result = subprocess.run(
        [samtools, "view", "-bS", sam_file, "-o", unsorted_bam],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"samtools view failed for {isolate_name}: {result.stderr.decode()}")

    result = subprocess.run(
        [samtools, "sort", unsorted_bam, "-o", sorted_bam],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"samtools sort failed for {isolate_name}: {result.stderr.decode()}")

    result = subprocess.run(
        [samtools, "index", sorted_bam],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"samtools index failed for {isolate_name}: {result.stderr.decode()}")

    # Clean up intermediate files
    try:
        os.unlink(sam_file)
        os.unlink(unsorted_bam)
    except OSError:
        pass

    # 3. Call variants with medaka (optional — degrade gracefully if not installed)
    variants: list[VariantRecord] = []
    medaka_haploid_variant = shutil.which("medaka_haploid_variant")
    if medaka_haploid_variant:
        medaka_dir = str(work_dir / "medaka")
        logger.info("Running medaka variant calling for %s", isolate_name)
        result = subprocess.run(
            [
                medaka_haploid_variant,
                "-i", fastq_path,
                "-r", reference_path,
                "-o", medaka_dir,
                "-m", medaka_model,
                "-t", "2",
            ],
            capture_output=True,
        )
        if result.returncode != 0:
            logger.warning("medaka failed for %s: %s", isolate_name, result.stderr.decode())
        else:
            for candidate in (
                os.path.join(medaka_dir, "medaka.annotated.vcf"),
                os.path.join(medaka_dir, "medaka.vcf"),
            ):
                if os.path.exists(candidate):
                    variants = _parse_vcf(candidate)
                    break
    else:
        logger.warning("medaka_haploid_variant not found — skipping variant calling for %s", isolate_name)

    return IsolateResult(
        name=isolate_name,
        bam_file=os.path.basename(sorted_bam),
        variants=variants,
    )


def assemble_consensus_medaka(
    fastq_path: str,
    reference_path: str,
    output_dir: str,
    medaka_model: str = "r941_min_high_g360",
) -> tuple[str, str]:
    """Generate consensus FASTA from ONT reads using medaka consensus workflow.

    Pipeline:
    1. minimap2: Align FASTQ to reference → SAM
    2. samtools: Convert SAM → BAM, sort, index
    3. medaka consensus: Generate consensus HDF from BAM
    4. medaka stitch: Combine HDF + reference → consensus FASTA

    Args:
        fastq_path: Path to ONT reads (FASTQ or FASTQ.gz)
        reference_path: Path to reference genome (FASTA)
        output_dir: Working directory for intermediate files
        medaka_model: Medaka basecalling model (default: r941_min_high_g360)

    Returns:
        (consensus_fasta_path, sorted_bam_path) tuple

    Raises:
        RuntimeError: If required tools are missing or subprocess fails
    """
    work_dir = Path(output_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    sam_file = str(work_dir / "aligned.sam")
    unsorted_bam = str(work_dir / "aligned_unsorted.bam")
    sorted_bam = str(work_dir / "aligned.bam")
    consensus_hdf = str(work_dir / "consensus.hdf")
    consensus_fasta = str(work_dir / "consensus.fasta")

    # 1. Align with minimap2
    minimap2 = _which_required("minimap2")
    logger.info("Aligning reads with minimap2")
    result = subprocess.run(
        [minimap2, "-ax", "map-ont", reference_path, fastq_path, "-o", sam_file],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"minimap2 failed: {result.stderr.decode()}")

    # 2. Convert to sorted BAM
    samtools = _which_required("samtools")
    logger.info("Converting to sorted BAM")
    subprocess.run([samtools, "view", "-bS", sam_file, "-o", unsorted_bam], check=True, capture_output=True)
    subprocess.run([samtools, "sort", unsorted_bam, "-o", sorted_bam], check=True, capture_output=True)
    subprocess.run([samtools, "index", sorted_bam], check=True, capture_output=True)

    # Clean up SAM and unsorted BAM
    os.unlink(sam_file)
    os.unlink(unsorted_bam)

    # 3. Medaka consensus
    medaka_consensus_cmd = _which_required("medaka_consensus")
    logger.info("Running medaka consensus")
    result = subprocess.run(
        [medaka_consensus_cmd, sorted_bam, consensus_hdf, "-m", medaka_model, "-t", "2"],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"medaka_consensus failed: {result.stderr.decode()}")

    # 4. Medaka stitch
    medaka_stitch = _which_required("medaka_stitch")
    logger.info("Stitching consensus FASTA")
    result = subprocess.run(
        [medaka_stitch, consensus_hdf, reference_path, consensus_fasta],
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"medaka_stitch failed: {result.stderr.decode()}")

    return (consensus_fasta, sorted_bam)


def annotate_variants(
    variants: list[VariantRecord],
    feature_hits: list[Annotation],
) -> list[VariantRecord]:
    """Enrich each variant with the name of the feature it falls within, if any."""
    annotated: list[VariantRecord] = []
    for variant in variants:
        in_feature: str | None = None
        for hit in feature_hits:
            if hit.start <= variant.position <= hit.end:
                in_feature = hit.name
                break
        annotated.append(variant.model_copy(update={"in_feature": in_feature}))
    return annotated


def summarize_across_isolates(isolates: list[IsolateResult]) -> dict:
    """Build a cross-isolate summary: which positions have variants and in how many isolates."""
    position_counts: dict[int, list[str]] = {}
    for iso in isolates:
        for variant in iso.variants:
            position_counts.setdefault(variant.position, []).append(iso.name)

    hotspots = sorted(
        [
            {
                "position": pos,
                "isolates": names,
                "count": len(names),
            }
            for pos, names in position_counts.items()
        ],
        key=lambda x: -x["count"],
    )

    return {
        "total_isolates": len(isolates),
        "isolates_with_variants": sum(1 for iso in isolates if iso.variants),
        "total_variant_positions": len(position_counts),
        "shared_variants": [h for h in hotspots if h["count"] > 1],
        "hotspots": hotspots[:20],
    }
