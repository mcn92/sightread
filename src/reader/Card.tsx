import type { Level, ResolvedCard } from '../resolve/types';

const FRIENDLY_NODE: Record<string, string> = {
  identifier: 'a name defined in this file',
  integer: 'a whole-number literal',
  float: 'a decimal-number literal',
  comment: 'a comment — notes for humans, ignored by Python',
  string_content: 'plain text inside a string',
  string_start: 'the opening quote of a string',
  string_end: 'the closing quote of a string',
};

const CATEGORY_LABEL: Record<string, string> = {
  syntax: 'syntax',
  builtin: 'built-in',
  stdlib: 'standard library',
  operator: 'operator',
  pattern: 'pattern',
  idiom: 'idiom',
};

export interface CardProps {
  card: ResolvedCard;
  level: Level;
  onClose: () => void;
  onShowConcept?: (card: ResolvedCard) => void;
}

export function Card({ card, level, onClose, onShowConcept }: CardProps) {
  return (
    <div className="sr-card" role="dialog" aria-label="Explanation">
      <button className="sr-card-close" onClick={onClose} aria-label="Close explanation">
        ×
      </button>
      {card.kind === 'concept' && (
        <>
          <div className="sr-card-eyebrow">{CATEGORY_LABEL[card.concept.category]}</div>
          <h2 className="sr-card-title">
            <mark>{card.concept.names[0]}</mark>
          </h2>
          <p className="sr-card-body">{card.concept.levels[level].body}</p>
          <pre className="sr-card-example">
            <code>{card.concept.example.code}</code>
          </pre>
          <p className="sr-card-gotcha">
            <span>Gotcha</span> {card.concept.gotcha}
          </p>
        </>
      )}
      {card.kind === 'shadow' && (
        <>
          <div className="sr-card-eyebrow">in this file</div>
          <h2 className="sr-card-title">
            <mark>{card.name}</mark>
          </h2>
          <p className="sr-card-body">
            Here, <code>{card.name}</code> has been given a value of its own on line{' '}
            {card.definitionLine} of this
            file — so it refers to that local variable, not the built-in{' '}
            <code>{card.shadowedConcept.names[0]}</code>.
          </p>
          {onShowConcept && (
            <button
              className="sr-card-link"
              onClick={() =>
                onShowConcept({
                  kind: 'concept',
                  concept: card.shadowedConcept,
                  range: card.range,
                })
              }
            >
              Show the built-in {card.shadowedConcept.names[0]} card
            </button>
          )}
        </>
      )}
      {card.kind === 'lexical' && (
        <>
          <div className="sr-card-eyebrow">token</div>
          <h2 className="sr-card-title">
            <mark>{card.text}</mark>
          </h2>
          <p className="sr-card-body">
            This is {FRIENDLY_NODE[card.nodeType] ?? `a ${card.nodeType.replace(/_/g, ' ')}`}.
            Sightread doesn't have a full card for it yet.
          </p>
        </>
      )}
    </div>
  );
}
