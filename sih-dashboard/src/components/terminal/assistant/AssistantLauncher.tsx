/**
 * The assistant: launcher, panel, transcript.
 *
 * Two things here are the argument for this widget existing at all.
 *
 * The header badge reads the mesh this page is already using, so it reports a
 * real station count and the hour those readings describe, and turns amber on
 * the offline fallback. The competitor's version of this panel carries three
 * badges - "Live CAAQMS telemetry connected" and friends - which are strings
 * in the markup and prove nothing.
 *
 * And every answer prints its receipts: which tools ran, which endpoint each
 * one read, and the hour it returned. That is the difference between claiming
 * an answer is grounded and showing where its numbers came from. If the model
 * ever answers without calling a tool, the absent receipts say so.
 *
 * The whole widget hides itself when the backend reports no key - the same
 * rule the meteorology panel follows for an expired cycle. A control that
 * cannot do anything is worse than no control.
 */
import * as React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, Sparkles, X } from 'lucide-react';
import Avatar from '@/components/ui/ai-avatar';
import {
  askAssistant,
  fetchAssistantStatus,
  TOOL_LABEL,
  type AssistantStatus,
  type ToolReceipt,
  type TurnContent,
} from '@/lib/terminal/assistantApi';
import { useMesh } from '@/lib/terminal/useMesh';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';
import { cn } from '@/lib/utils';

const TOPICS = [
  { id: 'health', label: 'Health & exposure' },
  { id: 'science', label: 'Atmospheric science' },
  { id: 'policy', label: 'Policy & GRAP' },
  { id: 'fires', label: 'Stubble & plumes' },
] as const;

type TopicId = (typeof TOPICS)[number]['id'];

/** One opener per topic, each answerable from a tool rather than from memory. */
const OPENERS: Record<TopicId, string[]> = {
  health: [
    'Is it safe to run outside right now?',
    'Which channel is driving the worst station?',
    'How does today compare with the last week?',
  ],
  science: [
    'Why is PM10 setting the index and not PM2.5?',
    'What is the boundary layer doing tonight?',
    'How accurate is the 72-hour forecast?',
  ],
  policy: [
    'What GRAP stage is in force, and why?',
    'Which station is the hotspot right now?',
    'How is the National AQI actually calculated?',
  ],
  fires: [
    'Is stubble smoke reaching Delhi today?',
    'How far upwind are the fires burning?',
    'What did the November 2025 episode look like?',
  ],
};

type Msg =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; tools: ToolReceipt[] }
  | { role: 'error'; text: string };

function formatHour(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** What the header badge can honestly claim, read from the live mesh. */
function useGrounding(): { tone: 'live' | 'offline' | 'loading'; text: string } {
  const mesh = useMesh();
  if (mesh.status === 'loading') return { tone: 'loading', text: 'Connecting to the mesh' };
  if (!mesh.live) return { tone: 'offline', text: 'Offline snapshot — not this hour' };
  const hour = formatHour(mesh.asOf);
  return {
    tone: 'live',
    text: `${mesh.stations.length} stations${hour ? ` · ${hour} IST` : ''}`,
  };
}

/** The calls behind an answer, with the hour each one read. */
function Receipts({ tools }: { tools: ToolReceipt[] }) {
  if (!tools.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1 border-t border-term-outline-variant/40 pt-2">
      {tools.map((t, i) => (
        <span
          key={`${t.name}-${i}`}
          title={`${t.source ?? t.name}${t.asOf ? ` · ${t.asOf}` : ''} · ${t.ms} ms`}
          className={cn(
            'rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider',
            t.ok
              ? 'border-term-primary/30 bg-term-primary/5 text-term-primary'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
          )}
        >
          {TOOL_LABEL[t.name] ?? t.name}
          {t.asOf ? ` · ${formatHour(t.asOf) ?? ''}` : ''}
        </span>
      ))}
    </div>
  );
}

export function AssistantLauncher() {
  const [status, setStatus] = React.useState<AssistantStatus | null>(null);
  const [checked, setChecked] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [topic, setTopic] = React.useState<TopicId>('health');
  const [draft, setDraft] = React.useState('');
  const [focused, setFocused] = React.useState(false);
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [running, setRunning] = React.useState(false);
  const [liveTools, setLiveTools] = React.useState<ToolReceipt[]>([]);
  const history = React.useRef<TurnContent[]>([]);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const grounding = useGrounding();
  const reduced = usePrefersReducedMotion();
  // The orb listens while there is something to listen to. A focused empty
  // field is waiting, not being spoken to.
  const listening = (focused && draft.trim().length > 0) || running;

  React.useEffect(() => {
    let alive = true;
    void fetchAssistantStatus().then((s) => {
      if (!alive) return;
      setStatus(s);
      setChecked(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Keep the newest turn in view without scrolling the page behind the panel.
  React.useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, liveTools, open]);

  const ask = React.useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || running) return;
      setDraft('');
      setMsgs((m) => [...m, { role: 'user', text: q }]);
      setRunning(true);
      setLiveTools([]);

      let text = '';
      const used: ToolReceipt[] = [];
      try {
        for await (const ev of askAssistant(q, history.current)) {
          if (ev.type === 'tool') {
            used.push(ev.receipt);
            setLiveTools([...used]);
          } else if (ev.type === 'text') {
            text = ev.text;
          } else if (ev.type === 'error') {
            setMsgs((m) => [...m, { role: 'error', text: ev.message }]);
          } else if (ev.type === 'done') {
            history.current = ev.contents;
          }
        }
      } finally {
        if (text) setMsgs((m) => [...m, { role: 'assistant', text, tools: used }]);
        setLiveTools([]);
        setRunning(false);
      }
    },
    [running],
  );

  // Nothing renders until the backend has answered, and nothing at all when it
  // reports no key: a widget that cannot answer is not worth a button.
  if (!checked || !status?.available) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close the assistant' : 'Ask the assistant'}
        className="group fixed bottom-5 right-5 z-[600] flex items-center gap-2.5 rounded-full border border-[#ff5ecf]/40 bg-term-surface-lowest/95 py-1.5 pl-1.5 pr-4 shadow-[0_0_24px_rgba(255,94,207,.22)] backdrop-blur-sm transition-all hover:border-[#ff5ecf]/70 hover:shadow-[0_0_32px_rgba(255,94,207,.38)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5ecf]/60 sm:bottom-6 sm:right-6"
      >
        <Avatar color="airsense" size="sm" shape="circle" blinking={!reduced} track halo={!reduced} />
        <span className="hidden font-mono text-[11px] font-bold uppercase tracking-wider text-term-ink sm:inline">
          Ask AirSense
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOpen(false)}
              aria-hidden="true"
              className="fixed inset-0 z-[590] bg-black/40 backdrop-blur-[2px] sm:bg-black/20"
            />

            <motion.div
              role="dialog"
              aria-label="AirSense assistant"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-x-3 bottom-3 z-[600] flex max-h-[min(78vh,640px)] flex-col overflow-hidden rounded-2xl border border-term-outline-variant/60 bg-term-surface-lowest shadow-2xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[400px]"
            >
              <div className="flex items-start gap-3 border-b border-term-outline-variant/60 p-4">
                <Avatar
                  color="airsense"
                  size="md"
                  shape="squircle"
                  blinking={!reduced}
                  track
                  halo={!reduced}
                  state={listening ? 'listening' : 'idle'}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold tracking-tight text-term-ink">
                    AirSense Assistant
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        grounding.tone === 'live' && 'pulse-live bg-term-primary',
                        grounding.tone === 'offline' && 'bg-amber-400',
                        grounding.tone === 'loading' && 'bg-term-outline',
                      )}
                    />
                    <span
                      className={cn(
                        'truncate font-mono text-[10px] uppercase tracking-wider',
                        grounding.tone === 'offline'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-term-ink-variant',
                      )}
                    >
                      {grounding.text}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-term-outline-variant/60 text-term-ink-variant transition-colors hover:border-term-primary/50 hover:text-term-ink"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {msgs.length === 0 && (
                <div className="flex gap-1.5 overflow-x-auto border-b border-term-outline-variant/40 px-4 py-2.5">
                  {TOPICS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTopic(t.id)}
                      aria-pressed={topic === t.id}
                      className={cn(
                        'shrink-0 rounded-lg border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors',
                        topic === t.id
                          ? 'border-term-primary/40 bg-term-primary/10 text-term-primary'
                          : 'border-term-outline-variant/60 text-term-ink-variant hover:text-term-ink',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}

              <div ref={bodyRef} className="flex-1 space-y-4 overflow-y-auto p-4">
                {msgs.length === 0 && (
                  <>
                    <div className="flex gap-2.5">
                      <Avatar color="airsense" size="sm" shape="circle" blinking={false} />
                      <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-term-outline-variant/60 bg-term-surface-low p-3">
                        <p className="font-body text-xs leading-relaxed text-term-ink-variant">
                          I answer from this system&rsquo;s own measurements — the CPCB station
                          mesh, the 72-hour forecast and its scored error, the GRAP engine, and
                          the VIIRS fire corridor. Every figure names the station and the hour it
                          came from, and where a channel is not measured I say that instead of
                          estimating it.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-term-ink-variant">
                        Try asking
                      </span>
                      {OPENERS[topic].map((q) => (
                        <button
                          key={q}
                          type="button"
                          onClick={() => void ask(q)}
                          className="flex w-full items-center justify-between gap-2 rounded-xl border border-term-outline-variant/60 bg-term-surface-low px-3 py-2.5 text-left font-body text-xs text-term-ink transition-colors hover:border-[#ff5ecf]/40"
                        >
                          {q}
                          <Sparkles className="size-3.5 shrink-0 text-term-secondary" />
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {msgs.map((m, i) =>
                  m.role === 'user' ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] rounded-xl rounded-br-sm border border-[#ff5ecf]/30 bg-[#ff5ecf]/10 px-3 py-2 font-body text-xs text-term-ink">
                        {m.text}
                      </div>
                    </div>
                  ) : m.role === 'error' ? (
                    <div
                      key={i}
                      className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 font-body text-[11px] leading-relaxed text-amber-700 dark:text-amber-300"
                    >
                      {m.text}
                    </div>
                  ) : (
                    <div key={i} className="flex gap-2.5">
                      <Avatar color="airsense" size="sm" shape="circle" blinking={false} />
                      <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-term-outline-variant/60 bg-term-surface-low p-3">
                        <p className="whitespace-pre-wrap font-body text-xs leading-relaxed text-term-ink">
                          {m.text}
                        </p>
                        <Receipts tools={m.tools} />
                      </div>
                    </div>
                  ),
                )}

                {running && (
                  <div className="flex gap-2.5">
                    <Avatar color="airsense" size="sm" shape="circle" blinking={!reduced} />
                    <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-term-outline-variant/60 bg-term-surface-low p-3">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-term-ink-variant">
                        {liveTools.length
                          ? `Reading ${TOOL_LABEL[liveTools[liveTools.length - 1].name] ?? liveTools[liveTools.length - 1].name}…`
                          : 'Thinking…'}
                      </span>
                      <Receipts tools={liveTools} />
                    </div>
                  </div>
                )}
              </div>

              <form
                className="border-t border-term-outline-variant/60 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(draft);
                }}
              >
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-xl border bg-term-surface-low px-3 py-2 transition-colors',
                    listening ? 'border-[#ff5ecf]/50' : 'border-term-outline-variant/60',
                  )}
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    maxLength={status.limits.maxQuestionChars}
                    disabled={running}
                    placeholder={running ? 'Reading the mesh…' : 'Ask about the air…'}
                    aria-label="Ask the assistant"
                    className="min-w-0 flex-1 bg-transparent font-body text-xs text-term-ink outline-none placeholder:text-term-outline disabled:cursor-not-allowed"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || running}
                    aria-label="Send"
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-term-ink-variant transition-colors enabled:hover:text-[#ff5ecf] disabled:opacity-40"
                  >
                    <CornerDownLeft className="size-3.5" />
                  </button>
                </div>
                <span className="mt-1.5 block font-mono text-[9px] uppercase tracking-wider text-term-outline">
                  Answers cite the station and hour they came from · not medical advice
                </span>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
