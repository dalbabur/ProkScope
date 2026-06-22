from __future__ import annotations

import logging

import mappy
import parasail

from backend.models.schemas import Annotation, BatchComparisonResult, ComparisonResult, Mutation

logger = logging.getLogger(__name__)

# Sequences longer than this (bp) skip parasail entirely and use mappy,
# which handles megabase-scale sequences without blowing up memory.
_PARASAIL_MAX_LEN = 50_000


def _parse_cigar(cigar_str: str, ref_seq: str, query_seq: str) -> tuple[str, str, list[Mutation]]:
    """Expand a mappy CIGAR string into aligned ref/query strings and call mutations."""
    import re
    ops = re.findall(r"(\d+)([MIDNSHP=X])", cigar_str)

    aligned_ref: list[str] = []
    aligned_query: list[str] = []
    mutations: list[Mutation] = []
    ref_pos = 0
    query_pos = 0
    genome_pos = 0  # 1-based position in ref for mutation reporting

    for length_str, op in ops:
        n = int(length_str)
        if op in ("M", "=", "X"):  # match or mismatch
            for i in range(n):
                r = ref_seq[ref_pos + i].upper()
                q = query_seq[query_pos + i].upper()
                aligned_ref.append(r)
                aligned_query.append(q)
                genome_pos += 1
                if r != q:
                    mutations.append(Mutation(position=genome_pos, ref=r, alt=q, type="SNP"))
            ref_pos += n
            query_pos += n
        elif op == "I":  # insertion in query
            for i in range(n):
                aligned_ref.append("-")
                aligned_query.append(query_seq[query_pos + i].upper())
                mutations.append(Mutation(position=max(genome_pos, 1), ref="-", alt=query_seq[query_pos + i].upper(), type="insertion"))
            query_pos += n
        elif op in ("D", "N"):  # deletion from query
            for i in range(n):
                r = ref_seq[ref_pos + i].upper()
                aligned_ref.append(r)
                aligned_query.append("-")
                genome_pos += 1
                mutations.append(Mutation(position=genome_pos, ref=r, alt="-", type="deletion"))
            ref_pos += n
        elif op in ("S", "H"):  # soft/hard clip — consume query only
            query_pos += n

    return "".join(aligned_ref), "".join(aligned_query), mutations


def _align_with_mappy(ref_seq: str, query_seq: str) -> ComparisonResult:
    """Use minimap2 (via mappy) for long-sequence alignment with CIGAR traceback."""
    aligner = mappy.Aligner(seq=ref_seq, preset="asm5", best_n=1)
    hits = list(aligner.map(query_seq))

    if not hits:
        # No hit — return zero-identity result with no mutations
        logger.warning("mappy found no alignment hits; returning zero-identity result")
        return ComparisonResult(
            reference_id="reference",
            query_id="query",
            identity=0.0,
            alignment_score=0.0,
            mutations=[],
            aligned_ref="",
            aligned_query="",
        )

    hit = hits[0]  # best hit
    # hit.cigar_str is relative to the aligned region; slice ref to that region
    ref_slice = ref_seq[hit.r_st:hit.r_en]
    query_slice = query_seq[hit.q_st:hit.q_en]

    aligned_ref, aligned_query, mutations = _parse_cigar(hit.cigar_str, ref_slice, query_slice)

    # Adjust mutation positions to be relative to full reference (hit.r_st is 0-based)
    offset = hit.r_st
    for m in mutations:
        m.position += offset

    # mappy reports mismatches+indels in NM; identity from blen (alignment block length)
    matches = hit.blen - hit.NM if hasattr(hit, "blen") and hasattr(hit, "NM") else 0
    alignment_len = hit.blen if hasattr(hit, "blen") and hit.blen else len(aligned_ref)
    identity = (matches / alignment_len * 100.0) if alignment_len else 0.0

    return ComparisonResult(
        reference_id="reference",
        query_id="query",
        identity=round(identity, 4),
        alignment_score=float(hit.mapq),
        mutations=mutations,
        aligned_ref=aligned_ref,
        aligned_query=aligned_query,
    )


def _align_with_parasail(ref_seq: str, query_seq: str) -> ComparisonResult:
    """Try parasail SW with traceback, falling back through lower-memory variants."""
    matrix = parasail.dnafull

    # Try progressively less memory-intensive variants.
    # _trace_ variants allocate the full DP matrix for traceback.
    # 32→16→8 bit reduces memory footprint 2× each step.
    attempts = [
        ("sw_trace_striped_32", lambda: parasail.sw_trace_striped_32(query_seq, ref_seq, 3, 1, matrix)),
        ("sw_trace_striped_16", lambda: parasail.sw_trace_striped_16(query_seq, ref_seq, 3, 1, matrix)),
        ("sw_trace_striped_8",  lambda: parasail.sw_trace_striped_8(query_seq, ref_seq, 3, 1, matrix)),
        ("sw_trace_scan_32",    lambda: parasail.sw_trace_scan_32(query_seq, ref_seq, 3, 1, matrix)),
        ("sw_trace_scan_16",    lambda: parasail.sw_trace_scan_16(query_seq, ref_seq, 3, 1, matrix)),
    ]

    for name, fn in attempts:
        try:
            result = fn()
            if result is None:
                logger.warning("%s returned None, trying next variant", name)
                continue
            traceback = result.traceback
            aligned_ref = traceback.ref
            aligned_query = traceback.query
            break
        except (AttributeError, MemoryError, Exception) as exc:
            logger.warning("%s failed (%s), trying next variant", name, exc)
            continue
    else:
        # All parasail variants failed — fall back to mappy
        logger.warning("All parasail variants failed; falling back to mappy for this sequence pair")
        return _align_with_mappy(ref_seq, query_seq)

    ref_pos = 0
    matches = 0
    alignment_len = 0
    mutations: list[Mutation] = []

    for ref_base, query_base in zip(aligned_ref, aligned_query):
        if ref_base != "-":
            ref_pos += 1
        if ref_base != "-" and query_base != "-":
            alignment_len += 1
            if ref_base == query_base:
                matches += 1
            else:
                mutations.append(Mutation(position=ref_pos, ref=ref_base, alt=query_base, type="SNP"))
        elif ref_base == "-" and query_base != "-":
            mutations.append(Mutation(position=max(ref_pos, 1), ref="-", alt=query_base, type="insertion"))
        elif ref_base != "-" and query_base == "-":
            alignment_len += 1
            mutations.append(Mutation(position=ref_pos, ref=ref_base, alt="-", type="deletion"))

    identity = (matches / alignment_len * 100.0) if alignment_len else 0.0
    return ComparisonResult(
        reference_id="reference",
        query_id="query",
        identity=round(identity, 4),
        alignment_score=float(result.score),
        mutations=mutations,
        aligned_ref=aligned_ref,
        aligned_query=aligned_query,
    )


def align_pair(ref_seq: str, query_seq: str) -> ComparisonResult:
    """Align two sequences, choosing the right backend based on length.

    - Short sequences (≤50 kbp): parasail Smith-Waterman with traceback,
      falling back through lower-memory variants automatically.
    - Long sequences (>50 kbp): mappy (minimap2 bindings) with asm5 preset,
      which is designed for comparing two similar assemblies.
    """
    max_len = max(len(ref_seq), len(query_seq))
    if max_len > _PARASAIL_MAX_LEN:
        logger.info("Sequences are %d bp; using mappy (minimap2) instead of parasail", max_len)
        return _align_with_mappy(ref_seq, query_seq)
    return _align_with_parasail(ref_seq, query_seq)


def align_batch(ref_seq: str, queries: list[tuple[str, str]]) -> BatchComparisonResult:
    results: list[ComparisonResult] = []

    for query_id, query_seq in queries:
        pair_result = align_pair(ref_seq, query_seq)
        pair_result.reference_id = "reference"
        pair_result.query_id = query_id
        results.append(pair_result)

    avg_identity = sum(item.identity for item in results) / len(results) if results else 0.0
    summary = {"total_sequences": len(results), "avg_identity": round(avg_identity, 4)}
    return BatchComparisonResult(results=results, summary=summary)


def annotate_mutations(mutations: list[Mutation], annotations: list[Annotation]) -> list[Mutation]:
    updated: list[Mutation] = []
    for mut in mutations:
        mut.in_feature = next((ann.name for ann in annotations if ann.start <= mut.position <= ann.end), None)
        updated.append(mut)
    return updated