from __future__ import annotations

from collections import defaultdict

import mappy
import parasail

from backend.models.schemas import Annotation, BatchComparisonResult, ComparisonResult, Mutation


def align_pair(ref_seq: str, query_seq: str) -> ComparisonResult:
    result = parasail.sw_trace_striped_32(query_seq, ref_seq, 3, 1, parasail.dnafull)
    traceback = result.traceback
    aligned_ref = traceback.ref
    aligned_query = traceback.query

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


def align_batch(ref_seq: str, queries: list[tuple[str, str]]) -> BatchComparisonResult:
    aligner = mappy.Aligner(seq=ref_seq, preset=None, k=15, w=10)
    results: list[ComparisonResult] = []

    for query_id, query_seq in queries:
        hits = list(aligner.map(query_seq)) if aligner else []
        pair_result = align_pair(ref_seq, query_seq)
        pair_result.reference_id = "reference"
        pair_result.query_id = query_id
        if not hits:
            pair_result.alignment_score = pair_result.alignment_score
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
