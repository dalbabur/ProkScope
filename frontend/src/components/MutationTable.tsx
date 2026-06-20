import { useMemo, useState } from 'react';
import type { Mutation } from '../types';

type Props = {
  mutations: Mutation[];
  onSelectPosition?: (position: number) => void;
};

export function MutationTable({ mutations, onSelectPosition }: Props) {
  const [sortKey, setSortKey] = useState<keyof Mutation>('position');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [featureFilter, setFeatureFilter] = useState<string>('');

  const filtered = useMemo(() => {
    return [...mutations]
      .filter((item) => (typeFilter === 'all' ? true : item.type === typeFilter))
      .filter((item) => (featureFilter ? (item.in_feature || '').toLowerCase().includes(featureFilter.toLowerCase()) : true))
      .sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        return av > bv ? 1 : av < bv ? -1 : 0;
      });
  }, [mutations, sortKey, typeFilter, featureFilter]);

  const exportCsv = () => {
    const rows = [['position', 'ref', 'alt', 'type', 'in_feature'], ...filtered.map((m) => [m.position, m.ref, m.alt, m.type, m.in_feature || ''])];
    const csv = rows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mutations.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="SNP">SNP</option>
          <option value="insertion">insertion</option>
          <option value="deletion">deletion</option>
        </select>
        <input placeholder="Filter feature" value={featureFilter} onChange={(e) => setFeatureFilter(e.target.value)} />
        <button onClick={exportCsv}>Export CSV</button>
      </div>
      <div style={{ maxHeight: 250, overflow: 'auto', border: '1px solid #30363d' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }} className="mono">
          <thead>
            <tr>
              {['position', 'ref', 'alt', 'type', 'in_feature'].map((header) => (
                <th key={header} style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => setSortKey(header as keyof Mutation)}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((mutation, index) => (
              <tr key={`${mutation.position}-${mutation.type}-${index}`} onClick={() => onSelectPosition?.(mutation.position)} style={{ cursor: 'pointer' }}>
                <td>{mutation.position}</td>
                <td>{mutation.ref}</td>
                <td>{mutation.alt}</td>
                <td>{mutation.type}</td>
                <td>{mutation.in_feature || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
