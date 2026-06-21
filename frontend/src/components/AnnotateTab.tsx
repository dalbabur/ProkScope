import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { Annotation, FeatureRecord } from '../types';
import { annotateGenome, getAnnotateFeatureTypes, uploadAnnotateDb } from '../hooks/useAnnotate';

const API_BASE = import.meta.env.VITE_API_URL || '';

type MismatchCount = 0 | 1 | 2 | 3;

export function AnnotateTab() {
  const [genomeFile, setGenomeFile] = useState<File | null>(null);
  const [features, setFeatures] = useState<FeatureRecord[]>([]);
  const [featureTypes, setFeatureTypes] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [maxMismatches, setMaxMismatches] = useState<MismatchCount>(0);
  const [hits, setHits] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dbMissing, setDbMissing] = useState(false);
  const dbFileRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const loadTypes = useCallback(async () => {
    try {
      const types = await getAnnotateFeatureTypes();
      setFeatureTypes(types);
      setDbMissing(types.length === 0);
    } catch {
      setFeatureTypes([]);
    }
  }, []);

  const loadFeatures = useCallback(async (q: string, types: Set<string>) => {
    try {
      const params: Record<string, string> = {};
      if (q) params.q = q;
      if (types.size === 1) params.type = [...types][0];
      const res = await axios.get<FeatureRecord[]>(`${API_BASE}/api/annotate/features`, { params });
      setDbMissing(res.headers['x-db-missing'] === 'true');
      setFeatures(res.data);
    } catch {
      setFeatures([]);
    }
  }, []);

  useEffect(() => {
    loadTypes();
    loadFeatures('', new Set());
  }, [loadTypes, loadFeatures]);

  useEffect(() => {
    const id = setTimeout(() => loadFeatures(searchQuery, selectedTypes), 300);
    return () => clearTimeout(id);
  }, [searchQuery, selectedTypes, loadFeatures]);

  const handleDbUpload = async (file: File) => {
    setError(null);
    try {
      const result = await uploadAnnotateDb(file);
      showToast(`Loaded ${result.loaded} features`);
      setDbMissing(false);
      await loadTypes();
      await loadFeatures(searchQuery, selectedTypes);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? (err as Error).message);
    }
  };

  const handleAnnotate = async () => {
    if (!genomeFile) {
      setError('Upload a genome file first');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const ids = selectedIds.size > 0 ? [...selectedIds] : [];
      const result = await annotateGenome(genomeFile, ids, maxMismatches);
      setHits(result);
      const names = new Set(result.map((h) => h.name));
      showToast(`Found ${result.length} hit${result.length !== 1 ? 's' : ''} across ${names.size} feature${names.size !== 1 ? 's' : ''}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? (err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleType = (type: string) =>
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });

  const toggleId = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const visibleFeatures = features.slice(0, 200);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100%', gap: 0 }}>
      {/* Left panel: feature library + controls */}
      <aside style={{ borderRight: '1px solid #30363d', padding: 12, overflow: 'auto', display: 'grid', gap: 10, alignContent: 'start' }}>
        <div>
          <div style={labelStyle}>Feature Database</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button style={btnStyle} onClick={() => dbFileRef.current?.click()}>
              Upload DB
            </button>
            <input
              ref={dbFileRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleDbUpload(f); e.target.value = ''; }}
            />
          </div>
          {dbMissing && (
            <div style={{ fontSize: 11, color: '#d29922', marginTop: 6 }}>
              No feature database loaded — upload a feature_db.json
            </div>
          )}
        </div>

        <div>
          <div style={labelStyle}>Genome File</div>
          <input
            type="file"
            accept=".fasta,.fa,.fna,.gb,.gbk,.genbank"
            onChange={(e) => setGenomeFile(e.target.files?.[0] ?? null)}
            style={inputStyle}
          />
          {genomeFile && <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>{genomeFile.name}</div>}
        </div>

        <div>
          <div style={labelStyle}>Search Features</div>
          <input
            type="text"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={inputStyle}
          />
        </div>

        {featureTypes.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {featureTypes.map((t) => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                style={{
                  ...chipStyle,
                  background: selectedTypes.has(t) ? '#388bfd' : '#21262d',
                  color: selectedTypes.has(t) ? '#fff' : '#8b949e',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #30363d' }}>
          {visibleFeatures.length === 0 && !dbMissing && (
            <div style={{ padding: 8, color: '#8b949e', fontSize: 12 }}>No features</div>
          )}
          {visibleFeatures.map((feat) => (
            <label
              key={feat.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderBottom: '1px solid #21262d', cursor: 'pointer' }}
            >
              <input type="checkbox" checked={selectedIds.has(feat.id)} onChange={() => toggleId(feat.id)} />
              <span style={{ width: 10, height: 10, borderRadius: 2, background: feat.color || '#888', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#e6edf3', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {feat.label}
              </span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>{feat.length}bp</span>
            </label>
          ))}
          {features.length > 200 && (
            <div style={{ padding: 6, fontSize: 11, color: '#8b949e', textAlign: 'center' }}>
              Showing first 200 of {features.length}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 4 }}>
            Mismatches:
            <select
              value={maxMismatches}
              onChange={(e) => setMaxMismatches(Number(e.target.value) as MismatchCount)}
              style={{ ...inputStyle, width: 48, padding: '2px 4px' }}
            >
              {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button
            onClick={handleAnnotate}
            disabled={isLoading || !genomeFile}
            style={{ ...btnStyle, background: '#238636', color: '#fff' }}
          >
            {isLoading ? 'Searching…' : 'Find in Genome'}
          </button>
          {selectedIds.size > 0 && (
            <span style={{ fontSize: 12, color: '#8b949e' }}>{selectedIds.size} selected</span>
          )}
        </div>

        {toast && <div style={{ fontSize: 12, color: '#3fb950' }}>{toast}</div>}
        {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}
      </aside>

      {/* Right panel: results */}
      <main style={{ padding: 12, overflow: 'auto' }}>
        <h3 style={{ margin: '0 0 10px', fontSize: 14 }}>
          Annotation Hits {hits.length > 0 && <span style={{ color: '#8b949e', fontWeight: 400 }}>({hits.length})</span>}
        </h3>
        {hits.length === 0 ? (
          <div style={{ color: '#8b949e', fontSize: 13 }}>
            Upload a genome and click <strong>Find in Genome</strong> to annotate features.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #30363d' }}>
                  {['Feature', 'Type', 'Start', 'End', 'Length', 'Strand', 'Source'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#8b949e', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hits.map((hit, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #21262d' }}>
                    <td style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {hit.color && (
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: hit.color, flexShrink: 0, display: 'inline-block' }} />
                      )}
                      {hit.name}
                    </td>
                    <td style={{ padding: '4px 8px', color: '#8b949e' }}>{hit.feature_type || '—'}</td>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{hit.start.toLocaleString()}</td>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{hit.end.toLocaleString()}</td>
                    <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{(hit.end - hit.start).toLocaleString()}</td>
                    <td style={{ padding: '4px 8px' }}>{hit.strand || '.'}</td>
                    <td style={{ padding: '4px 8px', color: '#8b949e' }}>{hit.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 12,
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 4,
  cursor: 'pointer',
};

const chipStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 11,
  borderRadius: 10,
  border: '1px solid #30363d',
  cursor: 'pointer',
  background: '#21262d',
  color: '#8b949e',
};

const inputStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 12,
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 4,
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#8b949e',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};
