import axios from 'axios';
import type { Annotation, FeatureRecord } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function annotateGenome(
  genomeFile: File,
  featureIds: string[],
  maxMismatches: number
): Promise<Annotation[]> {
  const formData = new FormData();
  formData.append('genome', genomeFile);
  formData.append('feature_ids', featureIds.join(','));
  formData.append('max_mismatches', String(maxMismatches));
  const response = await axios.post<Annotation[]>(`${API_BASE}/api/annotate/genome`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function uploadAnnotateDb(dbFile: File): Promise<{ loaded: number }> {
  const formData = new FormData();
  formData.append('db_file', dbFile);
  const response = await axios.post<{ loaded: number }>(`${API_BASE}/api/annotate/upload-db`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

export async function getAnnotateFeatures(params: {
  q?: string;
  type?: string;
  min_length?: number;
  max_length?: number;
}): Promise<FeatureRecord[]> {
  const response = await axios.get<FeatureRecord[]>(`${API_BASE}/api/annotate/features`, { params });
  return response.data;
}

export async function getAnnotateFeatureTypes(): Promise<string[]> {
  const response = await axios.get<string[]>(`${API_BASE}/api/annotate/feature-types`);
  return response.data;
}
