import { useEffect, useRef, useState } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import { syntaxHighlighting } from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import type { Language } from 'web-tree-sitter';
import { initPython, parsePython } from '../parse/parser';
import { ResolverEngine, type MatchIndex } from '../resolve/engine';
import type { Range, ResolvedCard } from '../resolve/types';
import { useAppStore } from '../app/store';
import { loadPythonPack } from '../packs/loadPack';
import { recordLookup } from '../analytics/events';
import { Card } from './Card';

// ── decorations: one mark class over every tappable range (spec §6.6) ──────
const setTapRanges = StateEffect.define<Range[]>();
const tapMark = Decoration.mark({ class: 'sr-tap' });
const tapField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setTapRanges)) {
        return Decoration.set(
          e.value.filter((r) => r.to > r.from).map((r) => tapMark.range(r.from, r.to)),
          true,
        );
      }
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const readerTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', fontSize: '14px' },
    '.cm-content': {
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      padding: '16px 0',
      caretColor: 'transparent',
    },
    '.cm-line': { padding: '0 16px', lineHeight: '1.75' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--sr-muted)',
    },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: true },
);

// Module-level singletons: language + engine compile once per app life.
let enginePromise: Promise<{ language: Language; engine: ResolverEngine }> | null = null;
function getEngine() {
  if (!enginePromise) {
    enginePromise = loadPythonPack().then((pack) =>
      initPython({
        core: '/web-tree-sitter.wasm',
        grammar: pack.grammar,
      }).then((language) => ({
        language,
        engine: new ResolverEngine(language, pack.concepts, pack.config, pack.t1),
      })),
    );
  }
  return enginePromise;
}

interface OpenCard {
  card: ResolvedCard;
  /** wrapper-relative anchor of the tapped range */
  anchor: { left: number; top: number; bottom: number };
}

interface ReaderProps {
  surface?: 'reader' | 'challenge';
  onLookup?: () => void;
}

export function Reader({ surface = 'reader', onLookup }: ReaderProps) {
  const code = useAppStore((s) => s.code);
  const level = useAppStore((s) => s.level);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const indexRef = useRef<MatchIndex | null>(null);
  const onLookupRef = useRef(onLookup);
  const surfaceRef = useRef(surface);
  const [open, setOpen] = useState<OpenCard | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onLookupRef.current = onLookup;
  }, [onLookup]);

  useEffect(() => {
    surfaceRef.current = surface;
  }, [surface]);

  // (Re)build the editor whenever the code changes.
  useEffect(() => {
    let cancelled = false;
    setOpen(null);
    setReady(false);

    const parent = wrapperRef.current;
    if (!parent) return;

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: code,
        extensions: [
          python(),
          syntaxHighlighting(oneDarkHighlightStyle),
          readerTheme,
          tapField,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            click: (event, v) => {
              const pos = v.posAtCoords({ x: event.clientX, y: event.clientY });
              handleTap(pos, v);
            },
          }),
        ],
      }),
    });
    viewRef.current = view;

    getEngine()
      .then(({ engine }) => {
        if (cancelled) return;
        const tree = parsePython(code);
        indexRef.current = engine.index(tree);
        const currentLevel = useAppStore.getState().level;
        view.dispatch({
          effects: setTapRanges.of(indexRef.current.tappableRanges(currentLevel)),
        });
        setReady(true);
      })
      .catch((err) => {
        console.error('sightread: engine init failed', err);
      });

    function handleTap(pos: number | null, v: EditorView) {
      const start = performance.now();
      const index = indexRef.current;
      if (pos == null || !index) {
        setOpen(null);
        return;
      }
      const resolved = index.resolveAt(pos, useAppStore.getState().level);
      if (!resolved) {
        setOpen(null);
        return;
      }
      recordLookup(resolved, surfaceRef.current, performance.now() - start);
      onLookupRef.current?.();
      const coords = v.coordsAtPos(resolved.range.from);
      const wrapperBox = parent!.getBoundingClientRect();
      setOpen({
        card: resolved,
        anchor: coords
          ? {
              left: coords.left - wrapperBox.left,
              top: coords.top - wrapperBox.top,
              bottom: coords.bottom - wrapperBox.top,
            }
          : { left: 16, top: 16, bottom: 32 },
      });
    }

    return () => {
      cancelled = true;
      view.destroy();
      viewRef.current = null;
      indexRef.current = null;
    };
  }, [code]);

  // Level changes regate the decorations (spec §5.2 level_gate).
  useEffect(() => {
    const view = viewRef.current;
    const index = indexRef.current;
    if (view && index) {
      view.dispatch({ effects: setTapRanges.of(index.tappableRanges(level)) });
    }
  }, [level]);

  // Escape closes the card.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const cardStyle: React.CSSProperties | undefined =
    open && !isNarrow
      ? open.anchor.top > 240
        ? {
            position: 'absolute',
            left: Math.max(8, Math.min(open.anchor.left, (wrapperRef.current?.clientWidth ?? 400) - 348)),
            top: open.anchor.top - 10,
            transform: 'translateY(-100%)',
          }
        : {
            position: 'absolute',
            left: Math.max(8, Math.min(open.anchor.left, (wrapperRef.current?.clientWidth ?? 400) - 348)),
            top: open.anchor.bottom + 10,
          }
      : undefined;

  return (
    <div className="sr-reader" data-surface={surface} ref={wrapperRef}>
      {!ready && <div className="sr-loading">warming up the reader…</div>}
      {open && (
        <div className={isNarrow ? 'sr-sheet' : 'sr-popover'} style={cardStyle}>
          <Card
            card={open.card}
            level={level}
            onClose={() => setOpen(null)}
            onShowConcept={(card) => setOpen({ ...open, card })}
          />
        </div>
      )}
    </div>
  );
}
