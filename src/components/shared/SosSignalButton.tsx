/**
 * SosSignalButton — the deliberate-activation SOS control.
 *
 * Renders the button plus its progress affordances:
 *  - a ring/bar that fills while holding,
 *  - "2 of 3 taps" feedback as they get close,
 *  - a live countdown of the hold remaining.
 *
 * Used by both the citizen portal and the login screen so the safety
 * behaviour can never drift apart between them.
 */
import React from 'react';
import { Loader2, Radar, Siren } from 'lucide-react';
import { useSosActivation } from '../../hooks/useSosActivation';

interface SosSignalButtonProps {
  onConfirm: () => void;
  /**
   * The caller's SOS state machine. 'LOCATING'/'SENDING' lock the control;
   * 'SENT' and 'ERROR' are informational (the page renders its own message),
   * so the button goes back to being usable.
   */
  busyState?: 'IDLE' | 'LOCATING' | 'SENDING' | 'SENT' | 'ERROR';
  disabled?: boolean;
  holdMs?: number;
  requiredTaps?: number;
  /** Tailwind classes for the button box. */
  className?: string;
  /** Visible label when idle. */
  label?: string;
  /**
   * 'alert' is for placement on a saturated red surface (the citizen portal's
   * warning banner). The default dark-red fill would sink into that background
   * and lose the contrast that makes this the most important control on the
   * page, so the alert tone inverts to solid white with red ink.
   *
   * Tailwind class order in the attribute does not decide this — cascade order
   * in the stylesheet does — so the tone has to swap the classes rather than
   * rely on the caller overriding them via `className`.
   */
  tone?: 'default' | 'alert';
}

export const SosSignalButton: React.FC<SosSignalButtonProps> = ({
  onConfirm,
  busyState = 'IDLE',
  disabled = false,
  holdMs = 5000,
  requiredTaps = 3,
  className = '',
  label = 'SOS Signal',
  tone = 'default',
}) => {
  const busy = busyState === 'LOCATING' || busyState === 'SENDING';
  const locked = disabled || busy;
  const onAlert = tone === 'alert';

  const { taps, progress, oneTapAway, holding, handlers } = useSosActivation({
    requiredTaps,
    holdMs,
    disabled: locked,
    onConfirm,
  });

  const busyLabel =
    busyState === 'LOCATING' ? 'Detecting your location…'
      : busyState === 'SENDING' ? 'Sending SOS…'
        : null;

  // Seconds left on the hold, for the countdown hint.
  const secondsLeft = holding ? Math.ceil((holdMs * (1 - progress)) / 1000) : 0;

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      <button
        type="button"
        {...handlers}
        disabled={locked}
        aria-label={
          busyLabel
            ? busyLabel
            : `Send emergency SOS. Press ${requiredTaps} times quickly, or press and hold for ${Math.round(holdMs / 1000)} seconds.`
        }
        style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        className={`relative px-5 py-2.5 rounded-xl font-bold text-xs shadow-xs
          transition-all flex items-center justify-center gap-2 border-2
          disabled:cursor-not-allowed
          ${onAlert
            ? `text-[#A31616] ${oneTapAway || holding
                ? 'bg-white border-white scale-[1.03]'
                : 'bg-white hover:bg-[#F7EFEF] border-white'}`
            : `text-white ${oneTapAway || holding
                ? 'bg-[#9A1C13] border-white/60 scale-[1.03]'
                : 'bg-[#9A1C13] hover:bg-[#8A1A12] border-white/25'}`}
          ${className}`}
      >
        {/* Hold-progress fill */}
        {holding && (
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-xl pointer-events-none ${onAlert ? 'bg-[#A31616]/20' : 'bg-white/20'}`}
            style={{ clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }}
          />
        )}

        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
        ) : holding ? (
          <Siren className="w-4 h-4 flex-shrink-0" />
        ) : (
          <Radar className={`w-4 h-4 flex-shrink-0 ${oneTapAway ? 'animate-pulse' : 'animate-pulse'}`} />
        )}

        <span className="relative flex items-baseline gap-1.5">
          {busyLabel ?? label}
          {!busy && taps > 0 && (
            <span className="font-data text-[10px] font-semibold opacity-90">
              ({taps}/{requiredTaps})
            </span>
          )}
        </span>
      </button>

      {/* Guidance line — tells the user exactly what to do, and confirms progress */}
      {!locked && (
        <p
          className={`text-[10px] text-center leading-tight transition-colors ${
            oneTapAway || holding
              ? 'text-white font-semibold'
              : onAlert
                ? 'text-white/80'
                : 'text-[#FCF1F0] opacity-80'
          }`}
        >
          {holding
            ? `Keep holding… ${secondsLeft}s`
            : oneTapAway
              ? `1 more tap to send SOS`
              : `Tap ${requiredTaps}× or hold ${Math.round(holdMs / 1000)}s`}
        </p>
      )}
    </div>
  );
};
