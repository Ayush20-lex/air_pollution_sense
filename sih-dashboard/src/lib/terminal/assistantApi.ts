/**
 * The assistant's client. Streams one turn and reports what it used.
 *
 * The transcript lives here rather than on the server: the backend is
 * stateless and takes the prior turns back on every request, so nothing on a
 * 951 MB box has to hold conversations or expire them. The cost is that the
 * history is untrusted input by the time it returns, which the backend caps.
 *
 * Tool receipts are first-class, not logging. Every answer carries the calls
 * that produced it - which endpoint, which hour, how long it took - because
 * that is the difference between an assistant that says it is grounded and one
 * that can show where each number came from.
 */

/** Same contract as the other clients - see forecastApi's note. */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/** One tool call, as the UI prints it under an answer. */
export type ToolReceipt = {
  name: string;
  args: Record<string, unknown>;
  ms: number;
  ok: boolean;
  /** The endpoint it read, e.g. "/api/v1/stations". */
  source: string | null;
  /** The hour that reading describes, where the payload carries one. */
  asOf: string | null;
};

export type AssistantStatus = {
  available: boolean;
  model: string | null;
  tools: string[];
  limits: {
    perMinute: number;
    perDay: number;
    maxTurns: number;
    maxQuestionChars: number;
  };
};

/** Gemini's own `contents` shape, echoed back untouched on the next turn. */
export type TurnContent = { role: string; parts: unknown[] };

export type AssistantEvent =
  | { type: 'tool'; receipt: ToolReceipt }
  | { type: 'text'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done'; tools: ToolReceipt[]; contents: TurnContent[] };

function toReceipt(raw: Record<string, unknown>): ToolReceipt {
  return {
    name: String(raw.name ?? ''),
    args: (raw.args as Record<string, unknown>) ?? {},
    ms: typeof raw.ms === 'number' ? raw.ms : 0,
    ok: raw.ok !== false,
    source: typeof raw.source === 'string' ? raw.source : null,
    asOf: typeof raw.as_of === 'string' ? raw.as_of : null,
  };
}

/** Whether the assistant can answer at all. Null when the backend is away. */
export async function fetchAssistantStatus(
  timeoutMs = 8000,
): Promise<AssistantStatus | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/api/v1/assistant/status`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, any>;
    return {
      available: Boolean(d.available),
      model: typeof d.model === 'string' ? d.model : null,
      tools: Array.isArray(d.tools) ? d.tools.map(String) : [],
      limits: {
        perMinute: d.limits?.per_minute ?? 0,
        perDay: d.limits?.per_day ?? 0,
        maxTurns: d.limits?.max_turns ?? 0,
        maxQuestionChars: d.limits?.max_question_chars ?? 600,
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask one question, yielding events as the turn runs.
 *
 * Server-sent events over POST, so `EventSource` is not an option - it only
 * does GET. The body is read as a stream and split on the blank line that
 * terminates an SSE frame; a partial frame is held in `buffer` until the rest
 * of it arrives, which is the whole reason this is not a `split('\n\n')` over
 * the finished text.
 */
export async function* askAssistant(
  question: string,
  history: TurnContent[],
  signal?: AbortSignal,
): AsyncGenerator<AssistantEvent> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1/assistant`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      cache: 'no-store',
      body: JSON.stringify({ question, history }),
    });
  } catch {
    yield { type: 'error', message: 'Could not reach the assistant.' };
    return;
  }

  if (res.status === 429) {
    const detail = await res.json().catch(() => null);
    yield {
      type: 'error',
      message: detail?.detail ?? 'Too many questions for now — give it a minute.',
    };
    return;
  }
  if (res.status === 503) {
    yield { type: 'error', message: 'The assistant is not switched on.' };
    return;
  }
  if (!res.ok || !res.body) {
    yield { type: 'error', message: `The assistant failed (HTTP ${res.status}).` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');

      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      let raw: Record<string, any>;
      try {
        raw = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }

      if (raw.type === 'tool') yield { type: 'tool', receipt: toReceipt(raw) };
      else if (raw.type === 'text') yield { type: 'text', text: String(raw.text ?? '') };
      else if (raw.type === 'error')
        yield { type: 'error', message: String(raw.message ?? 'Something went wrong.') };
      else if (raw.type === 'done')
        yield {
          type: 'done',
          tools: Array.isArray(raw.tools) ? raw.tools.map(toReceipt) : [],
          contents: Array.isArray(raw.contents) ? (raw.contents as TurnContent[]) : [],
        };
    }
  }
}

/** What each tool reads, for the receipt chips. Kept short on purpose. */
export const TOOL_LABEL: Record<string, string> = {
  city_now: 'station mesh',
  station_detail: 'station readings',
  forecast: '72-hour forecast',
  fire_corridor: 'fire corridor',
  grap_stage: 'GRAP engine',
  inversion: 'inversion alerts',
  city_history: 'archived days',
  index_rules: 'CPCB index rules',
};
