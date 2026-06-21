import type { Annotation, BatchComparisonResult, ComparisonResult, SequenceRecord } from '../types';

const FEATURE_COLORS: Record<string, string> = {
  CDS: '#3fb950',
  rRNA: '#ff9f43',
  tRNA: '#a371f7',
  gene: '#58a6ff'
};

const MAX_BASE_TEXT_POINTS = 20000;
const MAX_ANNOTATIONS_FOR_VIEW = 50000;

function isBatchResult(result: ComparisonResult | BatchComparisonResult | null): result is BatchComparisonResult {
  return Boolean(result && 'results' in result);
}

export function buildGoslingSpec(
  sequences: SequenceRecord[],
  annotations: Annotation[],
  comparisonResult: ComparisonResult | BatchComparisonResult | null
) {
  const reference = sequences[0];
  if (!reference) {
    return {
      title: 'Genome Viewer',
      arrangement: 'vertical',
      views: []
    };
  }

  const refLength = Math.max(1, reference?.length ?? 1);
  const domain = { chromosome: 'chr', interval: [1, refLength] as [number, number] };

  const safeAnnotations = annotations
    .filter((ann) => Number.isFinite(ann.start) && Number.isFinite(ann.end) && ann.end >= ann.start)
    .slice(0, MAX_ANNOTATIONS_FOR_VIEW);
  const allMutations = comparisonResult
    ? isBatchResult(comparisonResult)
      ? comparisonResult.results.flatMap((item) => item.mutations)
      : comparisonResult.mutations
    : [];

  const mutationBins = new Map<number, number>();
  for (const mutation of allMutations) {
    if (!Number.isFinite(mutation.position) || mutation.position < 1) {
      continue;
    }
    const bin = Math.floor(mutation.position / 100) * 100;
    mutationBins.set(bin, (mutationBins.get(bin) || 0) + 1);
  }

  const mutationDensityData = [...mutationBins.entries()].map(([position, count]) => ({ position, count }));
  const canRenderBaseLetters = refLength > 0 && refLength <= MAX_BASE_TEXT_POINTS;
  const sequenceData = canRenderBaseLetters
    ? reference.sequence.split('').map((base, index) => ({ position: index + 1, base }))
    : [];

  const tracks: any[] = [
    {
      linkingId: 'genome-axis',
      data: { values: safeAnnotations, type: 'json' },
      x: { field: 'start', type: 'genomic', axis: 'none', domain },
      xe: { field: 'end', type: 'genomic' },
      y: { field: 'feature_type', type: 'nominal' },
      mark: 'rect',
      color: {
        field: 'feature_type',
        type: 'nominal',
        domain: Object.keys(FEATURE_COLORS),
        range: Object.values(FEATURE_COLORS)
      },
      tooltip: [
        { field: 'name', type: 'nominal' },
        { field: 'start', type: 'quantitative' },
        { field: 'end', type: 'quantitative' }
      ],
      width: 900,
      height: 100
    },
    {
      linkingId: 'genome-axis',
      data: { values: mutationDensityData, type: 'json' },
      x: { field: 'position', type: 'genomic', axis: 'none', domain },
      y: { field: 'count', type: 'quantitative', axis: 'none' },
      mark: 'line',
      color: { value: '#f85149' },
      width: 900,
      height: 40
    }
  ];

  if (canRenderBaseLetters) {
    tracks.unshift({
      linkingId: 'genome-axis',
      data: { values: sequenceData, type: 'json' },
      x: { field: 'position', type: 'genomic', axis: 'bottom', domain },
      mark: 'text',
      text: { field: 'base', type: 'nominal' },
      color: { value: '#e6edf3' },
      style: { outline: 'none' },
      width: 900,
      height: 80
    });
  }

  if (comparisonResult && isBatchResult(comparisonResult)) {
    comparisonResult.results.forEach((item) => {
      tracks.push({
        linkingId: 'genome-axis',
        data: { values: item.mutations.map((mutation) => ({ ...mutation, query_id: item.query_id })), type: 'json' },
        x: { field: 'position', type: 'genomic', axis: 'none', domain },
        y: { value: 1 },
        mark: 'point',
        color: {
          field: 'type',
          type: 'nominal',
          domain: ['SNP', 'insertion', 'deletion'],
          range: ['#d29922', '#39c5cf', '#f85149']
        },
        width: 900,
        height: 40,
        title: item.query_id
      });
    });
  }

  return {
    title: 'Genome Viewer',
    arrangement: 'vertical',
    views: tracks
  };
}
