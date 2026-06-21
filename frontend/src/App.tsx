import * as Tabs from '@radix-ui/react-tabs';
import { AnnotateTab } from './components/AnnotateTab';
import { CompareTab } from './components/CompareTab';
import { VerifyAssembleTab } from './components/VerifyAssembleTab';

export default function App() {
  return (
    <div style={{ height: '100vh', background: '#0d1117', color: '#e6edf3', display: 'flex', flexDirection: 'column' }}>
      <Tabs.Root defaultValue="verify" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {/* Tab bar */}
        <Tabs.List
          style={{
            display: 'flex',
            borderBottom: '1px solid #30363d',
            background: '#0d1117',
            padding: '0 12px',
            flexShrink: 0,
          }}
        >
          {(['verify', 'annotate', 'compare'] as const).map((tab) => (
            <Tabs.Trigger key={tab} value={tab} asChild>
              {/* We render a button and style it based on the active state via CSS data attributes */}
              <button
                style={{
                  padding: '10px 20px',
                  fontSize: 13,
                  fontWeight: 500,
                  background: 'transparent',
                  color: '#8b949e',
                  border: 'none',
                  borderBottom: '2px solid transparent',
                  cursor: 'pointer',
                  outline: 'none',
                  transition: 'color 0.15s, border-color 0.15s',
                }}
                data-tab={tab}
              >
                {tab === 'verify' && 'Verify / Assemble'}
                {tab === 'annotate' && 'Annotate'}
                {tab === 'compare' && 'Compare'}
              </button>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Tab contents */}
        <Tabs.Content value="verify" style={{ flex: 1, overflow: 'hidden' }}>
          <VerifyAssembleTab />
        </Tabs.Content>

        <Tabs.Content value="annotate" style={{ flex: 1, overflow: 'hidden' }}>
          <AnnotateTab />
        </Tabs.Content>

        <Tabs.Content value="compare" style={{ flex: 1, overflow: 'hidden' }}>
          <CompareTab />
        </Tabs.Content>
      </Tabs.Root>

      <style>{`
        [data-radix-collection-item][data-state="active"] {
          color: #e6edf3 !important;
          border-bottom-color: #388bfd !important;
          font-weight: 600 !important;
        }
        [data-radix-collection-item]:hover {
          color: #e6edf3 !important;
        }
      `}</style>
    </div>
  );
}

