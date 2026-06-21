import axios from 'axios';
import type { JobStatus, VerifyResult } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function compareAssembly(
  referenceFile: File,
  assemblyFile: File,
  outputDir: string
): Promise<string> {
  const formData = new FormData();
  formData.append('reference', referenceFile);
  formData.append('assembly', assemblyFile);
  formData.append('output_dir', outputDir);

  const response = await axios.post(`${API_BASE}/api/verify/compare-assembly`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data.job_id;
}

export async function assembleConsensus(
  referenceFile: File,
  fastqFile: File,
  outputDir: string,
  medakaModel: string = 'r941_min_high_g360'
): Promise<string> {
  const formData = new FormData();
  formData.append('reference', referenceFile);
  formData.append('fastq', fastqFile);
  formData.append('output_dir', outputDir);
  formData.append('medaka_model', medakaModel);

  const response = await axios.post(`${API_BASE}/api/verify/assemble-consensus`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data.job_id;
}

export async function pollStatus(jobId: string): Promise<JobStatus> {
  const response = await axios.get(`${API_BASE}/api/verify/status/${jobId}`);
  return response.data;
}

export async function getResult(jobId: string): Promise<VerifyResult> {
  const response = await axios.get(`${API_BASE}/api/verify/result/${jobId}`);
  return response.data;
}

export function getFileUrl(jobId: string, filename: string): string {
  return `${API_BASE}/api/verify/files/${jobId}/${filename}`;
}
