import axios from 'axios';
import type { SequenceRecord } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function uploadSequenceFile(file: File): Promise<SequenceRecord[]> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await axios.post(`${API_BASE}/api/sequences/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
}

export async function loadSequenceFromDrive(session_token: string, file_id: string, filename: string): Promise<SequenceRecord[]> {
  const response = await axios.post(`${API_BASE}/api/sequences/from-drive`, { session_token, file_id, filename });
  return response.data;
}
