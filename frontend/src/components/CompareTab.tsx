import { useEffect, useRef, useState } from 'react';
import type { CompareResult, IsolateResult, JobStatus, VariantRecord } from '../types';
import { getCompareFileUrl, getCompareResult, getCompareStatus, runCompare } from '../hooks/useCompare';
import { IgvViewer, type IgvTrack } from './IgvViewer';

const MEDAKA_MODELS = [
  'r941_min_high_g360',
  'r941_min_fast_g303',
  'r1041_e82_400bps_hac_g632',
  'r1041_e82_400bps_sup_g615',
];

type MismatchCount = 0 | 1 | 2 | 3;

export function CompareTab() {
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [isolateFiles, setIsolateFiles] = useState<File[]>([]);
  const [isolateNames, setIsolateNames] = useState<string>('');
  const [medakaModel, setMedakaModel] = useState(MEDAKA_MODELS[0]);
  const [featureIds, setFeatureIds] = useState('');
  const [maxMismatches, setMaxMismatches] = useState<MismatchCount>(0);

  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [selectedIsolate, setSelectedIsolate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const handleIsolateFiles = (files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files);
    setIsolateFiles(arr);
    // Auto-populate names from filenames (strip extension)
    if (!isolateNames) {
      setIsolateNames(arr.map((f) => f.name.replace(/\.[^.]+$/, '')).join(', '));
    }
  };

  const handleRun = async () => {
    if (!referenceFile) { setError('Upload a reference file first'); return; }
    if (isolateFiles.length === 0) { setError('Upload at least one isolate FASTQ file'); return; }
    if (isolateFiles.length > 20) { setError('At most 20 isolates are supported'); return; }

    setError(null);
    setResult(null);
    setJobStatus(null);
    stopPolling();

    try {
      const names = isolateNames.split(',').map((n) => n.trim()).filter(Boolean);
      const fids = featureIds.split(',').map((s) => s.trim()).filter(Boolean);
      const status = await runCompare(referenceFile, isolateFiles, names, medakaModel, fids, maxMismatches);
      setJobStatus(status);

      // Poll for completion
      pollRef.current = setInterval(async () => {
        try {
          const s = await getCompareStatus(status.job_id);
          setJobStatus(s);
          if (s.status === 'done') {
            stopPolling();
            const r = await getCompareResult(s.job_id);
            setResult(r);
            if (r.isolates.length > 0) setSelectedIsolate(r.isolates[0].name);
          } else if (s.status === 'error') {
            stopPolling();
            setError(s.error || 'Job failed');
          }
        } catch (err: any) {
          stopPolling();
          setError(err?.response?.data?.detail ?? (err as Error).message);
        }
      }, 2000);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? (err as Error).message);
    }
  };

  // Build IGV tracks for selected isolate
  const igvTracks: IgvTrack[] = [];
  let igvFastaUrl: string | undefined;
  if (result) {
    igvFastaUrl = getCompareFileUrl(result.job_id, `${result.reference_name}.fasta`);
    const iso = result.isolates.find((i) => i.name === selectedIsolate);
    if (iso?.bam_file) {
      igvTracks.push({
        type: 'alignment',
        format: 'bam',
        url: getCompareFileUrl(result.job_id, iso.bam_file),
        indexURL: getCompareFileUrl(result.job_id, iso.bam_file + '.bai'),
        name: iso.name,
      });
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100%', overflow: 'hidden' }}>
      {/* Controls */}
      <div style={{ padding: 12, borderBottom: '1px solid #30363d', display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div style={labelStyle}>Reference (FASTA/GB)</div>
            <input
              type="file"
              accept=".fasta,.fa,.fna,.gb,.gbk,.genbank"
              onChange={(e) => setReferenceFile(e.target.files?.[0] ?? null)}
              style={inputStyle}
            />
            {referenceFile && <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>{referenceFile.name}</div>}
          </div>

          <div>
            <div style={labelStyle}>Isolate FASTQs (5–20)</div>
            <input
              type="file"
              accept=".fastq,.fq"
              multiple
              onChange={(e) => handleIsolateFiles(e.target.files)}
              style={inputStyle}
            />
            {isolateFiles.length > 0 && (
              <div style={{ fontSize: 11, color: '#8b949e', marginTop: 2 }}>
                {isolateFiles.length} file{isolateFiles.length !== 1 ? 's' : ''} selected
              </div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={labelStyle}>Isolate Names (comma-separated)</div>
            <input
              type="text"
              value={isolateNames}
              onChange={(e) => setIsolateNames(e.target.value)}
              placeholder="e.g. iso1, iso2, iso3"
              style={inputStyle}
            />
          </div>

          <div>
            <div style={labelStyle}>Medaka Model</div>
            <select value={medakaModel} onChange={(e) => setMedakaModel(e.target.value)} style={inputStyle}>
              {MEDAKA_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div>
            <div style={labelStyle}>Mismatches</div>
            <select
              value={maxMismatches}
              onChange={(e) => setMaxMismatches(Number(e.target.value) as MismatchCount)}
              style={{ ...inputStyle, width: 60 }}
            >
              {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div>
            <div style={labelStyle}>Feature IDs (optional)</div>
            <input
              type="text"
              value={featureIds}
              onChange={(e) => setFeatureIds(e.target.value)}
              placeholder="feat_0001, feat_0002"
              style={{ ...inputStyle, width: 200 }}
            />
          </div>

          <button
            onClick={handleRun}
            disabled={jobStatus?.status === 'pending' || jobStatus?.status === 'running'}
            style={{ ...btnStyle, background: '#238636', color: '#fff', alignSelf: 'flex-end' }}
          >
            {jobStatus?.status === 'pending' || jobStatus?.status === 'running' ? 'Running…' : 'Run Compare'}
          </button>
        </div>

        {jobStatus && (
          <div style={{ fontSize: 12, color: jobStatus.status === 'error' ? '#f85149' : jobStatus.status === 'done' ? '#3fb950' : '#d29922' }}>
            Status: {jobStatus.status}
            {jobStatus.status === 'running' || jobStatus.status === 'pending'
              ? ' — aligning and calling variants…'
              : ''}
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}
      </div>

      {/* Results */}
      {result ? (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', overflow: 'hidden' }}>
          {/* Left: isolate list + variant table */}
          <div style={{ borderRight: '1px solid #30363d', overflow: 'auto', padding: 10 }}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Isolates</div>
            {result.isolates.map((iso) => (
              <button
                key={iso.name}
                onClick={() => setSelectedIsolate(iso.name)}
                style={{
                  ...btnStyle,
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  marginBottom: 4,
                  background: selectedIsolate === iso.name ? '#388bfd' : '#21262d',
                  color: selectedIsolate === iso.name ? '#fff' : '#e6edf3',
                }}
              >
                {iso.name}
                <span style={{ float: 'right', fontSize: 11, opacity: 0.7 }}>
                  {iso.variants.length} variant{iso.variants.length !== 1 ? 's' : ''}
                </span>
              </button>
            ))}

            {result.summary && typeof result.summary === 'object' && (
              <div style={{ marginTop: 12, fontSize: 12 }}>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Summary</div>
                <div style={{ color: '#e6edf3' }}>Total positions: {(result.summary as any).total_variant_positions ?? 0}</div>
                <div style={{ color: '#e6edf3' }}>Shared variants: {((result.summary as any).shared_variants ?? []).length}</div>
              </div>
            )}
          </div>

          {/* Right: IGV + variant details */}
          <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', overflow: 'hidden', padding: 10, gap: 10 }}>
            <div>
              <IgvViewer fastaUrl={igvFastaUrl} tracks={igvTracks} height={300} referenceName={result.reference_name} />
            </div>
            <div style={{ overflow: 'auto' }}>
              {selectedIsolate && (
                <VariantTable
                  isolate={result.isolates.find((i) => i.name === selectedIsolate) ?? null}
                />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b949e', fontSize: 13 }}>
          {jobStatus?.status === 'running' || jobStatus?.status === 'pending'
            ? 'Running pipeline — this may take several minutes…'
            : 'Upload files and click Run Compare to get started.'}
        </div>
      )}
    </div>
  );
}

function VariantTable({ isolate }: { isolate: IsolateResult | null }) {
  if (!isolate) return null;
  const variants: VariantRecord[] = isolate.variants;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        {isolate.name} — {variants.length} variant{variants.length !== 1 ? 's' : ''}
      </div>
      {variants.length === 0 ? (
        <div style={{ fontSize: 12, color: '#8b949e' }}>No variants called</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #30363d' }}>
              {['Position', 'Ref', 'Alt', 'Type', 'Feature'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#8b949e', fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {variants.map((v, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #21262d' }}>
                <td style={{ padding: '3px 8px', fontFamily: 'monospace' }}>{v.position.toLocaleString()}</td>
                <td style={{ padding: '3px 8px', fontFamily: 'monospace', color: '#f85149' }}>{v.ref}</td>
                <td style={{ padding: '3px 8px', fontFamily: 'monospace', color: '#3fb950' }}>{v.alt}</td>
                <td style={{ padding: '3px 8px', color: typeColor(v.type) }}>{v.type}</td>
                <td style={{ padding: '3px 8px', color: '#8b949e' }}>{v.in_feature || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function typeColor(type: string): string {
  if (type === 'SNP') return '#58a6ff';
  if (type === 'insertion') return '#3fb950';
  if (type === 'deletion') return '#f85149';
  return '#e6edf3';
}

const btnStyle: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: 12,
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 4,
  cursor: 'pointer',
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
  marginBottom: 3,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};
