import { useState } from 'react';
import { compareBatch, comparePairwise } from '../hooks/useComparison';
import { uploadAnnotationFile } from '../hooks/useAnnotations';
import { uploadSequenceFile } from '../hooks/useSequences';
import { useStore } from '../hooks/useStore';

const annotationExt = ['.gff', '.gff3', '.bed'];

export function SequenceUploader() {
  const {
    sequences,
    setSequences,
    referenceId,
    setReferenceId,
    annotations,
    setAnnotations,
    setComparisonResult,
    isLoading,
    setIsLoading,
    setError
  } = useStore();
  const [selectedQueryIds, setSelectedQueryIds] = useState<string[]>([]);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    setIsLoading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        if (annotationExt.some((ext) => lower.endsWith(ext))) {
          const loaded = await uploadAnnotationFile(file);
          setAnnotations([...annotations, ...loaded]);
        } else {
          const loaded = await uploadSequenceFile(file);
          setSequences([...sequences, ...loaded]);
        }
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  const compare = async () => {
    const reference = sequences.find((item) => item.id === referenceId);
    const queries = sequences.filter((item) => selectedQueryIds.includes(item.id) && item.id !== referenceId);
    if (!reference || queries.length === 0) return;

    setIsLoading(true);
    try {
      const result =
        queries.length === 1
          ? await comparePairwise(reference, queries[0], annotations)
          : await compareBatch(reference, queries, annotations);
      setComparisonResult(result);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <input type="file" multiple onChange={(e) => handleFiles(e.target.files)} />
      <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #30363d', padding: 6 }}>
        {sequences.map((seq) => (
          <label key={seq.id} style={{ display: 'block', marginBottom: 4 }}>
            <input type="radio" name="reference" checked={referenceId === seq.id} onChange={() => setReferenceId(seq.id)} /> ref{' '}
            <input
              type="checkbox"
              checked={selectedQueryIds.includes(seq.id)}
              onChange={(e) =>
                setSelectedQueryIds((prev) => (e.target.checked ? [...prev, seq.id] : prev.filter((item) => item !== seq.id)))
              }
            />{' '}
            {seq.id} ({seq.length}bp, {seq.gc_content.toFixed(2)}%, {seq.format})
          </label>
        ))}
      </div>
      <button onClick={compare} disabled={isLoading}>Compare</button>
    </div>
  );
}
