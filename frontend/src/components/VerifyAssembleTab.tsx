import { useMemo, useState, useEffect } from 'react';
import axios from 'axios';
import { AnnotationTrack } from './AnnotationTrack';
import { ComparisonView } from './ComparisonView';
import { DriveFilePicker } from './DriveFilePicker';
import { FeatureLibrary } from './FeatureLibrary';
import { GenomeViewer } from './GenomeViewer';
import { IgvViewer } from './IgvViewer';
import { MutationTable } from './MutationTable';
import { SequenceUploader } from './SequenceUploader';
import { useStore } from '../hooks/useStore';
import { buildGoslingSpec } from '../utils/goslingSpec';
import {
  compareAssembly,
  assembleConsensus,
  compareAssemblyDrive,
  assembleConsensusDrive,
  pollStatus,
  getResult,
  getFileUrl,
  suggestOutputDir,
} from '../hooks/useVerify';
import type { DriveFile, JobStatus, VerifyResult } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

function mutationsFromResult(result: any) {
  if (!result) return [];
  if ('results' in result) {
    return result.results.flatMap((item: any) =>
      item.mutations.map((m: any) => ({ ...m, affectedSequences: [item.query_id] }))
    );
  }
  return result.mutations;
}

type WorkflowMode = 'compare' | 'assemble';
type InputSource = 'local' | 'drive';

const MEDAKA_MODELS = [
  '',
  'dna_r10.4.1_e8.2_400bps_sup@v5.0.0',
  'dna_r10.4.1_e8.2_400bps_hac@v5.0.0',
  'dna_r10.4.1_e8.2_260bps_sup@v5.0.0',
  'r941_min_high_g360',
  'r941_min_fast_g303',
  'r941_prom_high_g360',
  'r941_prom_fast_g303',
  'r10_min_high_g303',
  'r10_prom_high_g303',
];

const REF_EXTS = ['.fasta', '.fa', '.fna', '.gb', '.gbk', '.genbank'];
const ASM_EXTS = ['.fasta', '.fa', '.fna', '.gb', '.gbk', '.genbank'];
const FASTQ_EXTS = ['.fastq', '.fq', '.fastq.gz', '.fq.gz'];

// ─── DriveSlotPicker ─────────────────────────────────────────────────────────

interface DriveSlotPickerProps {
  label: string;
  allowedExts: string[];
  selected: DriveFile | null;
  onSelect: (file: DriveFile | null) => void;
  disabled?: boolean;
}

function DriveSlotPicker({ label, allowedExts, selected, onSelect, disabled }: DriveSlotPickerProps) {
  const { driveSessionToken, setError } = useStore();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchFiles = async () => {
    if (!driveSessionToken) return;
    setLoading(true);
    try {
      const resp = await axios.get<DriveFile[]>(`${API_BASE}/api/drive/files`, {
        params: { session_token: driveSessionToken },
      });
      setFiles(resp.data.filter((f) => allowedExts.some((ext) => f.name.toLowerCase().endsWith(ext))));
    } catch (err: any) {
      setError(err.message ?? 'Failed to list Drive files');
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    if (!open) fetchFiles();
    setOpen((v) => !v);
  };

  const pill: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '3px 10px', borderRadius: 20,
    background: '#1f6feb33', border: '1px solid #1f6feb',
    fontSize: 12, color: '#58a6ff', cursor: 'pointer', marginTop: 4,
  };

  return (
    <div>
      {selected ? (
        <div style={pill}>
          <span>📄 {selected.name}</span>
          {!disabled && (
            <span onClick={() => onSelect(null)} style={{ marginLeft: 4, color: '#8b949e', cursor: 'pointer' }}>✕</span>
          )}
        </div>
      ) : (
        <button
          onClick={toggle}
          disabled={disabled || !driveSessionToken}
          style={{
            fontSize: 12, padding: '4px 10px', background: '#161b22',
            border: '1px solid #30363d', color: driveSessionToken ? '#58a6ff' : '#484f58',
            borderRadius: 6, cursor: disabled || !driveSessionToken ? 'not-allowed' : 'pointer', marginTop: 4,
          }}
        >
          {driveSessionToken ? '📂 Browse Drive' : 'Connect Drive first'}
        </button>
      )}

      {open && !selected && (
        <div style={{ marginTop: 6, maxHeight: 180, overflow: 'auto', border: '1px solid #30363d', borderRadius: 6, background: '#0d1117', padding: 6 }}>
          {loading && <div style={{ fontSize: 12, color: '#8b949e', padding: 4 }}>Loading…</div>}
          {!loading && files.length === 0 && (
            <div style={{ fontSize: 12, color: '#8b949e', padding: 4 }}>No matching files ({allowedExts.join(', ')})</div>
          )}
          {files.map((f) => (
            <div
              key={f.id}
              onClick={() => { onSelect(f); setOpen(false); }}
              style={{ fontSize: 12, padding: '4px 6px', cursor: 'pointer', borderRadius: 4, color: '#c9d1d9' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#161b22')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              📄 {f.name}
              {f.size && <span style={{ color: '#484f58', marginLeft: 8 }}>{(parseInt(f.size) / 1024 / 1024).toFixed(1)} MB</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FileInputRow ─────────────────────────────────────────────────────────────

interface FileInputRowProps {
  label: string;
  localAccept: string;
  allowedExts: string[];
  localFile: File | null;
  driveFile: DriveFile | null;
  source: InputSource;
  onSourceChange: (s: InputSource) => void;
  onLocalChange: (f: File | null) => void;
  onDriveChange: (f: DriveFile | null) => void;
  disabled?: boolean;
}

function FileInputRow({ label, localAccept, allowedExts, localFile, driveFile, source, onSourceChange, onLocalChange, onDriveChange, disabled }: FileInputRowProps) {
  const { driveSessionToken } = useStore();

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '2px 10px', fontSize: 11, border: '1px solid #30363d',
    background: active ? '#21262d' : 'transparent',
    color: active ? '#c9d1d9' : '#484f58', cursor: 'pointer', borderRadius: 4,
  });

  const chosen = source === 'local' ? localFile?.name : driveFile?.name;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <label style={{ fontSize: 12, color: '#8b949e' }}>{label}</label>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={tabStyle(source === 'local')} onClick={() => onSourceChange('local')} disabled={disabled}>Local</button>
          <button
            style={tabStyle(source === 'drive')}
            onClick={() => onSourceChange('drive')}
            disabled={disabled || !driveSessionToken}
            title={!driveSessionToken ? 'Connect Google Drive first' : undefined}
          >Drive</button>
        </div>
      </div>

      {source === 'local' ? (
        <input type="file" accept={localAccept} onChange={(e) => onLocalChange(e.target.files?.[0] ?? null)} disabled={disabled} style={{ fontSize: 12, width: '100%' }} />
      ) : (
        <DriveSlotPicker label={label} allowedExts={allowedExts} selected={driveFile} onSelect={onDriveChange} disabled={disabled} />
      )}

      {chosen && <div style={{ fontSize: 11, color: '#3fb950', marginTop: 3 }}>✓ {chosen}</div>}
    </div>
  );
}

// ─── VerifyAssembleTab ────────────────────────────────────────────────────────

export function VerifyAssembleTab() {
  const { sequences, annotations, comparisonResult, hiddenFeatureTypes, toggleFeatureType, error, driveSessionToken } = useStore();
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);

  const [mode, setMode] = useState<WorkflowMode>('compare');

  const [refSource, setRefSource] = useState<InputSource>('local');
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceDriveFile, setReferenceDriveFile] = useState<DriveFile | null>(null);

  const [asmSource, setAsmSource] = useState<InputSource>('local');
  const [assemblyFile, setAssemblyFile] = useState<File | null>(null);
  const [assemblyDriveFile, setAssemblyDriveFile] = useState<DriveFile | null>(null);

  const [fastqSource, setFastqSource] = useState<InputSource>('local');
  const [fastqFile, setFastqFile] = useState<File | null>(null);
  const [fastqDriveFile, setFastqDriveFile] = useState<DriveFile | null>(null);

  const [outputDir, setOutputDir] = useState<string>('');
  const [medakaModel, setMedakaModel] = useState<string>('');
  const [batchSize, setBatchSize] = useState<number>(10);
  const [isRunning, setIsRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  useEffect(() => {
    suggestOutputDir().then(setOutputDir).catch(() => {});
  }, []);

  useEffect(() => {
    if (!jobId || !jobStatus || jobStatus.status === 'done' || jobStatus.status === 'error') return;
    const interval = setInterval(async () => {
      try {
        const status = await pollStatus(jobId);
        setJobStatus(status);
        if (status.status === 'done') {
          setResult(await getResult(jobId));
          setIsRunning(false);
        } else if (status.status === 'error') {
          setWorkflowError(status.error || 'Job failed');
          setIsRunning(false);
        }
      } catch (err) {
        console.error('Failed to poll job status:', err);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [jobId, jobStatus]);

  const handleRunWorkflow = async () => {
    setWorkflowError(null);
    setResult(null);

    if (!outputDir.trim()) { setWorkflowError('Please specify an output directory'); return; }

    try {
      setIsRunning(true);

      if (mode === 'compare') {
        const refReady = refSource === 'local' ? !!referenceFile : !!referenceDriveFile;
        const asmReady = asmSource === 'local' ? !!assemblyFile : !!assemblyDriveFile;
        if (!refReady) { setWorkflowError('Please select a reference genome'); setIsRunning(false); return; }
        if (!asmReady) { setWorkflowError('Please select an assembly file'); setIsRunning(false); return; }

        let newJobId: string;
        if (refSource === 'local' && asmSource === 'local') {
          newJobId = await compareAssembly(referenceFile!, assemblyFile!, outputDir);
        } else if (refSource === 'drive' && asmSource === 'drive') {
          newJobId = await compareAssemblyDrive(driveSessionToken!, referenceDriveFile!.id, referenceDriveFile!.name, assemblyDriveFile!.id, assemblyDriveFile!.name, outputDir);
        } else {
          let ref = referenceFile;
          let asm = assemblyFile;
          if (refSource === 'drive') { const b = await fetchDriveFileAsBlob(driveSessionToken!, referenceDriveFile!.id); ref = new File([b], referenceDriveFile!.name); }
          if (asmSource === 'drive') { const b = await fetchDriveFileAsBlob(driveSessionToken!, assemblyDriveFile!.id); asm = new File([b], assemblyDriveFile!.name); }
          newJobId = await compareAssembly(ref!, asm!, outputDir);
        }
        setJobId(newJobId);
        setJobStatus({ job_id: newJobId, status: 'pending' });

      } else {
        const refReady = refSource === 'local' ? !!referenceFile : !!referenceDriveFile;
        const fqReady  = fastqSource === 'local' ? !!fastqFile : !!fastqDriveFile;
        if (!refReady) { setWorkflowError('Please select a reference genome'); setIsRunning(false); return; }
        if (!fqReady)  { setWorkflowError('Please select a FASTQ file'); setIsRunning(false); return; }

        let newJobId: string;
        if (refSource === 'local' && fastqSource === 'local') {
          newJobId = await assembleConsensus(referenceFile!, fastqFile!, outputDir, medakaModel, batchSize);
        } else if (refSource === 'drive' && fastqSource === 'drive') {
          newJobId = await assembleConsensusDrive(driveSessionToken!, referenceDriveFile!.id, referenceDriveFile!.name, fastqDriveFile!.id, fastqDriveFile!.name, outputDir, medakaModel, batchSize);
        } else {
          let ref = referenceFile;
          let fq  = fastqFile;
          if (refSource === 'drive') { const b = await fetchDriveFileAsBlob(driveSessionToken!, referenceDriveFile!.id); ref = new File([b], referenceDriveFile!.name); }
          if (fastqSource === 'drive') { const b = await fetchDriveFileAsBlob(driveSessionToken!, fastqDriveFile!.id); fq = new File([b], fastqDriveFile!.name); }
          newJobId = await assembleConsensus(ref!, fq!, outputDir, medakaModel, batchSize);
        }
        setJobId(newJobId);
        setJobStatus({ job_id: newJobId, status: 'pending' });
      }
    } catch (err: any) {
      setWorkflowError(err.response?.data?.detail || err.message || 'Failed to start workflow');
      setIsRunning(false);
    }
  };

  const filteredAnnotations = useMemo(
    () => annotations.filter((ann) => !hiddenFeatureTypes.includes(ann.feature_type || 'unknown')),
    [annotations, hiddenFeatureTypes]
  );
  const spec = useMemo(() => buildGoslingSpec(sequences, filteredAnnotations, comparisonResult), [sequences, filteredAnnotations, comparisonResult]);
  const allMutations = useMemo(() => {
    const base = result?.mutations || mutationsFromResult(comparisonResult);
    if (!selectedRange) return base;
    return base.filter((item: any) => item.position >= selectedRange.start && item.position <= selectedRange.end);
  }, [comparisonResult, result, selectedRange]);

  const sectionStyle: React.CSSProperties = { padding: 12, background: '#161b22', border: '1px solid #30363d', borderRadius: 6 };
  const inputStyle: React.CSSProperties = { fontSize: 12, padding: '4px 8px', background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 6, width: '100%' };
  const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, marginBottom: 4, color: '#8b949e' };
  console.log({
    jobId: result?.job_id,
    reference: result?.reference_fasta_file,
    fastaUrl:
       result?.reference_fasta_file && result?.job_id
          ? getFileUrl(result.job_id, result.reference_fasta_file)
          : undefined,
  });
  console.log("result", result);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: '100%', gap: 0 }}>
      <aside style={{ borderRight: '1px solid #30363d', padding: 10, overflow: 'auto' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1 }}>Google Drive</h3>
        <DriveFilePicker />
        <h3 style={{ margin: '12px 0 8px', fontSize: 13, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1 }}>Upload</h3>
        <SequenceUploader />
        <FeatureLibrary />
      </aside>

      <main style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>

        {/* Workflow mode */}
        <section style={sectionStyle}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Workflow Mode</h3>
          <div style={{ display: 'flex', gap: 16 }}>
            {(['compare', 'assemble'] as WorkflowMode[]).map((m) => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="radio" value={m} checked={mode === m} onChange={() => setMode(m)} disabled={isRunning} />
                <span style={{ fontSize: 13 }}>{m === 'compare' ? 'Compare Assembly' : 'Assemble from ONT Reads'}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Input files */}
        <section style={sectionStyle}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>
            Input Files
            {!driveSessionToken && <span style={{ fontSize: 11, color: '#484f58', fontWeight: 'normal', marginLeft: 10 }}>Connect Google Drive (sidebar) to enable Drive file selection</span>}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Reference — always shown */}
            <FileInputRow
              label="Reference Genome (FASTA / GenBank)"
              localAccept=".fasta,.fa,.fna,.gb,.gbk,.genbank"
              allowedExts={REF_EXTS}
              localFile={referenceFile} driveFile={referenceDriveFile}
              source={refSource} onSourceChange={setRefSource}
              onLocalChange={setReferenceFile} onDriveChange={setReferenceDriveFile}
              disabled={isRunning}
            />

            {/* Mode-specific inputs */}
            {mode === 'compare' ? (
              <FileInputRow
                label="Assembly (FASTA / GenBank)"
                localAccept=".fasta,.fa,.fna,.gb,.gbk,.genbank"
                allowedExts={ASM_EXTS}
                localFile={assemblyFile} driveFile={assemblyDriveFile}
                source={asmSource} onSourceChange={setAsmSource}
                onLocalChange={setAssemblyFile} onDriveChange={setAssemblyDriveFile}
                disabled={isRunning}
              />
            ) : (
              <>
                <FileInputRow
                  label="ONT Reads (FASTQ / FASTQ.gz)"
                  localAccept=".fastq,.fq,.fastq.gz,.fq.gz"
                  allowedExts={FASTQ_EXTS}
                  localFile={fastqFile} driveFile={fastqDriveFile}
                  source={fastqSource} onSourceChange={setFastqSource}
                  onLocalChange={setFastqFile} onDriveChange={setFastqDriveFile}
                  disabled={isRunning}
                />
                <div>
                  <label style={labelStyle}>Medaka Model</label>
                  <select value={medakaModel} onChange={(e) => setMedakaModel(e.target.value)} disabled={isRunning} style={inputStyle}>
                    {MEDAKA_MODELS.map((m) => (
                      <option key={m} value={m}>{m === '' ? 'Auto-detect (recommended)' : m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>
                    Medaka Batch Size
                    <span style={{ fontSize: 11, color: '#484f58', marginLeft: 6 }}>(lower = less RAM; reduce if job is killed)</span>
                  </label>
                  <input
                    type="number" min={1} max={200} value={batchSize}
                    onChange={(e) => setBatchSize(Math.max(1, parseInt(e.target.value) || 10))}
                    disabled={isRunning} style={inputStyle}
                  />
                </div>
              </>
            )}

            {/* Output directory — always shown */}
            <div>
              <label style={labelStyle}>
                Output Directory
                <span style={{ fontSize: 11, color: '#484f58', marginLeft: 6 }}>(BAM/consensus written here)</span>
              </label>
              <input
                type="text" value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="/path/to/output"
                disabled={isRunning} style={inputStyle}
              />
              <div style={{ fontSize: 11, color: '#484f58', marginTop: 3 }}>
                Codespaces: <code style={{ color: '#8b949e' }}>/workspaces/…</code> &nbsp;|&nbsp;
                Docker: <code style={{ color: '#8b949e' }}>/data</code>
              </div>
            </div>

            <button
              onClick={handleRunWorkflow}
              disabled={isRunning}
              style={{ padding: '8px 16px', background: isRunning ? '#30363d' : '#238636', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: isRunning ? 'not-allowed' : 'pointer', marginTop: 4 }}
            >
              {isRunning ? `Running (${jobStatus?.status || 'pending'})…` : 'Run Workflow'}
            </button>

            {workflowError && (
              <div style={{ padding: '8px 12px', background: '#1c1c1c', border: '1px solid #f85149', borderRadius: 6, fontSize: 12, color: '#f85149' }}>
                {workflowError}
              </div>
            )}
          </div>
        </section>

        {/* Quality Metrics */}
        {result && (
          <section style={sectionStyle}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Quality Metrics</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>Identity</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: result.quality_metrics.identity_percent >= 95 ? '#3fb950' : '#f85149' }}>
                  {result.quality_metrics.identity_percent.toFixed(2)}% {result.quality_metrics.identity_percent >= 95 ? '✓' : '⚠'}
                </div>
              </div>
              {result.quality_metrics.coverage_percent != null && (
                <div>
                  <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>Coverage</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold' }}>{result.quality_metrics.coverage_percent.toFixed(1)}×</div>
                </div>
              )}
              {(['snps', 'insertions', 'deletions'] as const).map((k) => (
                <div key={k}>
                  <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2, textTransform: 'capitalize' }}>{k}</div>
                  <div style={{ fontSize: 16 }}>{result.quality_metrics[k]}</div>
                </div>
              ))}
            </div>
            {result.consensus_fasta_path && (
              <div style={{ marginTop: 12, fontSize: 12, color: '#8b949e' }}>
                Consensus: <span style={{ color: '#c9d1d9', fontFamily: 'monospace' }}>{result.consensus_fasta_path}</span>
              </div>
            )}
            {result.bam_file && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#8b949e' }}>
                BAM: <span style={{ color: '#c9d1d9', fontFamily: 'monospace' }}>{outputDir}/{result.bam_file}</span>
              </div>
            )}
          </section>
        )}

        <section>
          <GenomeViewer spec={spec} onRangeSelect={setSelectedRange} />
          <AnnotationTrack annotations={annotations} hiddenFeatureTypes={hiddenFeatureTypes} onToggle={toggleFeatureType} />
        </section>
        <section style={sectionStyle}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Read Alignment (IGV)</h3>
          <div style={{ backgroundColor: "white" }}>
          <IgvViewer
            height={400}
            fastaUrl={result?.reference_fasta_file && result?.job_id
              ? getFileUrl(result.job_id, result.reference_fasta_file)
              : undefined}
            referenceName={result?.reference_name}
            tracks={result?.bam_file && result?.job_id ? [
              {
                type: 'alignment',
                format: 'bam',
                url: getFileUrl(result.job_id, result.bam_file),
                indexURL: getFileUrl(result.job_id, result.bam_file + '.bai'),
                name: 'Reads vs Reference',
              }
            ] : []}
          />
          </div>
        </section>
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Mutations</h3>
            <MutationTable mutations={allMutations} />
          </div>
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Alignment</h3>
            <ComparisonView result={
              result
                ? { reference_id: result.reference_name, query_id: result.assembly_or_reads_name, identity: result.quality_metrics.identity_percent, alignment_score: 0, mutations: result.mutations, aligned_ref: result.aligned_ref ?? '', aligned_query: result.aligned_query ?? '' }
                : comparisonResult
            } />
          </div>
        </section>
        {error && <div style={{ color: '#f85149', fontSize: 12 }}>{error}</div>}
      </main>
    </div>
  );
}

async function fetchDriveFileAsBlob(sessionToken: string, fileId: string): Promise<ArrayBuffer> {
  const resp = await axios.get(`${API_BASE}/api/drive/download`, {
    params: { session_token: sessionToken, file_id: fileId },
    responseType: 'arraybuffer',
  });
  return resp.data;
}