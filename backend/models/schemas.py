from __future__ import annotations

from pydantic import BaseModel, Field


class Feature(BaseModel):
    type: str
    name: str
    start: int
    end: int
    strand: int
    qualifiers: dict


class SequenceRecord(BaseModel):
    id: str
    name: str
    description: str
    sequence: str
    length: int
    format: str
    gc_content: float
    features: list[Feature] = Field(default_factory=list)


class Annotation(BaseModel):
    chrom: str
    start: int
    end: int
    name: str
    score: float | None = None
    strand: str | None = None
    source: str | None = None
    feature_type: str | None = None
    color: str | None = None


class Mutation(BaseModel):
    position: int
    ref: str
    alt: str
    type: str
    in_feature: str | None = None


class ComparisonResult(BaseModel):
    reference_id: str
    query_id: str
    identity: float
    alignment_score: float
    mutations: list[Mutation] = Field(default_factory=list)
    aligned_ref: str
    aligned_query: str


class BatchComparisonResult(BaseModel):
    results: list[ComparisonResult]
    summary: dict


class DriveFile(BaseModel):
    id: str
    name: str
    mime_type: str
    modified_time: str
    size: str | None = None
