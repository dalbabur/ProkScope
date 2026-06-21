import { useState, useMemo } from 'react';
import type { BatchComparisonResult, ComparisonResult } from '../types';

type Props = {
  result: ComparisonResult | BatchComparisonResult | null;
};

function isBatch(result: ComparisonResult | BatchComparisonResult | null): result is BatchComparisonResult {
  return Boolean(result && 'results' in result);
}

const WINDOW = 120;   // characters per line
const MAX_LINES = 50; // max lines rendered at once

function AlignmentView({ alignedRef, alignedQuery }: { alignedRef: string; alignedQuery: string }) {
  const [page, setPage] = useState(0);

  const totalLen = alignedRef.length;
  const charsPerPage = WINDOW * MAX_LINES;
  const totalPages = Math.ceil(totalLen / charsPerPage);

  const lines = useMemo(() => {
    const start = page * charsPerPage;
    const refSlice   = alignedRef.slice(start, start + charsPerPage);
    const querySlice = alignedQuery.slice(start, start + charsPerPage);
    const out: { ref: string; match: string; query: string }[] = [];
    for (let i = 0; i < refSlice.length; i += WINDOW) {
      const r = refSlice.slice(i, i + WINDOW);
      const q = querySlice.slice(i, i + WINDOW);
      const m = r.split('').map((c, j) => (c === q[j] ? '|' : ' ')).join('');
      out.push({ ref: r, match: m, query: q });
    }
    return out;
  }, [alignedRef, alignedQuery, page, charsPerPage]);

  if (!totalLen) return <div style={{ fontSize: 12, color: '#484f58' }}>No alignment data.</div>;

  return (
    <div>
      <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>
        Alignment length: {totalLen.toLocaleString()} bp
        {totalPages > 1 && (
          <span style={{ marginLeft: 12 }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={btnStyle}
            >‹ Prev</button>
            <span style={{ margin: '0 8px' }}>Page {page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              style={btnStyle}
            >Next ›</button>
          </span>
        )}
      </div>
      <div
        style={{
          maxHeight: 260,
          overflow: 'auto',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 6,
          padding: '8px 10px',
          fontFamily: 'monospace',
          fontSize: 11,
          lineHeight: 1.4,
          whiteSpace: 'pre',
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <div style={{ color: '#58a6ff' }}>Ref   {line.ref}</div>
            <div style={{ color: '#484f58' }}>      {line.match}</div>
            <div style={{ color: '#3fb950' }}>Query {line.query}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '1px 6px',
  background: '#21262d',
  border: '1px solid #30363d',
  color: '#c9d1d9',
  borderRadius: 4,
  cursor: 'pointer',
};

export function ComparisonView({ result }: Props) {
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);

  if (!result) {
    return <div style={{ fontSize: 12, color: '#484f58' }}>No comparison yet.</div>;
  }

  if (!isBatch(result)) {
    return (
      <div>
        <div style={{ marginBottom: 8, fontSize: 12 }}>
          Identity: <strong>{result.identity}%</strong> &nbsp;|&nbsp;
          Score: {result.alignment_score} &nbsp;|&nbsp;
          Mutations: {result.mutations.length}
        </div>
        <AlignmentView alignedRef={result.aligned_ref} alignedQuery={result.aligned_query} />
      </div>
    );
  }

  const pair = result.results.find((item) => item.query_id === selectedQuery) || result.results[0];

  return (
    <div>
      <table style={{ width: '100%', marginBottom: 8, fontSize: 12 }}>
        <thead>
          <tr style={{ color: '#8b949e' }}>
            <th style={{ textAlign: 'left' }}>Query</th>
            <th>Identity</th><th>SNP</th><th>Ins</th><th>Del</th>
          </tr>
        </thead>
        <tbody>
          {result.results.map((item) => {
            const snp = item.mutations.filter((m) => m.type === 'SNP').length;
            const ins = item.mutations.filter((m) => m.type === 'insertion').length;
            const del = item.mutations.filter((m) => m.type === 'deletion').length;
            return (
              <tr
                key={item.query_id}
                onClick={() => setSelectedQuery(item.query_id)}
                style={{ cursor: 'pointer', background: selectedQuery === item.query_id ? '#161b22' : 'transparent' }}
              >
                <td>{item.query_id}</td>
                <td style={{ textAlign: 'center' }}>{item.identity}%</td>
                <td style={{ textAlign: 'center' }}>{snp}</td>
                <td style={{ textAlign: 'center' }}>{ins}</td>
                <td style={{ textAlign: 'center' }}>{del}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {pair && <AlignmentView alignedRef={pair.aligned_ref} alignedQuery={pair.aligned_query} />}
    </div>
  );
}