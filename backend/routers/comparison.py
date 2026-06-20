from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.models.schemas import Annotation, BatchComparisonResult, ComparisonResult, SequenceRecord
from backend.services import aligner

router = APIRouter()


class PairwiseRequest(BaseModel):
    reference: SequenceRecord
    query: SequenceRecord
    annotations: list[Annotation] = Field(default_factory=list)


class BatchRequest(BaseModel):
    reference: SequenceRecord
    queries: list[SequenceRecord]
    annotations: list[Annotation] = Field(default_factory=list)


@router.post("/pairwise", response_model=ComparisonResult)
def pairwise_compare(request: PairwiseRequest) -> ComparisonResult:
    result = aligner.align_pair(request.reference.sequence, request.query.sequence)
    result.reference_id = request.reference.id
    result.query_id = request.query.id
    if request.annotations:
        result.mutations = aligner.annotate_mutations(result.mutations, request.annotations)
    return result


@router.post("/batch", response_model=BatchComparisonResult)
def batch_compare(request: BatchRequest) -> BatchComparisonResult:
    pairs = [(item.id, item.sequence) for item in request.queries]
    batch = aligner.align_batch(request.reference.sequence, pairs)
    for item in batch.results:
        item.reference_id = request.reference.id
        if request.annotations:
            item.mutations = aligner.annotate_mutations(item.mutations, request.annotations)
    return batch
