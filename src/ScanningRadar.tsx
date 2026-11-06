import { useEffect, useState } from "react";
import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  color?: "emerald" | "blue" | "purple" | "amber";
  stages?: string[];
}

export default function ScanningRadar({
  icon,
  title,
  subtitle,
  color = "emerald",
  stages = [
    "Lecture de l'arborescence et métadonnées...",
    "Exploration parallèle multi-cœur active...",
    "Calcul des blocs et allocations physiques...",
    "Génération de la synthèse visuelle...",
  ],
}: Props) {
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Timer ticker
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Stage switcher
  useEffect(() => {
    if (stages.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentStageIdx((prev) => (prev + 1) % stages.length);
    }, 2400);
    return () => clearInterval(interval);
  }, [stages]);

  const seconds = Math.floor(elapsedMs / 1000);
  const tenths = Math.floor((elapsedMs % 1000) / 100);
  const formattedTime = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
    seconds % 60
  ).padStart(2, "0")}.${tenths}`;

  const colorConfig = {
    emerald: {
      accent: "text-[#10B981]",
      border: "border-[#10B981]/30",
      bgLight: "bg-[#10B981]/10",
      glow: "shadow-[0_0_30px_rgba(16,185,129,0.18)]",
      radarStroke: "#10B981",
      beamColor: "from-[#10B981]/25",
    },
    blue: {
      accent: "text-[#3B82F6]",
      border: "border-[#3B82F6]/30",
      bgLight: "bg-[#3B82F6]/10",
      glow: "shadow-[0_0_30px_rgba(59,130,246,0.18)]",
      radarStroke: "#3B82F6",
      beamColor: "from-[#3B82F6]/25",
    },
    purple: {
      accent: "text-[#8B5CF6]",
      border: "border-[#8B5CF6]/30",
      bgLight: "bg-[#8B5CF6]/10",
      glow: "shadow-[0_0_30px_rgba(139,92,246,0.18)]",
      radarStroke: "#8B5CF6",
      beamColor: "from-[#8B5CF6]/25",
    },
    amber: {
      accent: "text-[#F59E0B]",
      border: "border-[#F59E0B]/30",
      bgLight: "bg-[#F59E0B]/10",
      glow: "shadow-[0_0_30px_rgba(245,158,11,0.18)]",
      radarStroke: "#F59E0B",
      beamColor: "from-[#F59E0B]/25",
    },
  }[color];

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 select-none">
      <div className="relative flex items-center justify-center w-64 h-64 mb-6">
        {/* Pulsing Sonar Ring 1 */}
        <div
          className={`absolute w-52 h-52 rounded-full border border-dashed ${colorConfig.border} animate-ping opacity-20 duration-1000`}
        />

        {/* Pulsing Sonar Ring 2 */}
        <div
          className={`absolute w-40 h-40 rounded-full border ${colorConfig.border} opacity-40 animate-pulse`}
        />

        {/* Outer Circular Gauge Dial */}
        <svg
          viewBox="0 0 200 200"
          className="absolute w-56 h-56 animate-spin duration-700"
          style={{ animationDuration: "16s" }}
        >
          <circle
            cx="100"
            cy="100"
            r="90"
            fill="none"
            stroke={colorConfig.radarStroke}
            strokeWidth="1.5"
            strokeDasharray="4 8"
            opacity="0.35"
          />
          <circle
            cx="100"
            cy="100"
            r="65"
            fill="none"
            stroke={colorConfig.radarStroke}
            strokeWidth="1"
            strokeDasharray="2 12"
            opacity="0.25"
          />
        </svg>

        {/* Rotating Radar Sweeping Beam */}
        <div
          className="absolute w-56 h-56 rounded-full overflow-hidden pointer-events-none animate-spin"
          style={{ animationDuration: "3s" }}
        >
          <div
            className={`w-1/2 h-1/2 origin-bottom-right bg-gradient-to-tl ${colorConfig.beamColor} via-transparent to-transparent`}
            style={{
              clipPath: "polygon(0 0, 100% 0, 100% 100%)",
            }}
          />
        </div>

        {/* Central Orb with active Tool Icon */}
        <div
          className={`relative z-10 w-16 h-16 rounded-2xl ${colorConfig.bgLight} border ${colorConfig.border} ${colorConfig.accent} ${colorConfig.glow} flex items-center justify-center transition-all duration-300`}
        >
          <div className="w-8 h-8 flex items-center justify-center">
            {icon}
          </div>
        </div>
      </div>

      {/* Title & Technical Milestones */}
      <div className="text-center max-w-md space-y-2">
        <h3 className="text-base font-bold text-[#EDEDEC] tracking-tight">
          {title}
        </h3>

        {/* Dynamic Rotating Milestone Sub-step */}
        <div className="h-6 flex items-center justify-center">
          <p
            key={currentStageIdx}
            className="text-xs text-[#9B9A97] font-medium transition-all duration-300 animate-fadeIn"
          >
            {stages[currentStageIdx]}
          </p>
        </div>

        {/* Live Multi-Core Activity Bars & Chronometer */}
        <div className="pt-3 flex items-center justify-center gap-4">
          {/* Animated CPU/Thread Wave Bars */}
          <div className="flex items-end gap-1 h-4">
            <span
              className={`w-1 bg-[#10B981] rounded-full animate-bounce`}
              style={{ height: "40%", animationDelay: "0ms" }}
            />
            <span
              className={`w-1 bg-[#3B82F6] rounded-full animate-bounce`}
              style={{ height: "100%", animationDelay: "150ms" }}
            />
            <span
              className={`w-1 bg-[#10B981] rounded-full animate-bounce`}
              style={{ height: "70%", animationDelay: "300ms" }}
            />
            <span
              className={`w-1 bg-[#8B5CF6] rounded-full animate-bounce`}
              style={{ height: "90%", animationDelay: "450ms" }}
            />
            <span
              className={`w-1 bg-[#3B82F6] rounded-full animate-bounce`}
              style={{ height: "50%", animationDelay: "600ms" }}
            />
          </div>

          <span className="text-[11px] font-mono text-[#787774] px-2 py-0.5 rounded bg-[#161616] border border-[#272727]">
            {formattedTime}
          </span>
        </div>

        {subtitle && (
          <p className="text-[11px] text-[#555555] font-mono pt-1">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

