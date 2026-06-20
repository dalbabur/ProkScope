import { useMemo, useState } from 'react';
import { AnnotationTrack } from './components/AnnotationTrack';
import { ComparisonView } from './components/ComparisonView';
import { DriveFilePicker } from './components/DriveFilePicker';
import { GenomeViewer } from './components/GenomeViewer';
import { MutationTable } from './components/MutationTable';
import { SequenceUploader } from './components/SequenceUploader';
import { useStore } from './hooks/useStore';
import { buildGoslingSpec } from './utils/goslingSpec';

function mutationsFromResult(result: any) {
  if (!result) return [];
  if ('results' in result) {
    return result.results.flatMap((item: any) => item.mutations.map((mutation: any) => ({ ...mutation, affectedSequences: [item.query_id] })));
  }
  return result.mutations;
}

export default function App() {
  const { sequences, annotations, comparisonResult, hiddenFeatureTypes, toggleFeatureType, error } = useStore();
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);

  const filteredAnnotations = useMemo(
    () => annotations.filter((ann) => !hiddenFeatureTypes.includes(ann.feature_type || 'unknown')),
    [annotations, hiddenFeatureTypes]
  );
  const spec = useMemo(() => buildGoslingSpec(sequences, filteredAnnotations, comparisonResult), [sequences, filteredAnnotations, comparisonResult]);

  const allMutations = useMemo(() => {
    const base = mutationsFromResult(comparisonResult);
    if (!selectedRange) return base;
    return base.filter((item: any) => item.position >= selectedRange.start && item.position <= selectedRange.end);
  }, [comparisonResult, selectedRange]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: '100vh', background: '#0d1117', color: '#e6edf3' }}>
      <aside style={{ borderRight: '1px solid #30363d', padding: 10, overflow: 'auto' }}>
        <h3>Google Drive</h3>
        <DriveFilePicker />
        <h3>Upload</h3>
        <SequenceUploader />
      </aside>
      <main style={{ padding: 12, display: 'grid', gridTemplateRows: '60% 40%', gap: 12 }}>
        <section>
          <GenomeViewer spec={spec} onRangeSelect={setSelectedRange} />
          <AnnotationTrack annotations={annotations} hiddenFeatureTypes={hiddenFeatureTypes} onToggle={toggleFeatureType} />
        </section>
        <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <h3>Mutations</h3>
            <MutationTable mutations={allMutations} />
          </div>
          <div>
            <h3>Alignment</h3>
            <ComparisonView result={comparisonResult} />
          </div>
        </section>
        {error && <div style={{ color: '#f85149' }}>{error}</div>}
      </main>
    </div>
  );
}
