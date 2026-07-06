import { Suspense, lazy, useState } from 'react';
import { SAMPLE_CODE, useAppStore } from './store';
import { LEVELS, type Level } from '../resolve/types';

const Reader = lazy(() => import('../reader/Reader').then((module) => ({ default: module.Reader })));

const LEVEL_LABEL: Record<Level, string> = {
  novice: 'New to this',
  learning: 'Learning',
  comfortable: 'Comfortable',
};

export function App() {
  const level = useAppStore((s) => s.level);
  const setLevel = useAppStore((s) => s.setLevel);
  const setCode = useAppStore((s) => s.setCode);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [draft, setDraft] = useState('');

  return (
    <div className="sr-app">
      <header className="sr-header">
        <div className="sr-wordmark">
          Sightread
          <span className="sr-tagline">learn to read code</span>
        </div>
        <div className="sr-levels" role="radiogroup" aria-label="Your Python level">
          {LEVELS.map((l) => (
            <button
              key={l}
              role="radio"
              aria-checked={level === l}
              className={level === l ? 'sr-level sr-level-active' : 'sr-level'}
              onClick={() => setLevel(l)}
            >
              {LEVEL_LABEL[l]}
            </button>
          ))}
        </div>
      </header>

      <div className="sr-toolbar">
        <p className="sr-hint">
          Tap anything <span className="sr-hint-underline">underlined</span> to see what it means.
        </p>
        <div className="sr-toolbar-actions">
          <button className="sr-btn" onClick={() => setCode(SAMPLE_CODE)}>
            Load sample
          </button>
          <button className="sr-btn sr-btn-primary" onClick={() => setPasteOpen(true)}>
            Paste your own
          </button>
        </div>
      </div>

      {pasteOpen && (
        <div className="sr-paste">
          <textarea
            className="sr-paste-input"
            placeholder="Paste Python code here…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          <div className="sr-paste-actions">
            <button className="sr-btn" onClick={() => setPasteOpen(false)}>
              Cancel
            </button>
            <button
              className="sr-btn sr-btn-primary"
              disabled={draft.trim().length === 0}
              onClick={() => {
                setCode(draft);
                setPasteOpen(false);
              }}
            >
              Read it
            </button>
          </div>
        </div>
      )}

      <main className="sr-main">
        <Suspense fallback={<div className="sr-reader sr-reader-loading">loading reader…</div>}>
          <Reader />
        </Suspense>
      </main>

      <footer className="sr-footer">Python only, for now. Your code never leaves this page.</footer>
    </div>
  );
}
