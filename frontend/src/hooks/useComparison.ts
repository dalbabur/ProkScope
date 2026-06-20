import axios from 'axios';
import type { Annotation, BatchComparisonResult, ComparisonResult, SequenceRecord } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function comparePairwise(reference: SequenceRecord, query: SequenceRecord, annotations: Annotation[]) {
  const response = await axios.post<ComparisonResult>(`${API_BASE}/api/comparison/pairwise`, { reference, query, annotations });
  return response.data;
}

export async function compareBatch(reference: SequenceRecord, queries: SequenceRecord[], annotations: Annotation[]) {
  const response = await axios.post<BatchComparisonResult>(`${API_BASE}/api/comparison/batch`, {
    reference,
    queries,
    annotations
  });
  return response.data;
}
