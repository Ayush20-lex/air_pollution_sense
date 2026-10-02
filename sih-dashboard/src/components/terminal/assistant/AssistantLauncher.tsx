/**
 * The assistant: launcher, panel, transcript.
 *
 * Grounded in real CAAQMS telemetry and NCMRWF atmospheric physics models.
 * Completely opaque surface with dual-theme light/dark mode support.
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

/**
 * Four topics with human-friendly descriptions.
 */
const TOPICS = [
  { id: 'health', label: 'Health' },
  { id: 'science', label: 'Science' },
  { id: 'policy', label: 'Policy & GRAP' },
  { id: 'fires', label: 'Stubble Fires' },
] as const;

type TopicId = (typeof TOPICS)[number]['id'];

/** One opener per topic, each answerable from live tools and validated models. */
const OPENERS: Record<TopicId, string[]> = {
  health: [
    'Is it safe to exercise outdoors right now?',
    'Which pollutant is driving the worst station?',
    'How does today compare with the last week?',
  ],
  science: [
    'Why is PM10 setting the index rather than PM2.5?',
    'What is the planetary boundary layer doing tonight?',
    'How accurate is the 72-hour forecast?',
  ],
  policy: [
    'What GRAP stage is currently in force and why?',
    'Which station is the hotspot right now?',
    'How is the National AQI calculated across NCR?',
  ],
  fires: [
    'Is stubble burning smoke reaching Delhi today?',
    'How far upwind are the active farm fires?',
    'What did the historical peak smoke episode look like?',
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
  if (mesh.status === 'loading') return { tone: 'loading', text: 'Connecting to station mesh' };
  if (!mesh.live) return { tone: 'offline', text: 'Calibrated baseline snapshot' };
  const hour = formatHour(mesh.asOf);
  return {
    tone: 'live',
    text: `${mesh.stations.length} stations${hour ? ` · ${hour} IST` : ''}`,
  };
}

/** The verified calls behind an answer, with the hour each one read. */
function Receipts({ tools }: { tools: ToolReceipt[] }) {
  if (!tools.length) return null;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-slate-200/80 pt-2 dark:border-slate-700/60">
      {tools.map((t, i) => (
        <span
          key={`${t.name}-${i}`}
          title={`${t.source ?? t.name}${t.asOf ? ` · ${t.asOf}` : ''} · ${t.ms} ms`}
          className={cn(
            'inline-flex items-center rounded-md border px-2 py-0.5 font-sans text-[10px] font-medium',
            t.ok
              ? 'border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-amber-500/40 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
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
  // The greeting used to claim "24+ CAAQMS monitoring stations" as fixed copy,
  // directly under a header badge printing the real count. Two numbers about
  // the same mesh, one of them a guess. Read the mesh instead, and say nothing
  // about a count while it is still loading.
  const meshSize = useMesh().stations.length;
  const reduced = usePrefersReducedMotion();
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

  const unconfigured = !status?.available;
  if (!checked) return null;
  if (unconfigured && !import.meta.env.DEV) return null;

  return (
    <>
      {/* Floating launcher trigger - dual-theme light/dark support */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close the atmospheric analyst' : 'Ask the atmospheric analyst'}
        className="group fixed bottom-5 right-5 z-[600] flex items-center gap-2.5 rounded-full border border-slate-300 bg-white py-1.5 pl-1.5 pr-4 shadow-lg transition-all hover:border-cyan-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0e172a] dark:hover:border-sky-500/80 dark:hover:bg-[#131f37] dark:shadow-[0_8px_30px_rgba(0,0,0,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 sm:bottom-6 sm:right-6"
      >
        <Avatar size="sm" shape="circle" state={listening ? 'listening' : 'idle'} />
        <span className="hidden font-sans text-xs font-semibold text-slate-800 dark:text-slate-100 sm:inline">
          Ask AirLytics Specialist
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Modal backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOpen(false)}
              aria-hidden="true"
              className="fixed inset-0 z-[590] bg-black/50 backdrop-blur-sm dark:bg-black/65"
            />

            {/* Modal Dialog: 100% Opaque, dual-theme styling */}
            <motion.div
              role="dialog"
              aria-label="AirLytics atmospheric analyst"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-x-3 bottom-3 z-[600] flex max-h-[min(82vh,680px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-slate-700/90 dark:bg-[#0c1424] dark:text-slate-100 dark:shadow-[0_25px_65px_rgba(0,0,0,0.95)] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[420px]"
            >
              {/* Header */}
              <div className="flex items-start gap-3 border-b border-slate-200 bg-slate-50 p-4 dark:border-slate-700/80 dark:bg-[#111c30]">
                <Avatar
                  size="md"
                  shape="squircle"
                  state={listening ? 'listening' : 'idle'}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-sans text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                    AirLytics Specialist
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        grounding.tone === 'live' && 'bg-emerald-500 dark:bg-emerald-400 ring-2 ring-emerald-400/20',
                        grounding.tone === 'offline' && 'bg-amber-500 dark:bg-amber-400',
                        grounding.tone === 'loading' && 'bg-slate-400 animate-pulse',
                      )}
                    />
                    <span
                      className={cn(
                        'truncate font-sans text-xs font-medium',
                        unconfigured || grounding.tone === 'offline'
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-slate-600 dark:text-slate-300',
                      )}
                    >
                      {unconfigured ? 'Preview mode: No API key' : grounding.text}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:bg-slate-700 dark:hover:text-white"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {/* Topic chips */}
              {msgs.length === 0 && (
                <div className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-slate-100/70 px-4 py-2.5 dark:border-slate-800 dark:bg-[#0e1728]">
                  {TOPICS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTopic(t.id)}
                      aria-pressed={topic === t.id}
                      className={cn(
                        'shrink-0 rounded-lg border px-3 py-1 font-sans text-xs font-medium transition-colors',
                        topic === t.id
                          ? 'border-cyan-600 bg-cyan-50 text-cyan-800 shadow-sm dark:border-sky-500/80 dark:bg-sky-500/20 dark:text-sky-200'
                          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700/80 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Message scroll list */}
              <div ref={bodyRef} className="flex-1 space-y-3.5 overflow-y-auto bg-slate-50/50 p-4 dark:bg-[#0c1424]">
                {msgs.length === 0 && (
                  <>
                    <div className="flex gap-2.5">
                      <Avatar size="sm" shape="circle" />
                      <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-700/80 dark:bg-[#15233c]">
                        <p className="font-sans text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                          Hello! I analyze live telemetry from{' '}
                          {meshSize > 0 ? `${meshSize} CAAQMS monitoring stations` : 'the CAAQMS station mesh'}{' '}
                          and NCMRWF meteorological models across Delhi-NCR. How can I help you understand today’s atmospheric conditions?
                        </p>
                      </div>
                    </div>

                    {unconfigured && (
                      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 shadow-sm dark:border-amber-500/35 dark:bg-amber-950/40">
                        <p className="font-sans text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                          <span className="font-semibold text-amber-800 dark:text-amber-300">Developer Preview:</span> No{' '}
                          <code className="rounded bg-amber-100 dark:bg-amber-900/50 px-1 py-0.5 font-mono text-[11px] text-amber-900 dark:text-amber-100">GEMINI_API_KEY</code> is set on the server, so answers are currently paused. Connect an API key to enable live analysis.
                        </p>
                      </div>
                    )}

                    <div className="space-y-2 pt-1">
                      <div className="font-sans text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        Suggested questions
                      </div>
                      {OPENERS[topic].map((q) => (
                        <button
                          key={q}
                          type="button"
                          disabled={unconfigured}
                          onClick={() => void ask(q)}
                          className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left font-sans text-xs text-slate-800 shadow-sm transition-colors hover:border-cyan-500 hover:bg-slate-50 hover:text-cyan-900 dark:border-slate-700/80 dark:bg-[#15233c] dark:text-slate-200 dark:hover:border-sky-500/60 dark:hover:bg-[#1a2b4a] dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span>{q}</span>
                          <Sparkles className="size-3.5 shrink-0 text-cyan-600 dark:text-sky-400" />
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {msgs.map((m, i) =>
                  m.role === 'user' ? (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] rounded-xl rounded-br-sm bg-cyan-600 dark:bg-sky-600 px-3.5 py-2.5 font-sans text-xs text-white shadow-md">
                        {m.text}
                      </div>
                    </div>
                  ) : m.role === 'error' ? (
                    <div
                      key={i}
                      className="rounded-xl border border-amber-300 bg-amber-50 p-3 font-sans text-xs leading-relaxed text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-200"
                    >
                      {m.text}
                    </div>
                  ) : (
                    <div key={i} className="flex gap-2.5">
                      <Avatar size="sm" shape="circle" />
                      <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-700/80 dark:bg-[#15233c]">
                        <p className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-800 dark:text-slate-100">
                          {m.text}
                        </p>
                        <Receipts tools={m.tools} />
                      </div>
                    </div>
                  ),
                )}

                {running && (
                  <div className="flex gap-2.5">
                    <Avatar size="sm" shape="circle" state="listening" />
                    <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-700/80 dark:bg-[#15233c]">
                      <span className="font-sans text-xs text-cyan-700 dark:text-sky-300">
                        {liveTools.length
                          ? `Querying ${TOOL_LABEL[liveTools[liveTools.length - 1].name] ?? liveTools[liveTools.length - 1].name}…`
                          : 'Synthesizing station data…'}
                      </span>
                      <Receipts tools={liveTools} />
                    </div>
                  </div>
                )}
              </div>

              {/* Composer Form */}
              <form
                className="border-t border-slate-200 bg-slate-50 p-3.5 dark:border-slate-700/80 dark:bg-[#111c30]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(draft);
                }}
              >
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-xl border bg-white px-3.5 py-2.5 transition-colors dark:bg-[#15233c]',
                    listening ? 'border-cyan-600 dark:border-sky-500/80' : 'border-slate-300 dark:border-slate-700',
                  )}
                >
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    maxLength={status?.limits.maxQuestionChars ?? 600}
                    disabled={running || unconfigured}
                    placeholder={
                      unconfigured
                        ? 'No API key on the server'
                        : running
                          ? 'Analyzing data…'
                          : 'Ask about Delhi NCR air quality…'
                    }
                    aria-label="Ask the atmospheric analyst"
                    className="min-w-0 flex-1 bg-transparent font-sans text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500 disabled:cursor-not-allowed"
                  />
                  <button
                    type="submit"
                    disabled={!draft.trim() || running || unconfigured}
                    aria-label="Send"
                    className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-cyan-600 text-white transition-colors hover:bg-cyan-700 dark:bg-sky-600/80 dark:hover:bg-sky-500 disabled:bg-transparent disabled:text-slate-400 dark:disabled:text-slate-600"
                  >
                    <CornerDownLeft className="size-3.5" />
                  </button>
                </div>
                {/* "Advisory only" replaced the medical disclaimer during the
                    redesign. It is too vague to do that job: this panel answers
                    questions about going outside and breathing, and a reader
                    with asthma needs to be told where the line is, not that the
                    answer is advisory. */}
                <div className="mt-2 flex items-center justify-between font-sans text-[11px] text-slate-500 dark:text-slate-400">
                  <span>CPCB &amp; NCMRWF scientific data</span>
                  <span>Not medical advice</span>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
