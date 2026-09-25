/**
 * The CPCB derivation behind one pollutant card, opened by clicking it.
 *
 * This used to be the hover state, which was the wrong way round: hovering is
 * a glance and wants the shape of the last day, while the derivation is
 * something a reader stops to study. The chart moved to hover and this moved
 * here.
 *
 * Portalled to <body> for the same reason as the command palette — the card
 * sits inside a transformed, stacking-context-forming grid, and a `fixed`
 * child of that is positioned against the card rather than the viewport.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Label } from '@/components/terminal/TerminalPrimitives';
import type { LivePollutant } from '@/lib/terminal/livePollutants';
import { MeasuredTrend } from './MeasuredTrend';

export function PollutantDetail({
  reading: p,
  stationName,
  asOf,
  open,
  onClose,
}: {
  reading: LivePollutant;
  stationName: string;
  /** Hour the readings describe, for the chart axis and the header stamp. */
  asOf: string | null;
  open: boolean;
  onClose: () => void;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);

    // Lock the page behind the dialog. Without this the wheel scrolls the
    // terminal underneath, which moves the card the dialog was opened from.
    // The scrollbar is replaced by padding of the same width so the layout
    // does not jump sideways as it disappears.
    const { body } = document;
    const prevOverflow = body.style.overflow;
    const prevPadding = body.style.paddingRight;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;

    return () => {
      document.removeEventListener('keydown', onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPadding;
    };
  }, [open, onClose]);

  // Guarded: a feed that stamps its hour in some other layout used to reach
  // `new Date()` here and throw RangeError from inside render, taking the whole
  // route down over a caption. An unparseable stamp is worth omitting, not
  // worth a blank page.
  const asOfDate = asOf ? new Date(asOf) : null;
  const stamp = asOfDate && !Number.isNaN(asOfDate.getTime())
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(asOfDate)
    : null;

  const valid = p.validHours ?? 0;
  // Not `window`: that shadows the global, and the scroll lock above needs it.
  const windowHours = p.windowHours ?? 24;
  // CPCB will not publish a sub-index from a window that is mostly empty; the
  // registry drops those before they reach here, so a card that opens at all
  // has cleared the bar. Saying by how much is still worth the line.
  const thin = valid < windowHours * 0.75;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="term-scope fixed inset-0 z-[120] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          // A portal moves the DOM node but not the React tree, so events
          // raised in here still bubble to the card that opened it — whose
          // onClick sets open back to true. Closing appeared to do nothing:
          // the close button, the backdrop and every click inside the dialog
          // re-opened it on the way out. Stopping it at the root is enough,
          // and keeps the card's own handler for clicks on the card.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <button
            aria-label="Close pollutant detail"
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-term-bg/70 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${p.symbol} detail for ${stationName}`}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-term-outline-variant/70 bg-term-surface-lowest shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-term-outline-variant/50 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="font-mono text-sm font-bold"
                    style={{ color: p.measured ? p.color : undefined }}
                  >
                    {p.symbol}
                  </span>
                  <span className="text-sm font-semibold text-term-ink">{p.name}</span>
                </div>
                <Label className="mt-0.5 block">
                  {stationName}
                  {stamp ? ` · ${stamp} IST` : ''}
                </Label>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-lg border border-term-outline-variant/60 p-1.5 text-term-ink-variant transition-colors hover:text-term-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-term-primary/60"
              >
                <X className="size-4" />
              </button>
            </div>

            {p.measured ? (
              <div className="space-y-4 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-4xl font-extrabold text-term-ink">
                    {p.value != null ? p.value.toFixed(1) : p.subIndex}
                  </span>
                  <span className="font-mono text-xs text-term-ink-variant">
                    {p.value != null ? `${p.unit} · ` : 'CPCB sub-index · '}
                    {windowHours}h mean to {stamp ?? 'last reported hour'}
                  </span>
                </div>

                <MeasuredTrend
                  values={p.series}
                  color={p.color}
                  height={92}
                  showAxis
                  endsAt={asOf}
                  emptyNote={p.emptyNote}
                  caption={p.caption}
                  valueLabel={p.value != null ? p.unit : 'CPCB sub-index'}
                />

                <dl className="space-y-1.5 font-mono text-[11px]">
                  <Row label="CPCB sub-index" value={String(p.subIndex)} color={p.color} />
                  <Row label="Band" value={p.status} color={p.color} />
                  <Row label="Standard" value={`${p.reference} ${p.unit}`} />
                  <Row label="Averaging window" value={`${windowHours} hours`} />
                  <Row
                    label="Valid hours"
                    value={`${valid} of ${windowHours}${thin ? ' · thin' : ''}`}
                  />
                </dl>

                <p className="border-t border-term-outline-variant/40 pt-3 font-body text-[11px] leading-relaxed text-term-ink-variant">
                  The station AQI is the highest sub-index across its measured pollutants, so
                  this channel sets the headline number only when it is the worst of them.
                  Hours the instrument did not report, or that the network contradicted, are
                  left out of the mean rather than filled in.
                </p>
              </div>
            ) : (
              <div className="space-y-3 p-4">
                <p className="font-body text-sm text-term-ink-variant">
                  There&rsquo;s no {p.symbol} reading available from this station for this
                  time, so we can&rsquo;t calculate the sub-index. That&rsquo;s why the card
                  shows a dash instead of a value.
                </p>
                <p className="font-body text-[11px] leading-relaxed text-term-outline">
                  This doesn&rsquo;t necessarily mean {p.symbol} isn&rsquo;t present. The
                  station may simply not measure it, or the available reading may not have
                  passed the required checks.
                </p>
                {/* CO only, and it has to stay. The sentence above is true of every
                    other channel and false of this one: CO is measured and is left
                    out on purpose, because the unit the catalogue gives it is
                    contradicted by its own values. Without this a reader would take
                    the absence for a missing instrument. */}
                {p.id === 'co' && (
                  <p className="font-body text-[11px] leading-relaxed text-term-outline">
                    CO is the exception: it is measured here, and excluded from the index
                    deliberately, because the unit the catalogue gives it is contradicted by
                    its own values.
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-term-ink-variant">{label}</dt>
      <dd className="font-bold" style={{ color: color ?? 'var(--t-ink)' }}>
        {value}
      </dd>
    </div>
  );
}
