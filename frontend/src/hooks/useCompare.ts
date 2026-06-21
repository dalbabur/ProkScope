import axios from 'axios';
import type { CompareResult, JobStatus } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function runCompare(
  referenceFile: File,
  isolateFiles: File[],
  isolateNames: string[],
  medakaModel: string,
  featureIds: string[],
  maxMismatches: number
): Promise<JobStatus> {
  const formData = new FormData();
  formData.append('reference', referenceFile);
  for (const f of isolateFiles) {
    formData.append('isolates', f);
  }
  formData.append('isolate_names', isolateNames.join(','));
  formData.append('medaka_model', medakaModel);
  formData.append('feature_ids', featureIds.join(','));
  formData.append('max_mismatches', String(maxMismatches));
  const response = await axios.post<JobStatus>(`${API_BASE}/api/compare/run`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function getCompareStatus(jobId: string): Promise<JobStatus> {
  const response = await axios.get<JobStatus>(`${API_BASE}/api/compare/status/${jobId}`);
  return response.data;
}

export async function getCompareResult(jobId: string): Promise<CompareResult> {
  const response = await axios.get<CompareResult>(`${API_BASE}/api/compare/result/${jobId}`);
  return response.data;
}

export function getCompareFileUrl(jobId: string, filename: string): string {
  return `${API_BASE}/api/compare/files/${jobId}/${encodeURIComponent(filename)}`;
}
