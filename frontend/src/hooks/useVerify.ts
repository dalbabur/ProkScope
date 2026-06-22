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
  medakaModel: string = 'r941_min_high_g360',
  batchSize: number = 10,
): Promise<string> {
  const formData = new FormData();
  formData.append('reference', referenceFile);
  formData.append('fastq', fastqFile);
  formData.append('output_dir', outputDir);
  formData.append('medaka_model', medakaModel);
  formData.append('batch_size', String(batchSize));

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

export async function suggestOutputDir(): Promise<string> {
  const response = await axios.get(`${API_BASE}/api/verify/suggest-output-dir`);
  return response.data.output_dir;
}

export async function compareAssemblyDrive(
  sessionToken: string,
  referenceFileId: string,
  referenceFileName: string,
  assemblyFileId: string,
  assemblyFileName: string,
  outputDir: string,
): Promise<string> {
  const response = await axios.post(`${API_BASE}/api/verify/compare-assembly-drive`, {
    session_token: sessionToken,
    reference_file_id: referenceFileId,
    reference_file_name: referenceFileName,
    assembly_file_id: assemblyFileId,
    assembly_file_name: assemblyFileName,
    output_dir: outputDir,
  });
  return response.data.job_id;
}

export async function assembleConsensusDrive(
  sessionToken: string,
  referenceFileId: string,
  referenceFileName: string,
  fastqFileId: string,
  fastqFileName: string,
  outputDir: string,
  medakaModel: string = 'r941_min_high_g360',
  batchSize: number = 10,
): Promise<string> {
  const response = await axios.post(`${API_BASE}/api/verify/assemble-consensus-drive`, {
    session_token: sessionToken,
    reference_file_id: referenceFileId,
    reference_file_name: referenceFileName,
    fastq_file_id: fastqFileId,
    fastq_file_name: fastqFileName,
    output_dir: outputDir,
    medaka_model: medakaModel,
    batch_size: batchSize,
  });
  return response.data.job_id;
}