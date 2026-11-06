import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Sparkles, Activity } from "lucide-react";

interface Props {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  color?: "emerald" | "blue" | "purple" | "amber" | "cyan";
  stages?: string[];
  itemCount?: number;
  progressPercent?: number;
}

export default function ScanningRadar({
  icon,
  title,
  subtitle,
  color = "emerald",
  stages = [
    "Lecture de l'arborescence et metadonnees...",
    "Exploration parallele multi-coeur active...",
    "Calcul des blocs et allocations physiques...",
    "Generation de la synthese visuelle...",
  ],
  itemCount,
  progressPercent,
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
    }, 2200);
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
      ambientGlow: "bg-[#10B981]/10",
      radarStroke: "#10B981",
      beamColor: "from-[#10B981]/25",
      barColor: "bg-[#10B981]",
    },
    blue: {
      accent: "text-[#3B82F6]",
      border: "border-[#3B82F6]/30",
      bgLight: "bg-[#3B82F6]/10",
      ambientGlow: "bg-[#3B82F6]/10",
      radarStroke: "#3B82F6",
      beamColor: "from-[#3B82F6]/25",
      barColor: "bg-[#3B82F6]",
    },
    purple: {
      accent: "text-[#8B5CF6]",
      border: "border-[#8B5CF6]/30",
      bgLight: "bg-[#8B5CF6]/10",
      ambientGlow: "bg-[#8B5CF6]/10",
      radarStroke: "#8B5CF6",
      beamColor: "from-[#8B5CF6]/25",
      barColor: "bg-[#8B5CF6]",
    },
    amber: {
      accent: "text-[#F59E0B]",
      border: "border-[#F59E0B]/30",
      bgLight: "bg-[#F59E0B]/10",
      ambientGlow: "bg-[#F59E0B]/10",
      radarStroke: "#F59E0B",
      beamColor: "from-[#F59E0B]/25",
      barColor: "bg-[#F59E0B]",
    },
    cyan: {
      accent: "text-[#06B6D4]",
      border: "border-[#06B6D4]/30",
      bgLight: "bg-[#06B6D4]/10",
      ambientGlow: "bg-[#06B6D4]/10",
      radarStroke: "#06B6D4",
      beamColor: "from-[#06B6D4]/25",
      barColor: "bg-[#06B6D4]",
    },
  }[color];

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 select-none relative overflow-hidden min-h-[320px]">
      {/* Ambient background blur glow */}
      <div
        className={`absolute w-80 h-80 rounded-full ${colorConfig.ambientGlow} blur-3xl pointer-events-none -top-10 left-1/2 -translate-x-1/2 opacity-60`}
      />

      <div className="relative flex items-center justify-center w-60 h-60 mb-5 z-10">
        {/* Pulsing Sonar Ring 1 */}
        <div
          className={`absolute w-52 h-52 rounded-full border border-dashed ${colorConfig.border} animate-ping opacity-25 duration-1000`}
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
          style={{ animationDuration: "2.8s" }}
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
          className={`relative z-10 w-16 h-16 rounded-2xl ${colorConfig.bgLight} border ${colorConfig.border} ${colorConfig.accent} shadow-2xl flex items-center justify-center transition-all duration-300`}
        >
          <div className="w-8 h-8 flex items-center justify-center">
            {icon}
          </div>
        </div>
      </div>

      {/* Title & Technical Milestones */}
      <div className="text-center max-w-md space-y-2 z-10">
        <h3 className="text-base font-bold text-[#EDEDEC] tracking-tight">
          {title}
        </h3>

        {/* Dynamic Rotating Milestone Sub-step */}
        <div className="h-6 flex items-center justify-center">
          <p
            key={currentStageIdx}
            className="text-xs text-[#9B9A97] font-medium transition-all duration-300"
          >
            {stages[currentStageIdx]}
          </p>
        </div>

        {/* Live Multi-Core Activity Bars & Chronometer & Item Count */}
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          {/* Animated CPU/Thread Wave Bars */}
          <div className="flex items-end gap-1 h-3.5 px-2 py-1 rounded bg-[#161616] border border-[#272727]">
            <span
              className="w-1 bg-[#10B981] rounded-full animate-bounce"
              style={{ height: "40%", animationDelay: "0ms" }}
            />
            <span
              className="w-1 bg-[#3B82F6] rounded-full animate-bounce"
              style={{ height: "100%", animationDelay: "150ms" }}
            />
            <span
              className="w-1 bg-[#10B981] rounded-full animate-bounce"
              style={{ height: "70%", animationDelay: "300ms" }}
            />
            <span
              className="w-1 bg-[#8B5CF6] rounded-full animate-bounce"
              style={{ height: "90%", animationDelay: "450ms" }}
            />
            <span
              className="w-1 bg-[#3B82F6] rounded-full animate-bounce"
              style={{ height: "50%", animationDelay: "600ms" }}
            />
          </div>

          {/* Chronometer */}
          <span className="text-[11px] font-mono text-[#EDEDEC] px-2.5 py-1 rounded-lg bg-[#161616] border border-[#272727]">
            {formattedTime}
          </span>

          {/* Scanned Items Count if provided */}
          {itemCount !== undefined && itemCount > 0 && (
            <span className="text-[11px] font-mono text-[#9B9A97] px-2.5 py-1 rounded-lg bg-[#161616] border border-[#272727] flex items-center gap-1.5">
              <Activity className="w-3 h-3 text-[#10B981]" />
              <span>{itemCount.toLocaleString()} elements</span>
            </span>
          )}
        </div>

        {/* Optional Progress Bar */}
        {progressPercent !== undefined && progressPercent >= 0 && (
          <div className="pt-2 w-full max-w-xs mx-auto space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono text-[#9B9A97]">
              <span>Avancement</span>
              <span className="text-[#EDEDEC] font-bold">{Math.round(progressPercent)}%</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#141414] border border-[#2A2A2A] overflow-hidden">
              <div
                style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
                className={`h-full rounded-full ${colorConfig.barColor} transition-all duration-300`}
              />
            </div>
          </div>
        )}

        {subtitle && (
          <p className="text-[11px] text-[#787774] font-mono pt-1 max-w-xs mx-auto truncate" title={subtitle}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
