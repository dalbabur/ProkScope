import type { Annotation, BatchComparisonResult, ComparisonResult, SequenceRecord } from '../types';

const FEATURE_COLORS: Record<string, string> = {
  CDS: '#3fb950',
  rRNA: '#ff9f43',
  tRNA: '#a371f7',
  gene: '#58a6ff'
};

function isBatchResult(result: ComparisonResult | BatchComparisonResult | null): result is BatchComparisonResult {
  return Boolean(result && 'results' in result);
}

export function buildGoslingSpec(
  sequences: SequenceRecord[],
  annotations: Annotation[],
  comparisonResult: ComparisonResult | BatchComparisonResult | null
) {
  const reference = sequences[0];
  const refLength = reference?.length ?? 0;
  const allMutations = comparisonResult
    ? isBatchResult(comparisonResult)
      ? comparisonResult.results.flatMap((item) => item.mutations)
      : comparisonResult.mutations
    : [];

  const mutationBins = new Map<number, number>();
  for (const mutation of allMutations) {
    const bin = Math.floor(mutation.position / 100) * 100;
    mutationBins.set(bin, (mutationBins.get(bin) || 0) + 1);
  }

  const mutationDensityData = [...mutationBins.entries()].map(([position, count]) => ({ position, count }));
  const sequenceData = reference
    ? reference.sequence.split('').map((base, index) => ({ position: index + 1, base }))
    : [];

  // Split annotations: feature DB hits (have a color field set) vs. standard annotations
  const featureDbHits = annotations.filter((a) => a.color != null);
  const standardAnnotations = annotations.filter((a) => a.color == null);

  const tracks: any[] = [
    {
      linkingId: 'genome-axis',
      data: { values: sequenceData, type: 'json' },
      x: { field: 'position', type: 'genomic', axis: 'bottom', domain: { chromosome: 'chr', interval: [0, refLength] } },
      mark: 'text',
      text: { field: 'base', type: 'nominal' },
      color: { value: '#e6edf3' },
      style: { outline: 'none' },
      width: 900,
      height: 80
    },
    {
      linkingId: 'genome-axis',
      data: { values: standardAnnotations, type: 'json' },
      x: { field: 'start', type: 'genomic', axis: 'none', domain: { chromosome: 'chr', interval: [0, refLength] } },
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
      x: { field: 'position', type: 'genomic', axis: 'none', domain: { chromosome: 'chr', interval: [0, refLength] } },
      y: { field: 'count', type: 'quantitative', axis: 'none' },
      mark: 'line',
      color: { value: '#f85149' },
      width: 900,
      height: 40
    }
  ];

  if (featureDbHits.length > 0) {
    tracks.push({
      linkingId: 'genome-axis',
      title: 'Feature DB Matches',
      data: { values: featureDbHits, type: 'json' },
      x: { field: 'start', type: 'genomic', axis: 'none', domain: { chromosome: 'chr', interval: [0, refLength] } },
      xe: { field: 'end', type: 'genomic' },
      row: { field: 'feature_type', type: 'nominal' },
      mark: 'rect',
      color: { field: 'color', type: 'nominal' },
      tooltip: [
        { field: 'name', type: 'nominal', alt: 'Name' },
        { field: 'feature_type', type: 'nominal', alt: 'Type' },
        { field: 'source', type: 'nominal', alt: 'Source Plasmid' },
        { field: 'start', type: 'quantitative', alt: 'Start' },
        { field: 'end', type: 'quantitative', alt: 'End' },
        { field: 'strand', type: 'nominal', alt: 'Strand' }
      ],
      width: 900,
      height: 50
    });
  }

  if (comparisonResult && isBatchResult(comparisonResult)) {
    comparisonResult.results.forEach((item) => {
      tracks.push({
        linkingId: 'genome-axis',
        data: { values: item.mutations.map((mutation) => ({ ...mutation, query_id: item.query_id })), type: 'json' },
        x: { field: 'position', type: 'genomic', axis: 'none', domain: { chromosome: 'chr', interval: [0, refLength] } },
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
