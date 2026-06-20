import { useEffect, useState } from 'react';
import axios from 'axios';
import { loadAnnotationFromDrive } from '../hooks/useAnnotations';
import { loadSequenceFromDrive } from '../hooks/useSequences';
import { useStore } from '../hooks/useStore';
import type { DriveFile } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';
const BACKEND_ORIGIN = import.meta.env.VITE_BACKEND_ORIGIN || 'http://localhost:8000';
const supported = ['.fasta', '.fa', '.fna', '.fastq', '.fq', '.gb', '.gbk', '.gff', '.gff3', '.bed'];

export function DriveFilePicker() {
  const { driveSessionToken, setDriveSessionToken, setSequences, setAnnotations, setError } = useStore();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);

  const fetchFiles = async (token: string) => {
    const response = await axios.get<DriveFile[]>(`${API_BASE}/api/drive/files`, { params: { session_token: token } });
    setFiles(response.data.filter((f) => supported.some((ext) => f.name.toLowerCase().endsWith(ext))));
  };

  useEffect(() => {
    if (driveSessionToken) {
      void fetchFiles(driveSessionToken);
    }
  }, [driveSessionToken]);

  const connectDrive = async () => {
    try {
      setError(null);
      const redirect_uri = `${BACKEND_ORIGIN}/auth/callback`;
      const urlRes = await axios.get<{ auth_url: string }>(`${API_BASE}/api/drive/auth-url`, { params: { redirect_uri } });
      window.open(urlRes.data.auth_url, 'drive-auth', 'width=480,height=640');

      const listener = async (event: MessageEvent) => {
        if (!event.data || typeof event.data !== 'object') return;
        if (!('code' in event.data) && !('error' in event.data)) return;

        try {
          if (event.data.error) {
            throw new Error(String(event.data.error));
          }
          const callbackRes = await axios.post<{ session_token: string }>(`${API_BASE}/api/drive/callback`, {
            code: event.data.code,
            redirect_uri
          });
          setDriveSessionToken(callbackRes.data.session_token);
        } catch (error) {
          setError((error as Error).message);
        } finally {
          window.removeEventListener('message', listener);
        }
      };

      window.addEventListener('message', listener);
    } catch (error) {
      setError((error as Error).message);
    }
  };

  const loadSelected = async (mode: 'sequences' | 'annotations') => {
    if (!driveSessionToken) {
      setError('Connect Google Drive first.');
      return;
    }
    if (selected.length === 0) {
      setError('Select at least one file to load.');
      return;
    }

    setError(null);
    try {
      for (const fileId of selected) {
        const file = files.find((item) => item.id === fileId);
        if (!file) continue;
        const lower = file.name.toLowerCase();
        if (mode === 'sequences' && !['.gff', '.gff3', '.bed'].some((ext) => lower.endsWith(ext))) {
          const loaded = await loadSequenceFromDrive(driveSessionToken, file.id, file.name);
          setSequences((prev) => [...prev, ...loaded]);
        }
        if (mode === 'annotations' && ['.gff', '.gff3', '.bed', '.gb', '.gbk'].some((ext) => lower.endsWith(ext))) {
          const loaded = await loadAnnotationFromDrive(driveSessionToken, file.id, file.name);
          setAnnotations((prev) => [...prev, ...loaded]);
        }
      }
    } catch (error) {
      setError((error as Error).message);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {!driveSessionToken ? <button onClick={connectDrive}>Connect Google Drive</button> : <div>Drive connected</div>}
      <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #30363d', padding: 6 }}>
        {files.map((file) => (
          <label key={file.id} style={{ display: 'block', marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={selected.includes(file.id)}
              onChange={(e) =>
                setSelected((prev) => (e.target.checked ? [...prev, file.id] : prev.filter((item) => item !== file.id)))
              }
            />{' '}
            {file.name}
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => loadSelected('sequences')}>Load sequences</button>
        <button onClick={() => loadSelected('annotations')}>Load annotations</button>
      </div>
    </div>
  );
}
