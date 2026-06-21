import { useMemo, useState, useEffect } from 'react';
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
import { compareAssembly, assembleConsensus, pollStatus, getResult } from '../hooks/useVerify';
import type { JobStatus, VerifyResult } from '../types';

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

const MEDAKA_MODELS = [
  'r941_min_high_g360',
  'r941_min_fast_g303',
  'r941_prom_high_g360',
  'r941_prom_fast_g303',
  'r10_min_high_g303',
  'r10_prom_high_g303',
];

export function VerifyAssembleTab() {
  const { sequences, annotations, comparisonResult, hiddenFeatureTypes, toggleFeatureType, error } =
    useStore();
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);

  // Workflow state
  const [mode, setMode] = useState<WorkflowMode>('compare');
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [assemblyFile, setAssemblyFile] = useState<File | null>(null);
  const [fastqFile, setFastqFile] = useState<File | null>(null);
  const [outputDir, setOutputDir] = useState<string>('');
  const [medakaModel, setMedakaModel] = useState<string>('r941_min_high_g360');
  const [isRunning, setIsRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);

  // Poll job status
  useEffect(() => {
    if (!jobId || !jobStatus || jobStatus.status === 'done' || jobStatus.status === 'error') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const status = await pollStatus(jobId);
        setJobStatus(status);

        if (status.status === 'done') {
          const jobResult = await getResult(jobId);
          setResult(jobResult);
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

    // Validation
    if (!referenceFile) {
      setWorkflowError('Please select a reference genome');
      return;
    }
    if (!outputDir.trim()) {
      setWorkflowError('Please specify an output directory');
      return;
    }

    if (mode === 'compare') {
      if (!assemblyFile) {
        setWorkflowError('Please select an assembly file');
        return;
      }

      try {
        setIsRunning(true);
        const newJobId = await compareAssembly(referenceFile, assemblyFile, outputDir);
        setJobId(newJobId);
        setJobStatus({ job_id: newJobId, status: 'pending' });
      } catch (err: any) {
        setWorkflowError(err.response?.data?.detail || err.message || 'Failed to start comparison');
        setIsRunning(false);
      }
    } else {
      if (!fastqFile) {
        setWorkflowError('Please select a FASTQ file');
        return;
      }

      try {
        setIsRunning(true);
        const newJobId = await assembleConsensus(referenceFile, fastqFile, outputDir, medakaModel);
        setJobId(newJobId);
        setJobStatus({ job_id: newJobId, status: 'pending' });
      } catch (err: any) {
        setWorkflowError(err.response?.data?.detail || err.message || 'Failed to start assembly');
        setIsRunning(false);
      }
    }
  };

  const filteredAnnotations = useMemo(
    () => annotations.filter((ann) => !hiddenFeatureTypes.includes(ann.feature_type || 'unknown')),
    [annotations, hiddenFeatureTypes]
  );
  const spec = useMemo(
    () => buildGoslingSpec(sequences, filteredAnnotations, comparisonResult),
    [sequences, filteredAnnotations, comparisonResult]
  );

  const allMutations = useMemo(() => {
    const base = result?.mutations || mutationsFromResult(comparisonResult);
    if (!selectedRange) return base;
    return base.filter((item: any) => item.position >= selectedRange.start && item.position <= selectedRange.end);
  }, [comparisonResult, result, selectedRange]);

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
        {/* Workflow Selection */}
        <section style={{ padding: 12, background: '#161b22', border: '1px solid #30363d', borderRadius: 6 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Workflow Mode</h3>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                value="compare"
                checked={mode === 'compare'}
                onChange={(e) => setMode(e.target.value as WorkflowMode)}
                disabled={isRunning}
              />
              <span style={{ fontSize: 13 }}>Compare Assembly</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                value="assemble"
                checked={mode === 'assemble'}
                onChange={(e) => setMode(e.target.value as WorkflowMode)}
                disabled={isRunning}
              />
              <span style={{ fontSize: 13 }}>Assemble from ONT Reads</span>
            </label>
          </div>
        </section>

        {/* File Inputs */}
        <section style={{ padding: 12, background: '#161b22', border: '1px solid #30363d', borderRadius: 6 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Input Files</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#8b949e' }}>
                Reference Genome (FASTA/GenBank)
              </label>
              <input
                type="file"
                accept=".fasta,.fa,.fna,.gb,.gbk,.genbank"
                onChange={(e) => setReferenceFile(e.target.files?.[0] || null)}
                disabled={isRunning}
                style={{ fontSize: 12, width: '100%' }}
              />
            </div>

            {mode === 'compare' ? (
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#8b949e' }}>
                  Assembly (FASTA/GenBank)
                </label>
                <input
                  type="file"
                  accept=".fasta,.fa,.fna,.gb,.gbk,.genbank"
                  onChange={(e) => setAssemblyFile(e.target.files?.[0] || null)}
                  disabled={isRunning}
                  style={{ fontSize: 12, width: '100%' }}
                />
              </div>
            ) : (
              <>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#8b949e' }}>
                    ONT Reads (FASTQ/FASTQ.gz)
                  </label>
                  <input
                    type="file"
                    accept=".fastq,.fq,.fastq.gz,.fq.gz"
                    onChange={(e) => setFastqFile(e.target.files?.[0] || null)}
                    disabled={isRunning}
                    style={{ fontSize: 12, width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#8b949e' }}>
                    Medaka Model
                  </label>
                  <select
                    value={medakaModel}
                    onChange={(e) => setMedakaModel(e.target.value)}
                    disabled={isRunning}
                    style={{
                      fontSize: 12,
                      padding: '4px 8px',
                      background: '#0d1117',
                      border: '1px solid #30363d',
                      color: '#c9d1d9',
                      borderRadius: 6,
                      width: '100%',
                    }}
                  >
                    {MEDAKA_MODELS.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div>
              <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#8b949e' }}>
                Output Directory
              </label>
              <input
                type="text"
                value={outputDir}
                onChange={(e) => setOutputDir(e.target.value)}
                placeholder="/path/to/output"
                disabled={isRunning}
                style={{
                  fontSize: 12,
                  padding: '4px 8px',
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  color: '#c9d1d9',
                  borderRadius: 6,
                  width: '100%',
                }}
              />
            </div>

            <button
              onClick={handleRunWorkflow}
              disabled={isRunning}
              style={{
                padding: '8px 16px',
                background: isRunning ? '#30363d' : '#238636',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                cursor: isRunning ? 'not-allowed' : 'pointer',
                marginTop: 8,
              }}
            >
              {isRunning ? `Running (${jobStatus?.status || 'pending'})...` : 'Run Workflow'}
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
          <section style={{ padding: 12, background: '#161b22', border: '1px solid #30363d', borderRadius: 6 }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Quality Metrics</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>Identity</div>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: result.quality_metrics.identity_percent >= 95 ? '#3fb950' : '#f85149' }}>
                  {result.quality_metrics.identity_percent.toFixed(2)}%
                  {result.quality_metrics.identity_percent >= 95 ? ' ✓' : ' ⚠'}
                </div>
              </div>
              {result.quality_metrics.coverage_percent != null && (
                <div>
                  <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>Coverage</div>
                  <div style={{ fontSize: 16, fontWeight: 'bold' }}>{result.quality_metrics.coverage_percent.toFixed(1)}x</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>SNPs</div>
                <div style={{ fontSize: 16 }}>{result.quality_metrics.snps}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>Insertions</div>
                <div style={{ fontSize: 16 }}>{result.quality_metrics.insertions}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>Deletions</div>
                <div style={{ fontSize: 16 }}>{result.quality_metrics.deletions}</div>
              </div>
            </div>
            {result.consensus_fasta_path && (
              <div style={{ marginTop: 12, fontSize: 12, color: '#8b949e' }}>
                Consensus saved: <span style={{ color: '#c9d1d9', fontFamily: 'monospace' }}>{result.consensus_fasta_path}</span>
              </div>
            )}
          </section>
        )}

        <section>
          <GenomeViewer spec={spec} onRangeSelect={setSelectedRange} />
          <AnnotationTrack annotations={annotations} hiddenFeatureTypes={hiddenFeatureTypes} onToggle={toggleFeatureType} />
        </section>
        <section>
          <IgvViewer height={300} />
        </section>
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Mutations</h3>
            <MutationTable mutations={allMutations} />
          </div>
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: 13 }}>Alignment</h3>
            <ComparisonView result={result || comparisonResult} />
          </div>
        </section>
        {error && <div style={{ color: '#f85149', fontSize: 12 }}>{error}</div>}
      </main>
    </div>
  );
}
