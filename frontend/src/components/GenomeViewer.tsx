import { useEffect, useMemo } from 'react';
import { GoslingComponent } from 'gosling.js';

type Props = {
  spec: any;
  height?: number;
  onRangeSelect?: (range: { start: number; end: number } | null) => void;
};

export function GenomeViewer({ spec, height = 420, onRangeSelect }: Props) {
  const hasSpec = useMemo(() => spec && spec.views?.length, [spec]);
  useEffect(() => {
    onRangeSelect?.(null);
  }, [onRangeSelect, spec]);

  if (!hasSpec) {
    return <div style={{ height, border: '1px solid #30363d', borderRadius: 8, background: '#161b22' }} />;
  }

  return (
    <div style={{ border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
      <GoslingComponent spec={spec} />
    </div>
  );
}
