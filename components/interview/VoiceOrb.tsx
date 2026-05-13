"use client";

import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

interface VoiceOrbProps {
  state: OrbState;
  /** Ref to current microphone amplitude 0–1, updated via requestAnimationFrame */
  amplitudeRef?: React.RefObject<number>;
  /** Diameter in pixels (default 240) */
  size?: number;
}

// Per-state radial gradient, glow, ring, and highlight colors
const COLORS: Record<OrbState, { body: string; glow: string; ring: string; highlight: string }> = {
  idle: {
    body:      "radial-gradient(circle at 36% 30%, #c4b5fd 0%, #6366f1 45%, #1e1b4b 100%)",
    glow:      "#4f46e5",
    ring:      "#818cf8",
    highlight: "rgba(255,255,255,0.18)",
  },
  listening: {
    body:      "radial-gradient(circle at 36% 30%, #fde68a 0%, #f97316 45%, #7c2d12 100%)",
    glow:      "#ea580c",
    ring:      "#fb923c",
    highlight: "rgba(255,255,255,0.22)",
  },
  thinking: {
    body:      "radial-gradient(circle at 36% 30%, #f1f5f9 0%, #94a3b8 45%, #1e293b 100%)",
    glow:      "#475569",
    ring:      "#94a3b8",
    highlight: "rgba(255,255,255,0.20)",
  },
  speaking: {
    body:      "radial-gradient(circle at 36% 30%, #a5f3fc 0%, #3b82f6 45%, #1e3a8a 100%)",
    glow:      "#2563eb",
    ring:      "#60a5fa",
    highlight: "rgba(255,255,255,0.20)",
  },
};

// Ring expansion duration per state (seconds) — shorter = more energetic
const RING_DURATIONS: Record<OrbState, number> = {
  idle:      2.8,
  listening: 1.2,
  thinking:  3.6,
  speaking:  1.7,
};

export function VoiceOrb({ state, amplitudeRef, size = 240 }: VoiceOrbProps) {
  const glowRef = useRef<HTMLDivElement>(null);
  const rafRef  = useRef<number>(0);

  const colors  = COLORS[state];
  const ringDur = RING_DURATIONS[state];

  // Drive glow opacity from microphone amplitude via RAF (no React re-renders per frame)
  useEffect(() => {
    if (!amplitudeRef) return;

    const tick = () => {
      const amp = amplitudeRef.current ?? 0;
      if (glowRef.current) {
        glowRef.current.style.opacity = (0.18 + amp * 0.18).toFixed(3);
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [amplitudeRef]);

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* CSS custom property scope for ring animations */}
      <div
        className="absolute inset-0"
        style={{
          "--ring-duration": `${ringDur}s`,
          "--ring-color": colors.ring,
        } as React.CSSProperties}
      >
        {/* Ambient glow behind orb */}
        <div
          ref={glowRef}
          className="orb-glow absolute rounded-full blur-3xl pointer-events-none"
          style={{
            inset: -Math.round(size * 0.35),
            background: colors.glow,
            opacity: 0.18,
          }}
        />

        {/* Three expanding rings */}
        <div className="orb-ring orb-ring-1" />
        <div className="orb-ring orb-ring-2" />
        <div className="orb-ring orb-ring-3" />

        {/* Main orb body — state-driven animation class */}
        <div
          className={`absolute inset-0 rounded-full orb-${state} transition-[box-shadow,background] duration-700`}
          style={{
            background: colors.body,
            boxShadow: [
              `0 0 ${Math.round(size * 0.25)}px 0 ${colors.glow}55`,
              `0 ${Math.round(size * 0.05)}px ${Math.round(size * 0.15)}px 0 ${colors.glow}33`,
              "inset 0 1px 0 0 rgba(255,255,255,0.15)",
            ].join(", "),
          }}
        />

        {/* Specular highlight — top-left sphere illusion */}
        <div
          className="absolute rounded-full blur-md pointer-events-none"
          style={{
            top: "14%",
            left: "18%",
            width: "36%",
            height: "28%",
            background: colors.highlight,
          }}
        />

        {/* Subtle inner rim */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            inset: "10%",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        />
      </div>
    </div>
  );
}
