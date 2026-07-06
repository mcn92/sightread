import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useAppStore } from '../app/store';

export interface DailyChallenge {
  id: string;
  number: number;
  lang: 'py';
  date: string;
  snippet: string;
  question: string;
  choices: string[];
  answer_index: number;
  tappable_concepts: string[];
}

interface LatestChallenge {
  date: string;
  path: string;
}

interface ChallengeProps {
  Reader: ComponentType<{ surface?: 'reader' | 'challenge'; onLookup?: () => void }>;
}

export function Challenge({ Reader }: ChallengeProps) {
  const setCode = useAppStore((s) => s.setCode);
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [lookups, setLookups] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadLatestChallenge()
      .then((nextChallenge) => {
        if (cancelled) return;
        setChallenge(nextChallenge);
        setCode(nextChallenge.snippet);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'challenge failed to load');
      });

    return () => {
      cancelled = true;
    };
  }, [setCode]);

  const correct = challenge && selected === challenge.answer_index;
  const shareText = useMemo(() => {
    if (!challenge || !submitted) return '';
    return buildShareText(challenge, Boolean(correct), lookups);
  }, [challenge, correct, lookups, submitted]);

  if (loadError) {
    return <div className="sr-challenge-panel">Daily challenge is unavailable: {loadError}</div>;
  }

  if (!challenge) {
    return <div className="sr-challenge-panel">loading challenge…</div>;
  }

  return (
    <section className="sr-challenge" aria-labelledby="sr-challenge-title">
      <div className="sr-challenge-head">
        <div>
          <p className="sr-challenge-kicker">Daily Python #{challenge.number}</p>
          <h1 id="sr-challenge-title" className="sr-challenge-title">
            {challenge.question}
          </h1>
        </div>
        <div className="sr-challenge-stat">{lookups} lookups</div>
      </div>

      <Reader surface="challenge" onLookup={() => setLookups((value) => value + 1)} />

      <div className="sr-choices" role="radiogroup" aria-label="Challenge answers">
        {challenge.choices.map((choice, index) => {
          const isSelected = selected === index;
          const isCorrect = submitted && index === challenge.answer_index;
          const isWrong = submitted && isSelected && !isCorrect;
          return (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={[
                'sr-choice',
                isSelected ? 'sr-choice-selected' : '',
                isCorrect ? 'sr-choice-correct' : '',
                isWrong ? 'sr-choice-wrong' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={submitted}
              onClick={() => setSelected(index)}
            >
              <span>{String.fromCharCode(65 + index)}</span>
              {choice}
            </button>
          );
        })}
      </div>

      <div className="sr-challenge-actions">
        {!submitted ? (
          <button
            type="button"
            className="sr-btn sr-btn-primary"
            disabled={selected == null}
            onClick={() => setSubmitted(true)}
          >
            Submit answer
          </button>
        ) : (
          <>
            <p className={correct ? 'sr-result sr-result-correct' : 'sr-result sr-result-wrong'}>
              {correct ? 'Correct.' : 'Not quite.'}
            </p>
            <button
              type="button"
              className="sr-btn sr-btn-primary"
              onClick={() =>
                shareChallenge(shareText)
                  .then((copied) => setShareCopied(copied))
                  .catch((err: unknown) => {
                    console.warn('sightread: challenge share failed', err);
                  })
              }
            >
              {shareCopied ? 'Copied' : 'Share result'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

async function loadLatestChallenge(): Promise<DailyChallenge> {
  const latest = await fetchJson<LatestChallenge>('/challenges/py/latest.json');
  return fetchJson<DailyChallenge>(latest.path);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return (await response.json()) as T;
}

function buildShareText(challenge: DailyChallenge, correct: boolean, lookups: number) {
  const result = correct ? 'solved' : 'missed';
  const lookupText = lookups === 1 ? '1 lookup' : `${lookups} lookups`;
  return `Sightread #${challenge.number} - ${result}, ${lookupText}`;
}

async function shareChallenge(text: string) {
  if (navigator.share) {
    await navigator.share({ text });
    return false;
  }

  await navigator.clipboard.writeText(text);
  return true;
}
