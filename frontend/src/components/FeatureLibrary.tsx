import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import type { Annotation, FeatureRecord } from '../types';
import { useStore } from '../hooks/useStore';

const API_BASE = import.meta.env.VITE_API_URL || '';

type MismatchCount = 0 | 1 | 2 | 3;

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function FeatureLibrary() {
  const { sequences, referenceId, annotations, setAnnotations, setError } = useStore();

  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [maxMismatches, setMaxMismatches] = useState<MismatchCount>(0);
  const [isSearching, setIsSearching] = useState(false);
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);
  const [features, setFeatures] = useState<FeatureRecord[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dbMissing, setDbMissing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(searchQuery, 300);

  const fetchTypes = useCallback(async () => {
    try {
      const res = await axios.get<string[]>(`${API_BASE}/api/features/types`);
      setAvailableTypes(res.data);
    } catch {
      // silently ignore
    }
  }, []);

  const fetchFeatures = useCallback(async (q: string, types: Set<string>) => {
    try {
      const params: Record<string, string> = {};
      if (q) params.q = q;
      if (types.size === 1) params.type = [...types][0];
      const res = await axios.get<FeatureRecord[]>(`${API_BASE}/api/features`, {
        params,
      });
      setDbMissing(res.headers['x-db-missing'] === 'true');
      setFeatures(res.data);
    } catch {
      setFeatures([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchTypes();
    fetchFeatures('', new Set());
  }, [open, fetchTypes, fetchFeatures]);

  useEffect(() => {
    if (!open) return;
    fetchFeatures(debouncedQuery, selectedTypes);
  }, [open, debouncedQuery, selectedTypes, fetchFeatures]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const toggleType = (type: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const toggleId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFindInGenome = async () => {
    const ref = sequences.find((s) => s.id === referenceId);
    if (!ref) return;
    setIsSearching(true);
    try {
      const res = await axios.post<Annotation[]>(`${API_BASE}/api/features/search-genome`, {
        genome_sequence: ref.sequence,
        feature_ids: selectedIds.size > 0 ? [...selectedIds] : null,
        max_mismatches: maxMismatches,
      });
      const hits = res.data;
      setAnnotations([...annotations, ...hits]);
      const featureSet = new Set(hits.map((h) => h.name));
      showToast(`Found ${hits.length} match${hits.length !== 1 ? 'es' : ''} across ${featureSet.size} feature${featureSet.size !== 1 ? 's' : ''}`);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? (err as Error).message);
    } finally {
      setIsSearching(false);
    }
  };

  const handleLoadDb = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    try {
      await axios.post(`${API_BASE}/api/features/upload-db`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setDbMissing(false);
      await fetchTypes();
      await fetchFeatures(debouncedQuery, selectedTypes);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? (err as Error).message);
    }
  };

  const visibleFeatures = features.slice(0, 200);

  return (
    <div style={{ borderTop: '1px solid #30363d', marginTop: 8 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          color: '#e6edf3',
          textAlign: 'left',
          padding: '8px 0',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        {open ? '▾' : '▸'} Feature Library {features.length > 0 ? `(${features.length})` : ''}
      </button>

      {open && (
        <div style={{ display: 'grid', gap: 6 }}>
          {/* Load DB button */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={btnStyle}
              title="Upload feature_db.json"
            >
              Load DB
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleLoadDb(f);
                e.target.value = '';
              }}
            />
          </div>

          {dbMissing && (
            <div style={{ fontSize: 11, color: '#d29922', lineHeight: 1.4 }}>
              No feature database loaded — upload a feature_db.json or run build_feature_db.py
            </div>
          )}

          {/* Search */}
          <input
            type="text"
            placeholder="Search features…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={inputStyle}
          />

          {/* Type filter chips */}
          {availableTypes.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {availableTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  style={{
                    ...chipStyle,
                    background: selectedTypes.has(type) ? '#388bfd' : '#21262d',
                    color: selectedTypes.has(type) ? '#fff' : '#8b949e',
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          )}

          {/* Feature list */}
          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #30363d' }}>
            {visibleFeatures.length === 0 && !dbMissing && (
              <div style={{ padding: 8, color: '#8b949e', fontSize: 12 }}>No features found</div>
            )}
            {visibleFeatures.map((feat) => (
              <div key={feat.id} style={{ borderBottom: '1px solid #21262d' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 6px',
                    cursor: 'pointer',
                    background: expandedId === feat.id ? '#161b22' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(feat.id)}
                    onChange={() => toggleId(feat.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flexShrink: 0 }}
                  />
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      background: feat.color || '#888',
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{ flex: 1, minWidth: 0, overflow: 'hidden', fontSize: 12 }}
                    onClick={() => setExpandedId(expandedId === feat.id ? null : feat.id)}
                  >
                    <span style={{ fontWeight: 500, color: '#e6edf3' }}>{feat.label}</span>
                    <span style={{ color: '#8b949e', marginLeft: 6 }}>{feat.type}</span>
                    <span style={{ color: '#8b949e', marginLeft: 6 }}>{feat.length}bp</span>
                  </span>
                </div>
                {expandedId === feat.id && (
                  <div style={{ padding: '6px 10px 8px 32px', fontSize: 11, color: '#8b949e', background: '#0d1117' }}>
                    <div><b style={{ color: '#e6edf3' }}>Source:</b> {feat.source_plasmid} ({feat.source_file})</div>
                    {feat.description && <div><b style={{ color: '#e6edf3' }}>Description:</b> {feat.description}</div>}
                    <div style={{ marginTop: 4, fontFamily: 'monospace', wordBreak: 'break-all', color: '#3fb950', fontSize: 10 }}>
                      {feat.sequence}
                    </div>
                    {feat.tags.length > 0 && (
                      <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {feat.tags.map((tag) => (
                          <span key={tag} style={chipStyle}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {features.length > 200 && (
              <div style={{ padding: 6, fontSize: 11, color: '#8b949e', textAlign: 'center' }}>
                Showing first 200 of {features.length} features — refine your search
              </div>
            )}
          </div>

          {/* Action bar */}
          {selectedIds.size > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#8b949e' }}>{selectedIds.size} selected</span>
              <label style={{ fontSize: 12, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 4 }}>
                Mismatches:
                <select
                  value={maxMismatches}
                  onChange={(e) => setMaxMismatches(Number(e.target.value) as MismatchCount)}
                  style={{ ...inputStyle, width: 48, padding: '2px 4px' }}
                >
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={handleFindInGenome}
                disabled={isSearching || !referenceId}
                title={!referenceId ? 'Load a reference genome first' : undefined}
                style={{ ...btnStyle, background: '#238636', color: '#fff' }}
              >
                {isSearching ? 'Searching…' : 'Find in Genome'}
              </button>
              <button
                onClick={() => setSelectedIds(new Set())}
                style={btnStyle}
              >
                Clear
              </button>
            </div>
          )}

          {toast && (
            <div style={{ fontSize: 12, color: '#3fb950', padding: '4px 0' }}>{toast}</div>
          )}
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
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
