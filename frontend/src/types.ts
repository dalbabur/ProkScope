export type Feature = {
  type: string;
  name: string;
  start: number;
  end: number;
  strand: number;
  qualifiers: Record<string, unknown>;
};

export type SequenceRecord = {
  id: string;
  name: string;
  description: string;
  sequence: string;
  length: number;
  format: 'fasta' | 'genbank' | 'fastq' | string;
  gc_content: number;
  features: Feature[];
};

export type Annotation = {
  chrom: string;
  start: number;
  end: number;
  name: string;
  score?: number | null;
  strand?: string | null;
  source?: string | null;
  feature_type?: string | null;
  color?: string | null;
};

export type FeatureRecord = {
  id: string;
  label: string;
  type: string;
  length: number;
  strand: string;
  color: string;
  sequence: string;
  description: string;
  source_plasmid: string;
  source_file: string;
  tags: string[];
};

export type Mutation = {
  position: number;
  ref: string;
  alt: string;
  type: 'SNP' | 'insertion' | 'deletion' | string;
  in_feature?: string | null;
  affectedSequences?: string[];
};

export type ComparisonResult = {
  reference_id: string;
  query_id: string;
  identity: number;
  alignment_score: number;
  mutations: Mutation[];
  aligned_ref: string;
  aligned_query: string;
};

export type BatchComparisonResult = {
  results: ComparisonResult[];
  summary: Record<string, unknown>;
};

export type DriveFile = {
  id: string;
  name: string;
  mime_type: string;
  modified_time: string;
  size?: string | null;
};

// --- New types for Compare and Annotate features ---

export type JobStatus = {
  job_id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  error?: string | null;
};

export type VariantRecord = {
  position: number;
  ref: string;
  alt: string;
  type: 'SNP' | 'insertion' | 'deletion' | string;
  in_feature?: string | null;
};

export type IsolateResult = {
  name: string;
  bam_file?: string | null;
  variants: VariantRecord[];
};

export type CompareResult = {
  job_id: string;
  reference_name: string;
  isolates: IsolateResult[];
  feature_hits: Annotation[];
  summary: Record<string, unknown>;
};

