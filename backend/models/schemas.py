from __future__ import annotations

from typing import Literal

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


class JobStatus(BaseModel):
    job_id: str
    status: str  # "pending" | "running" | "done" | "error"
    error: str | None = None


class VariantRecord(BaseModel):
    position: int
    ref: str
    alt: str
    type: str
    in_feature: str | None = None


class IsolateResult(BaseModel):
    name: str
    bam_file: str | None = None
    variants: list[VariantRecord] = Field(default_factory=list)


class CompareResult(BaseModel):
    job_id: str
    reference_name: str
    isolates: list[IsolateResult] = Field(default_factory=list)
    feature_hits: list[Annotation] = Field(default_factory=list)
    summary: dict = Field(default_factory=dict)


class QualityMetrics(BaseModel):
    identity_percent: float
    coverage_percent: float | None = None
    total_mutations: int
    snps: int
    insertions: int
    deletions: int


class VerifyResult(BaseModel):
    job_id: str
    mode: Literal["compare", "assemble"]
    quality_metrics: QualityMetrics
    mutations: list[Mutation]
    alignment: str
    consensus_fasta_path: str | None = None
    bam_file: str | None = None
    reference_name: str
    assembly_or_reads_name: str
