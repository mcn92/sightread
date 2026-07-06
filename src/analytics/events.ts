import type { ResolvedCard } from '../resolve/types';

type EntrySource = 'direct' | 'share_link' | 'challenge_link' | 'pwa_icon';
type SnippetSource = 'paste' | 'challenge' | 'sample' | 'url_import';
type LookupTier = 't0' | 't1_hit' | 't1_miss' | 'lexical';
type LookupSurface = 'reader' | 'challenge' | 'deck';
type ShareMethod = 'native_share' | 'copy';

type AnalyticsEvent =
  | { name: 'app_opened'; props: { entry: EntrySource; first_ever: boolean } }
  | { name: 'snippet_loaded'; props: { source: SnippetSource; line_count_bucket: string; parse_ok: boolean } }
  | {
      name: 'lookup';
      props: {
        concept_id: string | null;
        tier: LookupTier;
        surface: LookupSurface;
        latency_bucket: string;
        shadowed: boolean;
      };
    }
  | { name: 'challenge_started'; props: { challenge_id: string } }
  | {
      name: 'challenge_completed';
      props: { challenge_id: string; correct: boolean; lookups_used: string; duration_bucket: string };
    }
  | { name: 'challenge_shared'; props: { challenge_id: string; method: ShareMethod } }
  | { name: 'level_changed'; props: { from: string; to: string } };

interface StoredEvent {
  id: string;
  name: AnalyticsEvent['name'];
  ts: string;
  session_id: string;
  device_id: string;
  props: AnalyticsEvent['props'];
}

const DEVICE_KEY = 'sightread:analytics:device_id';
const OPENED_KEY = 'sightread:analytics:opened';
const EVENTS_KEY = 'sightread:analytics:events';
const MAX_BUFFERED_EVENTS = 500;

const sessionId = createId();

export function recordAppOpened() {
  const firstEver = localStorage.getItem(OPENED_KEY) !== '1';
  localStorage.setItem(OPENED_KEY, '1');
  trackEvent({ name: 'app_opened', props: { entry: detectEntrySource(), first_ever: firstEver } });
}

export function recordSnippetLoaded(source: SnippetSource, code: string, parseOk = true) {
  trackEvent({
    name: 'snippet_loaded',
    props: {
      source,
      line_count_bucket: bucketLineCount(code),
      parse_ok: parseOk,
    },
  });
}

export function recordLookup(card: ResolvedCard, surface: LookupSurface, latencyMs: number) {
  trackEvent({
    name: 'lookup',
    props: {
      concept_id: conceptIdForCard(card),
      tier: tierForCard(card),
      surface,
      latency_bucket: bucketLatency(latencyMs),
      shadowed: card.kind === 'shadow',
    },
  });
}

export function recordChallengeStarted(challengeId: string) {
  trackEvent({ name: 'challenge_started', props: { challenge_id: challengeId } });
}

export function recordChallengeCompleted(challengeId: string, correct: boolean, lookups: number, durationMs: number) {
  trackEvent({
    name: 'challenge_completed',
    props: {
      challenge_id: challengeId,
      correct,
      lookups_used: bucketChallengeLookups(lookups),
      duration_bucket: bucketDuration(durationMs),
    },
  });
}

export function recordChallengeShared(challengeId: string, method: ShareMethod) {
  trackEvent({ name: 'challenge_shared', props: { challenge_id: challengeId, method } });
}

export function recordLevelChanged(from: string, to: string) {
  if (from !== to) {
    trackEvent({ name: 'level_changed', props: { from, to } });
  }
}

function trackEvent(event: AnalyticsEvent) {
  const stored: StoredEvent = {
    id: createId(),
    name: event.name,
    ts: new Date().toISOString(),
    session_id: sessionId,
    device_id: getDeviceId(),
    props: event.props,
  };

  const current = readBufferedEvents();
  current.push(stored);
  localStorage.setItem(EVENTS_KEY, JSON.stringify(current.slice(-MAX_BUFFERED_EVENTS)));

  if (import.meta.env.DEV) {
    console.debug('sightread:event', stored);
  }
}

function readBufferedEvents(): StoredEvent[] {
  const raw = localStorage.getItem(EVENTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as StoredEvent[];
  } catch {
    return [];
  }
}

function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;

  const next = createId();
  localStorage.setItem(DEVICE_KEY, next);
  return next;
}

function detectEntrySource(): EntrySource {
  const params = new URLSearchParams(window.location.search);
  if (params.has('share')) return 'share_link';
  if (window.location.pathname.startsWith('/challenge')) return 'challenge_link';
  if (window.matchMedia('(display-mode: standalone)').matches) return 'pwa_icon';
  return 'direct';
}

function conceptIdForCard(card: ResolvedCard) {
  if (card.kind === 'concept') return card.concept.id;
  if (card.kind === 'shadow') return card.shadowedConcept.id;
  return null;
}

function tierForCard(card: ResolvedCard): LookupTier {
  if (card.kind === 'concept') return card.tier ?? 't0';
  if (card.kind === 'shadow') return 't0';
  return card.tier ?? 'lexical';
}

function bucketLineCount(code: string) {
  const lines = code.split('\n').length;
  if (lines <= 10) return '1-10';
  if (lines <= 50) return '11-50';
  if (lines <= 200) return '51-200';
  return '>200';
}

function bucketLatency(ms: number) {
  if (ms < 50) return '<50ms';
  if (ms < 100) return '50-99ms';
  if (ms < 250) return '100-249ms';
  return '>=250ms';
}

function bucketDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 30) return '<30s';
  if (seconds < 120) return '30-119s';
  if (seconds < 300) return '2-5m';
  return '>5m';
}

function bucketChallengeLookups(lookups: number) {
  if (lookups === 0) return '0';
  if (lookups <= 2) return '1-2';
  return '3+';
}

function createId() {
  return crypto.randomUUID();
}
