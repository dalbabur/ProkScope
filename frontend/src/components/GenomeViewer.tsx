import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo } from 'react';
import { GoslingComponent } from 'gosling.js';

type Props = {
  spec: any;
  height?: number;
  onRangeSelect?: (range: { start: number; end: number } | null) => void;
};

type ErrorBoundaryProps = {
  children: ReactNode;
  height: number;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class ViewerErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Genome viewer crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ height: this.props.height, border: '1px solid #30363d', borderRadius: 8, background: '#161b22', padding: 12 }}>
          Genome viewer failed to render this dataset. Try loading a smaller sequence window or fewer annotations.
        </div>
      );
    }
    return this.props.children;
  }
}

export function GenomeViewer({ spec, height = 420, onRangeSelect }: Props) {
  const hasSpec = useMemo(() => spec && spec.views?.length, [spec]);
  useEffect(() => {
    onRangeSelect?.(null);
  }, [onRangeSelect, spec]);

  if (!hasSpec) {
    return <div style={{ height, border: '1px solid #30363d', borderRadius: 8, background: '#161b22' }} />;
  }

  return (
    <ViewerErrorBoundary height={height}>
      <div style={{ border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
        <GoslingComponent spec={spec} />
      </div>
    </ViewerErrorBoundary>
  );
}
