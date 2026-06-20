import { useState } from 'react';
import type { BatchComparisonResult, ComparisonResult } from '../types';

type Props = {
  result: ComparisonResult | BatchComparisonResult | null;
};

function isBatch(result: ComparisonResult | BatchComparisonResult | null): result is BatchComparisonResult {
  return Boolean(result && 'results' in result);
}

export function ComparisonView({ result }: Props) {
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);

  if (!result) {
    return <div>No comparison yet.</div>;
  }

  if (!isBatch(result)) {
    return (
      <div>
        <div style={{ marginBottom: 8 }}>
          Identity: {result.identity}% | Score: {result.alignment_score} | Mutations: {result.mutations.length}
        </div>
        <pre className="mono" style={{ maxHeight: 200, overflow: 'auto', background: '#161b22', padding: 8 }}>
          {result.aligned_ref}\n{result.aligned_query}
        </pre>
      </div>
    );
  }

  const pair = result.results.find((item) => item.query_id === selectedQuery) || result.results[0];

  return (
    <div>
      <table style={{ width: '100%', marginBottom: 8 }}>
        <thead>
          <tr>
            <th>Query</th><th>Identity</th><th>SNP</th><th>Ins</th><th>Del</th>
          </tr>
        </thead>
        <tbody>
          {result.results.map((item) => {
            const snp = item.mutations.filter((m) => m.type === 'SNP').length;
            const ins = item.mutations.filter((m) => m.type === 'insertion').length;
            const del = item.mutations.filter((m) => m.type === 'deletion').length;
            return (
              <tr key={item.query_id} onClick={() => setSelectedQuery(item.query_id)} style={{ cursor: 'pointer' }}>
                <td>{item.query_id}</td><td>{item.identity}</td><td>{snp}</td><td>{ins}</td><td>{del}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {pair && (
        <pre className="mono" style={{ maxHeight: 200, overflow: 'auto', background: '#161b22', padding: 8 }}>
          {pair.aligned_ref}\n{pair.aligned_query}
        </pre>
      )}
    </div>
  );
}
