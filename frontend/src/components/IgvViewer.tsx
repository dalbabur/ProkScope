import { useEffect, useRef } from 'react';
import igv from 'igv';


export type IgvTrack = {
  type: 'alignment' | 'annotation' | string;
  format?: string;
  url: string;
  indexURL?: string;
  name: string;
  color?: string;
};

type Props = {
  /** URL of the reference FASTA file (must also have a .fai index at url + '.fai') */
  fastaUrl?: string;
  /** Reference display name */
  referenceName?: string;
  /** Tracks to display */
  tracks?: IgvTrack[];
  height?: number;
};

export function IgvViewer({ fastaUrl, referenceName, tracks = [], height = 400 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const browserRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current || !fastaUrl) return;

    // Build the browser config using `genome` key which accepts a ReferenceGenome object.
    // We cast to `any` here because IGV's complex union type is hard to satisfy statically
    // while still passing an inline ReferenceGenome object.
    const config: any = {
      genome: {
        id: referenceName || 'reference',
        fastaURL: fastaUrl,
        indexURL: fastaUrl + '.fai',
      },
      tracks: tracks.map((t) => ({
        type: t.type,
        format: t.format,
        url: t.url,
        indexURL: t.indexURL,
        name: t.name,
        color: t.color,
      })),
      showNavigation: true,
      showRuler: true,
    };

    let cancelled = false;

    igv.createBrowser(containerRef.current, config)
      .then((browser: any) => {
        if (!cancelled) {
          browserRef.current = browser;
        } else {
          igv.removeBrowser(browser);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) console.error('IGV browser creation failed:', err);
      });

    return () => {
      cancelled = true;
      if (browserRef.current) {
        try {
          igv.removeBrowser(browserRef.current);
        } catch {
          // ignore cleanup errors
        }
        browserRef.current = null;
      }
    };
    // Re-create browser when reference or tracks change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fastaUrl, referenceName, JSON.stringify(tracks)]);

  if (!fastaUrl) {
    return (
      <div
        style={{
          height,
          border: '1px solid #30363d',
          borderRadius: 8,
          background: '#161b22',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#8b949e',
          fontSize: 13,
        }}
      >
        No alignment data available
      </div>
    );
  }

  return (
    <div
      style={{ border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden', minHeight: height }}
      ref={containerRef}
    />
  );
}
