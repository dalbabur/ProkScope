import type { Annotation } from '../types';

type Props = {
  annotations: Annotation[];
  hiddenFeatureTypes: string[];
  onToggle: (featureType: string) => void;
};

const defaultColor = '#58a6ff';
const colorMap: Record<string, string> = { CDS: '#3fb950', rRNA: '#ff9f43', tRNA: '#a371f7', gene: '#58a6ff' };

export function AnnotationTrack({ annotations, hiddenFeatureTypes, onToggle }: Props) {
  const counts = annotations.reduce<Record<string, number>>((acc, ann) => {
    const key = ann.feature_type || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 8 }}>
      {Object.entries(counts).map(([feature, count]) => {
        const hidden = hiddenFeatureTypes.includes(feature);
        return (
          <button key={feature} onClick={() => onToggle(feature)} style={{ opacity: hidden ? 0.5 : 1 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, marginRight: 6, background: colorMap[feature] || defaultColor }} />
            {feature} ({count})
          </button>
        );
      })}
    </div>
  );
}
