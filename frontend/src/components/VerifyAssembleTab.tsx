import { useMemo, useState } from 'react';
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

function mutationsFromResult(result: any) {
  if (!result) return [];
  if ('results' in result) {
    return result.results.flatMap((item: any) =>
      item.mutations.map((m: any) => ({ ...m, affectedSequences: [item.query_id] }))
    );
  }
  return result.mutations;
}

export function VerifyAssembleTab() {
  const { sequences, annotations, comparisonResult, hiddenFeatureTypes, toggleFeatureType, error } =
    useStore();
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null);

  const filteredAnnotations = useMemo(
    () => annotations.filter((ann) => !hiddenFeatureTypes.includes(ann.feature_type || 'unknown')),
    [annotations, hiddenFeatureTypes]
  );
  const spec = useMemo(
    () => buildGoslingSpec(sequences, filteredAnnotations, comparisonResult),
    [sequences, filteredAnnotations, comparisonResult]
  );

  const allMutations = useMemo(() => {
    const base = mutationsFromResult(comparisonResult);
    if (!selectedRange) return base;
    return base.filter((item: any) => item.position >= selectedRange.start && item.position <= selectedRange.end);
  }, [comparisonResult, selectedRange]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: '100%', gap: 0 }}>
      <aside style={{ borderRight: '1px solid #30363d', padding: 10, overflow: 'auto' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1 }}>Google Drive</h3>
        <DriveFilePicker />
        <h3 style={{ margin: '12px 0 8px', fontSize: 13, color: '#8b949e', textTransform: 'uppercase', letterSpacing: 1 }}>Upload</h3>
        <SequenceUploader />
        <FeatureLibrary />
      </aside>
      <main style={{ padding: 12, display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 12, overflow: 'auto' }}>
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
            <ComparisonView result={comparisonResult} />
          </div>
        </section>
        {error && <div style={{ color: '#f85149', fontSize: 12 }}>{error}</div>}
      </main>
    </div>
  );
}
