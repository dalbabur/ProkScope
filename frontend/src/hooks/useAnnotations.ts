import axios from 'axios';
import type { Annotation } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function uploadAnnotationFile(file: File): Promise<Annotation[]> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await axios.post(`${API_BASE}/api/annotations/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
}

export async function loadAnnotationFromDrive(session_token: string, file_id: string, filename: string): Promise<Annotation[]> {
  const response = await axios.post(`${API_BASE}/api/annotations/from-drive`, { session_token, file_id, filename });
  return response.data;
}
