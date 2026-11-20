import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { fetchMonuments, submitDiscoveryQuestion } from '../lib/api';
import { getMonumentArchivalImage } from '../lib/monumentMedia';
import type { DiscoveryResponse, MonumentRecord } from '../types/heritage';
import type { AppRoute } from '../components/Navbar';

interface DiscoveryPageProps {
  initialMonumentId?: string;
  onNavigate: (route: AppRoute) => void;
}

interface AssistantTurn {
  id: string;
  question: string;
  scopeId: string;
  askedAt: string;
  response: DiscoveryResponse;
}

const SESSION_STORAGE_KEY = 'hv_heritage_assistant_session_v1';

const SUGGESTED_QUESTIONS: Array<{ category: string; prompt: string }> = [
  {
    category: 'Historical Background',
    prompt: 'Why was the Taj Mahal constructed?',
  },
  {
    category: 'Architecture & Construction',
    prompt: 'What is the architectural significance of Qutub Minar?',
  },
  {
    category: 'Historical Personalities',
    prompt: 'Who commissioned the Red Fort?',
  },
  {
    category: 'Preservation & Conservation',
    prompt: 'What conservation challenges affect the Taj Mahal?',
  },
  {
    category: 'Cultural Significance',
    prompt: 'Why is Hampi culturally and historically significant?',
  },
  {
    category: 'Feature-Based Discovery',
    prompt: 'Which monument has an acoustic whispering gallery?',
  },
  {
    category: 'Historical Comparison',
    prompt: "Compare Taj Mahal and Humayun's Tomb in historical period, style, and UNESCO year.",
  },
  {
    category: 'UNESCO World Heritage Status',
    prompt: 'List all UNESCO World Heritage sites in the knowledge base.',
  },
];

function formatTopicLabel(topic: string): string {
  switch (topic) {
    case 'history':
      return 'History';
    case 'architecture':
      return 'Architecture';
    case 'culture':
      return 'Cultural Significance';
    case 'personalities':
      return 'Historical Personalities';
    case 'unesco':
      return 'UNESCO Status';
    case 'preservation':
      return 'Preservation';
    case 'comparison':
      return 'Comparison';
    case 'overview':
    default:
      return 'Overview';
  }
}

function loadStoredTurns(): AssistantTurn[] {
  try {
    const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AssistantTurn[]) : [];
  } catch {
    return [];
  }
}

export function DiscoveryPage({ initialMonumentId, onNavigate }: DiscoveryPageProps) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const threadBottomRef = useRef<HTMLDivElement | null>(null);

  const [monuments, setMonuments] = useState<MonumentRecord[]>([]);
  const [selectedMonumentId, setSelectedMonumentId] = useState(initialMonumentId ?? 'auto');
  const [question, setQuestion] = useState('');
  const [loadingMonuments, setLoadingMonuments] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null);
  const [turns, setTurns] = useState<AssistantTurn[]>(() => loadStoredTurns());

  useEffect(() => {
    if (initialMonumentId) {
      setSelectedMonumentId(initialMonumentId);
    }
  }, [initialMonumentId]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(turns));
    } catch {
      // Ignore storage quota restrictions
    }
  }, [turns]);

  useEffect(() => {
    let active = true;
    async function loadMonumentOptions() {
      try {
        const res = await fetchMonuments();
        if (!active) return;
        setMonuments(res.monuments);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load monument list.');
        }
      } finally {
        if (active) setLoadingMonuments(false);
      }
    }

    void loadMonumentOptions();
    return () => {
      active = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  const selectedMonument =
    selectedMonumentId !== 'auto'
      ? monuments.find((m) => m.id === selectedMonumentId) ?? null
      : null;

  // Track the most recent turn that matched specific monuments so follow-up pronouns ("it", "its preservation") work cleanly
  const latestMatchedTurn = [...turns]
    .reverse()
    .find(
      (t) =>
        t.response.matchedMonumentIds.length > 0 &&
        t.response.monumentId !== 'catalogue' &&
        t.response.monumentId !== 'unmatched'
    );

  const lastMatchedMonumentIds = latestMatchedTurn?.response.matchedMonumentIds ?? [];
  const lastMatchedMonumentNames = latestMatchedTurn?.response.matchedMonumentNames ?? [];

  const executeQuestion = async (rawQuestion: string, overrideScopeId?: string) => {
    setError(null);
    setFailedQuestion(null);

    const trimmed = rawQuestion.trim();
    if (trimmed.length < 4) {
      setError('Please enter a question of at least 4 characters.');
      return;
    }

    const effectiveScopeId = overrideScopeId ?? (selectedMonumentId || 'auto');

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setSubmitting(true);
      const discoveryRes = await submitDiscoveryQuestion(effectiveScopeId, trimmed, {
        sessionMonumentIds: lastMatchedMonumentIds,
        signal: controller.signal,
      });

      const nextTurn: AssistantTurn = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        question: trimmed,
        scopeId: effectiveScopeId,
        askedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        response: discoveryRes,
      };

      setTurns((prev) => [...prev, nextTurn]);
      setQuestion('');

      window.setTimeout(() => {
        threadBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 60);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setFailedQuestion(trimmed);
      setError(
        err instanceof Error ? err.message : 'Failed to process Heritage Assistant inquiry.'
      );
    } finally {
      setSubmitting(false);
      abortControllerRef.current = null;
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await executeQuestion(question);
  };

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!submitting && !loadingMonuments) {
        void executeQuestion(question);
      }
    }
  };

  const handleSuggestedClick = async (promptText: string) => {
    if (submitting) return;
    setQuestion(promptText);
    await executeQuestion(promptText);
  };

  const handleFollowUpQuery = async (monumentId: string, promptText: string) => {
    if (submitting) return;
    await executeQuestion(promptText, monumentId);
  };

  const handleClearSession = () => {
    setTurns([]);
    setError(null);
    setFailedQuestion(null);
    try {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage error
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="border-b border-[#E2D9C8] pb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#7D5A1C]">
          Verified Knowledge-Base Retrieval &amp; Grounded Q&amp;A
        </p>
        <h1 className="mt-2 font-serif text-3xl font-semibold text-[#2B1E16] sm:text-4xl">
          AI Heritage Assistant
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#695547]">
          Ask natural-language questions about historical background, architecture, cultural
          significance, documented personalities, UNESCO World Heritage status, preservation and
          conservation threats, or cross-site comparisons. Every factual statement is retrieved from
          the verified 20-monument knowledge base with direct authoritative source links.
        </p>

        <dl className="mt-5 grid gap-4 border-t border-[#E2D9C8] pt-4 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[#695547]">Primary Knowledge Source</dt>
            <dd className="mt-0.5 font-mono font-medium text-[#2B1E16]">
              Verified 20-Site JSON Knowledge Base
            </dd>
          </div>
          <div>
            <dt className="text-[#695547]">Active Retrieval Engine</dt>
            <dd className="mt-0.5 font-mono text-[#2B1E16]">
              Entity, IDF-Lexical &amp; 6-Facet Preservation Retriever
            </dd>
          </div>
          <div>
            <dt className="text-[#695547]">Verification &amp; Citation Policy</dt>
            <dd className="mt-0.5 font-mono text-[#166534]">
              100% Cited Answers · Explicit Unverified Disclosure
            </dd>
          </div>
        </dl>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-12">
        {/* Left Column: Query Builder & Suggested Prompts */}
        <div className="space-y-6 lg:col-span-5">
          <form
            onSubmit={handleSubmit}
            className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6"
          >
            <h2 className="font-serif text-xl font-semibold text-[#2B1E16]">
              Ask the Heritage Assistant
            </h2>

            <div className="mt-5">
              <label
                htmlFor="discovery-monument-select"
                className="block text-xs font-medium text-[#695547]"
              >
                Query Scope (Optional Monument Pin)
              </label>
              <select
                id="discovery-monument-select"
                value={selectedMonumentId}
                disabled={loadingMonuments}
                onChange={(e) => setSelectedMonumentId(e.target.value)}
                className="mt-1.5 min-h-[42px] w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-2 text-sm text-[#2B1E16] focus:border-[#8B6624] focus:outline-none disabled:opacity-50"
              >
                <option value="auto">
                  All 20 Monuments — Auto-Detect, Search &amp; Comparisons
                </option>
                {monuments.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.accessionCode} — {m.name} ({m.state})
                  </option>
                ))}
              </select>

              {selectedMonument ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#695547]">
                  <span>
                    Verified sources:{' '}
                    <strong className="font-mono text-[#2B1E16] tabular-nums">
                      {
                        selectedMonument.sourceReferences.filter(
                          (s) => s.verificationStatus === 'verified'
                        ).length
                      }
                    </strong>
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedMonumentId('auto')}
                      className="cursor-pointer text-[#695547] underline decoration-[#E2D9C8] underline-offset-4 hover:text-[#2B1E16]"
                    >
                      Use Auto-Detect
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onNavigate({
                          page: 'monument-detail',
                          monumentId: selectedMonument.id,
                        })
                      }
                      className="cursor-pointer font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#2B1E16]"
                    >
                      Inspect Record
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-[#695547]">
                  Auto-Detect matches monument names, multi-site comparisons, architectural
                  features, regional queries, and session follow-ups.
                </p>
              )}

              {lastMatchedMonumentNames.length > 0 && selectedMonumentId === 'auto' && (
                <div className="mt-2.5 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-2 text-[11px] text-[#695547]">
                  <span className="font-medium text-[#2B1E16]">Active session context:</span>{' '}
                  {lastMatchedMonumentNames.join(', ')} (follow-ups using &ldquo;it&rdquo; or
                  &ldquo;its&rdquo; refer here)
                </div>
              )}
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="discovery-question-input"
                  className="block text-xs font-medium text-[#695547]"
                >
                  Natural-Language Question
                </label>
                <span className="font-mono text-[11px] text-[#695547] tabular-nums">
                  {question.length} / 500
                </span>
              </div>
              <textarea
                id="discovery-question-input"
                rows={4}
                maxLength={500}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleTextareaKeyDown}
                placeholder="Ask about history, architecture, rulers, UNESCO status, conservation challenges, or compare monuments..."
                className="mt-1.5 w-full rounded-md border border-[#E2D9C8] bg-[#FAF7F0] p-3 text-sm text-[#2B1E16] placeholder:text-[#695547]/60 focus:border-[#8B6624] focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-[#695547]">
                Press Enter to ask · Shift+Enter for a new line
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 space-y-2.5 rounded-md border border-[#B91C1C]/30 bg-[#FEF2F2] p-3.5 text-xs text-[#7F1D1D]"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
                {failedQuestion && !submitting && (
                  <button
                    type="button"
                    onClick={() => void executeQuestion(failedQuestion)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#B91C1C]/40 bg-white px-3 py-1.5 text-xs font-medium text-[#7F1D1D] hover:bg-[#FEE2E2]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Retry Question</span>
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || loadingMonuments}
              className="mt-5 inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-[#7D5A1C] px-5 py-2.5 text-sm font-medium text-[#FAF7F0] transition-colors hover:bg-[#654714] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Retrieving Verified Records...</span>
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" aria-hidden="true" />
                  <span>Ask Heritage Assistant</span>
                </>
              )}
            </button>
          </form>

          {/* Suggested Questions */}
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#695547]">
              Suggested Questions (All Knowledge Domains)
            </p>
            <p className="mt-1 text-[11px] text-[#695547]">
              Click any prompt to query the verified 20-site knowledge base directly.
            </p>
            <div className="mt-3 space-y-2">
              {SUGGESTED_QUESTIONS.map((item) => (
                <button
                  key={item.category}
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSuggestedClick(item.prompt)}
                  className="block w-full cursor-pointer rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3.5 py-2.5 text-left transition-colors hover:border-[#C8A55B] hover:bg-[#F3EDE1]/60 disabled:opacity-50"
                >
                  <span className="block font-mono text-[10px] uppercase tracking-wider text-[#7D5A1C]">
                    {item.category}
                  </span>
                  <span className="mt-0.5 block text-xs text-[#2B1E16]">{item.prompt}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Session Conversation History & Citations */}
        <div className="space-y-6 lg:col-span-7" aria-live="polite">
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <div className="flex flex-col gap-3 border-b border-[#E2D9C8] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium text-[#695547]">Current Browser Session</p>
                <h2 className="mt-0.5 font-serif text-xl font-semibold text-[#2B1E16]">
                  Conversation History &amp; Verified Citations
                </h2>
              </div>

              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-[#695547] tabular-nums">
                  {turns.length} {turns.length === 1 ? 'exchange' : 'exchanges'}
                </span>
                {turns.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearSession}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] px-3 py-1.5 text-xs font-medium text-[#2B1E16] hover:bg-[#F3EDE1]"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-[#695547]" aria-hidden="true" />
                    <span>Clear Session</span>
                  </button>
                )}
              </div>
            </div>

            {turns.length === 0 && !submitting && (
              <div className="mt-5 space-y-4 text-sm leading-relaxed text-[#695547]">
                <div className="flex items-start gap-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#7D5A1C]" aria-hidden="true" />
                  <p>
                    Ask a question on the left—or click any suggested prompt—to begin a grounded
                    research session. Every factual answer is retrieved from verified records with
                    authoritative UNESCO or ASI links. When details are unverified (null) or
                    outside the 20-monument dataset, the assistant explicitly informs you rather
                    than guessing.
                  </p>
                </div>
              </div>
            )}

            {/* Conversation Thread */}
            {turns.length > 0 && (
              <div className="mt-6 space-y-8">
                {turns.map((turn, turnIndex) => {
                  const res = turn.response;
                  const isGrounded = res.status === 'grounded_answer';
                  const isPartial = res.status === 'partial_grounded';
                  const isSingleMonument =
                    res.matchedMonumentIds.length === 1 &&
                    res.monumentId !== 'catalogue' &&
                    res.monumentId !== 'unmatched';

                  return (
                    <article
                      key={turn.id}
                      className="space-y-4 border-b border-[#E2D9C8] pb-8 last:border-b-0 last:pb-0"
                    >
                      {/* User Question Bubble */}
                      <div className="rounded-md border border-[#E2D9C8] bg-[#F3EDE1]/70 p-4">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[#695547]">
                          <span className="font-mono uppercase tracking-wider text-[#7D5A1C]">
                            Question #{turnIndex + 1}
                          </span>
                          <span className="font-mono tabular-nums">{turn.askedAt}</span>
                        </div>
                        <p className="mt-1.5 text-sm font-medium text-[#2B1E16]">
                          {turn.question}
                        </p>
                      </div>

                      {/* Grounded Assistant Answer */}
                      <div className="space-y-4 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] p-5">
                        <div className="flex flex-col gap-2 border-b border-[#E2D9C8] pb-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2">
                            {isGrounded ? (
                              <CheckCircle2
                                className="h-4 w-4 shrink-0 text-[#166534]"
                                aria-hidden="true"
                              />
                            ) : (
                              <ShieldAlert
                                className="h-4 w-4 shrink-0 text-[#7D5A1C]"
                                aria-hidden="true"
                              />
                            )}
                            <span className="text-xs font-semibold text-[#2B1E16]">
                              {isGrounded
                                ? `Verified Knowledge-Base Response · ${res.monumentName}`
                                : isPartial
                                  ? `Partially Verified Response · ${res.monumentName}`
                                  : `Could Not Be Verified · ${res.monumentName}`}
                            </span>
                          </div>

                          <span className="font-mono text-[11px] text-[#695547]">
                            Topics: {res.detectedTopics.map(formatTopicLabel).join(', ')}
                          </span>
                        </div>

                        {/* Matched Monument Dossier Cards */}
                        {res.matchedMonumentIds.length > 0 && (
                          <div className="space-y-2 border-b border-[#E2D9C8] pb-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs text-[#695547]">
                                Matched Knowledge-Base Record(s):
                              </span>
                              {res.monumentId !== 'catalogue' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onNavigate({
                                      page: 'preservation',
                                      compareIds: res.matchedMonumentIds.slice(0, 4),
                                    })
                                  }
                                  className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#2B1E16]"
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                  <span>Open in Preservation Explorer</span>
                                </button>
                              )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                              {res.matchedMonumentIds.slice(0, 6).map((mId, idx) => {
                                const thumb = getMonumentArchivalImage(mId);
                                const label = res.matchedMonumentNames[idx] ?? mId;
                                return (
                                  <button
                                    key={mId}
                                    type="button"
                                    onClick={() =>
                                      onNavigate({ page: 'monument-detail', monumentId: mId })
                                    }
                                    className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#E2D9C8] bg-[#FDFBF7] px-2.5 py-1.5 text-xs font-medium text-[#2B1E16] transition-colors hover:border-[#C8A55B] hover:bg-[#F3EDE1]/60"
                                  >
                                    {thumb && (
                                      <img
                                        src={thumb}
                                        alt={label}
                                        className="h-6 w-6 rounded-sm object-cover"
                                        loading="lazy"
                                      />
                                    )}
                                    <span>{label}</span>
                                    <ArrowUpRight
                                      className="h-3 w-3 text-[#7D5A1C]"
                                      aria-hidden="true"
                                    />
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Structured Answer Sections */}
                        {res.answerSections.length > 0 && (
                          <div className="space-y-3.5">
                            {res.answerSections.map((sec, sIdx) => (
                              <div key={sIdx} className="space-y-1">
                                <h3 className="font-serif text-base font-semibold text-[#2B1E16]">
                                  {sec.heading}
                                </h3>
                                <p className="whitespace-pre-line text-sm leading-relaxed text-[#2B1E16]">
                                  {sec.content}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Unverified / Missing Evidence Notices */}
                        {res.unverifiedNotices.length > 0 && (
                          <div className="rounded-md border border-[#C8A55B]/70 bg-[#FBF3E4] p-4">
                            <div className="flex items-start gap-2.5">
                              <ShieldAlert
                                className="mt-0.5 h-4 w-4 shrink-0 text-[#7D5A1C]"
                                aria-hidden="true"
                              />
                              <div className="space-y-1.5 text-xs text-[#695547]">
                                <p className="font-semibold text-[#2B1E16]">
                                  Verification Notice — Missing or Unverified Details
                                </p>
                                <ul className="list-inside list-disc space-y-1 leading-relaxed">
                                  {res.unverifiedNotices.map((notice, nIdx) => (
                                    <li key={nIdx}>{notice}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Contextual Follow-Up Actions */}
                        {isSingleMonument && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <span className="text-[11px] font-medium text-[#695547]">
                              Follow-up on {res.monumentName}:
                            </span>
                            {!res.detectedTopics.includes('architecture') && (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() =>
                                  void handleFollowUpQuery(
                                    res.monumentId,
                                    `What is the architectural style of ${res.monumentName}?`
                                  )
                                }
                                className="cursor-pointer rounded-md border border-[#E2D9C8] bg-[#FDFBF7] px-2.5 py-1 text-[11px] text-[#2B1E16] hover:border-[#C8A55B] hover:bg-[#F3EDE1]/60 disabled:opacity-50"
                              >
                                Architecture
                              </button>
                            )}
                            {!res.detectedTopics.includes('preservation') && (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() =>
                                  void handleFollowUpQuery(
                                    res.monumentId,
                                    `What conservation challenges and preservation initiatives apply to ${res.monumentName}?`
                                  )
                                }
                                className="cursor-pointer rounded-md border border-[#E2D9C8] bg-[#FDFBF7] px-2.5 py-1 text-[11px] text-[#2B1E16] hover:border-[#C8A55B] hover:bg-[#F3EDE1]/60 disabled:opacity-50"
                              >
                                Preservation &amp; Threats
                              </button>
                            )}
                            {!res.detectedTopics.includes('personalities') && (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() =>
                                  void handleFollowUpQuery(
                                    res.monumentId,
                                    `Which historical personalities or dynasties commissioned ${res.monumentName}?`
                                  )
                                }
                                className="cursor-pointer rounded-md border border-[#E2D9C8] bg-[#FDFBF7] px-2.5 py-1 text-[11px] text-[#2B1E16] hover:border-[#C8A55B] hover:bg-[#F3EDE1]/60 disabled:opacity-50"
                              >
                                Historical Personalities
                              </button>
                            )}
                            {!res.detectedTopics.includes('unesco') && (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() =>
                                  void handleFollowUpQuery(
                                    res.monumentId,
                                    `What is the UNESCO World Heritage status of ${res.monumentName}?`
                                  )
                                }
                                className="cursor-pointer rounded-md border border-[#E2D9C8] bg-[#FDFBF7] px-2.5 py-1 text-[11px] text-[#2B1E16] hover:border-[#C8A55B] hover:bg-[#F3EDE1]/60 disabled:opacity-50"
                              >
                                UNESCO Status
                              </button>
                            )}
                          </div>
                        )}

                        {/* Citations Attached to This Answer */}
                        <div className="border-t border-[#E2D9C8] pt-4">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <BookOpenCheck
                                className="h-4 w-4 text-[#7D5A1C]"
                                aria-hidden="true"
                              />
                              <h4 className="font-serif text-sm font-semibold text-[#2B1E16]">
                                Verified Source Citations
                              </h4>
                            </div>
                            <span className="font-mono text-[11px] text-[#695547] tabular-nums">
                              {res.citations.length} source(s) cited
                            </span>
                          </div>

                          {res.citations.length === 0 ? (
                            <p className="mt-2 text-xs text-[#695547]">
                              No verified knowledge-base citations matched this query.
                            </p>
                          ) : (
                            <ul className="mt-3 space-y-2.5">
                              {res.citations.map((cite, cIdx) => (
                                <li
                                  key={`${cite.monumentId}-${cite.sourceId}-${cIdx}`}
                                  className="rounded-md border border-[#E2D9C8] bg-[#FDFBF7] p-3 text-xs"
                                >
                                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                                    <div>
                                      <p className="font-mono text-[11px] text-[#7D5A1C] tabular-nums">
                                        [{cIdx + 1}] {cite.monumentName} · {cite.institution} ·{' '}
                                        Verified {cite.accessDate}
                                      </p>
                                      <p className="mt-0.5 font-medium text-[#2B1E16]">
                                        {cite.title}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center gap-3">
                                      <a
                                        href={cite.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#2B1E16]"
                                      >
                                        <span>Source URL</span>
                                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                      </a>
                                      {cite.apiVerificationUrl && (
                                        <a
                                          href={cite.apiVerificationUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 font-medium text-[#7D5A1C] underline decoration-[#C8A55B] underline-offset-4 hover:text-[#2B1E16]"
                                        >
                                          <span>UNESCO API</span>
                                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                  <p className="mt-1.5 leading-relaxed text-[#695547]">
                                    {cite.excerpt}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {submitting && (
              <div className="mt-5 flex items-center gap-3 rounded-md border border-[#E2D9C8] bg-[#FAF7F0] p-4 text-sm text-[#695547]">
                <Loader2 className="h-4 w-4 animate-spin text-[#7D5A1C]" aria-hidden="true" />
                <span>
                  Retrieving verified monument records, preservation facets, and source citations...
                </span>
              </div>
            )}

            <div ref={threadBottomRef} />
          </div>

          {/* Transparent Architecture & Retrieval Policy */}
          <div className="rounded-lg border border-[#E2D9C8] bg-[#FDFBF7] p-6">
            <h3 className="font-serif text-base font-semibold text-[#2B1E16]">
              Grounding Policy &amp; Retrieval Scope
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-[#695547]">
              This Heritage Assistant operates standalone without any undisclosed paid API or
              client-side secrets. It executes entity matching, IDF-weighted lexical retrieval,
              catalogue filtering, anaphoric session resolution, and 6-facet preservation
              assessment over the verified 20-site database in{' '}
              <span className="font-mono text-[#2B1E16]">server/data/monuments.json</span>. External
              multi-page ASI excavation PDFs are not attached, so unverified (null) fields and
              out-of-scope questions are explicitly flagged rather than invented.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
