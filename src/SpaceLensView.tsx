import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderOpen,
  Folder,
  File,
  Trash2,
  Plus,
  Check,
  ChevronRight,
  ArrowUpLeft,
  ExternalLink,
  RefreshCw,
  Layers,
  Flame,
  HardDrive,
  Cloud,
  X,
  PieChart,
} from "lucide-react";
import ScanningRadar from "./ScanningRadar";
import type {
  CategoryStat,
  CollectorItem,
  PurgeCollectorResult,
  QuickPreset,
  SpaceLensReport,
  SpaceNode,
  StorageDriveInfo,
} from "./types";

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const val = bytes / Math.pow(1024, i);
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

const CATEGORY_COLORS: Record<string, string> = {
  video: "#3B82F6",
  cache: "#F59E0B",
  image: "#10B981",
  audio: "#8B5CF6",
  archive: "#EC4899",
  app: "#06B6D4",
  code: "#6366F1",
  document: "#14B8A6",
  folder: "#60A5FA",
  other: "#64748B",
};

const BRANCH_PALETTE = [
  "#3B82F6", // Blue
  "#10B981", // Emerald
  "#F59E0B", // Amber
  "#8B5CF6", // Violet
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#F97316", // Orange
  "#14B8A6", // Teal
  "#6366F1", // Indigo
  "#84CC16", // Lime
];

interface SunburstArc {
  id: string;
  node: SpaceNode;
  depth: number;
  startAngle: number;
  endAngle: number;
  innerR: number;
  outerR: number;
  color: string;
  pctOfFocus: number;
}

function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleInRadians: number
) {
  // Start at top (-PI/2)
  const a = angleInRadians - Math.PI / 2;
  return {
    x: cx + r * Math.cos(a),
    y: cy + r * Math.sin(a),
  };
}

function describeDonutArc(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number
): string {
  const clampedSpan = Math.min(endAngle - startAngle, Math.PI * 2 - 0.002);
  const end = startAngle + clampedSpan;

  const p1 = polarToCartesian(cx, cy, outerR, startAngle);
  const p2 = polarToCartesian(cx, cy, outerR, end);
  const p3 = polarToCartesian(cx, cy, innerR, end);
  const p4 = polarToCartesian(cx, cy, innerR, startAngle);

  const largeArc = clampedSpan > Math.PI ? 1 : 0;

  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function buildSunburstArcs(focusNode: SpaceNode): SunburstArc[] {
  const arcs: SunburstArc[] = [];
  const totalBytes = focusNode.sizeBytes;
  if (totalBytes <= 0 || !focusNode.children.length) return arcs;

  const ringRadii: Array<[number, number]> = [
    [66, 98],
    [101, 130],
    [133, 158],
    [161, 182],
  ];

  function walkChildren(
    nodes: SpaceNode[],
    depth: number,
    angleStart: number,
    angleSpan: number,
    inheritedColor?: string
  ) {
    if (depth > 4 || nodes.length === 0) return;
    const [innerR, outerR] = ringRadii[depth - 1];
    let cursor = angleStart;

    const parentSum = nodes.reduce((acc, n) => acc + n.sizeBytes, 0);
    if (parentSum <= 0) return;

    nodes.forEach((child, idx) => {
      const fraction = child.sizeBytes / parentSum;
      const span = fraction * angleSpan;
      // Skip tiny slices (< 1.2 degrees) to keep rendering crisp
      if (span < 0.022) {
        cursor += span;
        return;
      }

      const baseColor =
        depth === 1
          ? child.category === "cache"
            ? "#F59E0B"
            : BRANCH_PALETTE[idx % BRANCH_PALETTE.length]
          : inheritedColor || CATEGORY_COLORS[child.category] || "#3B82F6";

      arcs.push({
        id: `${child.path}-${depth}-${idx}`,
        node: child,
        depth,
        startAngle: cursor,
        endAngle: cursor + span,
        innerR,
        outerR,
        color: baseColor,
        pctOfFocus: (child.sizeBytes / totalBytes) * 100,
      });

      if (child.children && child.children.length > 0 && depth < 4) {
        walkChildren(child.children, depth + 1, cursor, span, baseColor);
      }

      cursor += span;
    });
  }

  walkChildren(focusNode.children, 1, 0, Math.PI * 2);
  return arcs;
}

interface Props {
  drives: StorageDriveInfo[];
  initialTargetPath: string | null;
  onShowToast: (msg: string) => void;
  onShowError: (err: string) => void;
  onRefreshDrives: () => void;
}

export default function SpaceLensView({
  drives,
  initialTargetPath,
  onShowToast,
  onShowError,
  onRefreshDrives,
}: Props) {
  const [presets, setPresets] = useState<QuickPreset[]>([]);
  const [report, setReport] = useState<SpaceLensReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [currentScanningPath, setCurrentScanningPath] = useState<string>("");
  const [focusStack, setFocusStack] = useState<SpaceNode[]>([]);
  const [hoveredNode, setHoveredNode] = useState<SpaceNode | null>(null);
  const [rightListMode, setRightListMode] = useState<"children" | "topFiles">(
    "children"
  );
  const [collector, setCollector] = useState<CollectorItem[]>([]);
  const [isPurging, setIsPurging] = useState(false);
  const [confirmPurgeModal, setConfirmPurgeModal] = useState(false);

  useEffect(() => {
    invoke<QuickPreset[]>("get_quick_scan_presets")
      .then((list) => {
        setPresets(list);
        if (initialTargetPath) {
          handleRunScan(initialTargetPath);
        } else if (list.length > 0 && !report) {
          handleRunScan(list[0].path);
        }
      })
      .catch((e) => onShowError(String(e)));
  }, [initialTargetPath]);

  const handleRunScan = async (targetPath: string) => {
    setIsScanning(true);
    setCurrentScanningPath(targetPath);
    setHoveredNode(null);
    try {
      const res = await invoke<SpaceLensReport>("scan_space_lens_cmd", {
        targetPath,
      });
      setReport(res);
      setFocusStack([res.rootNode]);
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handlePickCustomFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choisir un dossier ou disque à analyser avec Space Lens",
      });
      if (typeof selected === "string" && selected) {
        await handleRunScan(selected);
      }
    } catch (err) {
      onShowError(String(err));
    }
  };

  const currentFocusNode: SpaceNode | null = useMemo(() => {
    if (focusStack.length === 0) return null;
    return focusStack[focusStack.length - 1];
  }, [focusStack]);

  const sunburstArcs = useMemo(() => {
    if (!currentFocusNode) return [];
    return buildSunburstArcs(currentFocusNode);
  }, [currentFocusNode]);

  const handleDrillDown = async (node: SpaceNode) => {
    if (!node.isDir || node.name.startsWith("Autres (")) return;
    if (node.children && node.children.length > 0) {
      // Find path from currentFocusNode down to clicked node so breadcrumb is accurate
      setFocusStack((prev) => [...prev, node]);
      setHoveredNode(null);
    } else {
      // Deep rescan on this subfolder
      await handleRunScan(node.path);
    }
  };

  const handleStepUp = () => {
    if (focusStack.length > 1) {
      setFocusStack((prev) => prev.slice(0, prev.length - 1));
      setHoveredNode(null);
    }
  };

  const isInCollector = (path: string) =>
    collector.some((item) => item.path === path);

  const toggleCollectorItem = (item: CollectorItem) => {
    if (item.name.startsWith("Autres (")) return;
    setCollector((prev) => {
      if (prev.some((x) => x.path === item.path)) {
        return prev.filter((x) => x.path !== item.path);
      }
      return [...prev, item];
    });
  };

  const totalCollectedBytes = useMemo(
    () => collector.reduce((acc, item) => acc + item.sizeBytes, 0),
    [collector]
  );

  const handleExecuteCollectorPurge = async () => {
    if (collector.length === 0) return;
    setIsPurging(true);
    try {
      const paths = collector.map((c) => c.path);
      const res = await invoke<PurgeCollectorResult>("purge_space_collector", {
        paths,
      });
      setConfirmPurgeModal(false);
      setCollector([]);
      if (res.errors.length > 0) {
        onShowError(res.errors.join(" • "));
      }
      if (res.deletedCount > 0) {
        onShowToast(
          `${res.deletedCount} élément(s) supprimé(s) (${formatBytes(
            res.freedBytes
          )} libérés)`
        );
      }
      onRefreshDrives();
      if (report) {
        await handleRunScan(report.rootPath);
      }
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsPurging(false);
    }
  };

  const handleReveal = async (path: string) => {
    try {
      await invoke("reveal_in_finder", { path });
    } catch (err) {
      onShowError(String(err));
    }
  };

  const activeDisplayNode = hoveredNode || currentFocusNode;
  const activeDisplayPct =
    activeDisplayNode &&
    currentFocusNode &&
    currentFocusNode.sizeBytes > 0 &&
    activeDisplayNode.path !== currentFocusNode.path
      ? Math.min(
          100,
          (activeDisplayNode.sizeBytes / currentFocusNode.sizeBytes) * 100
        ).toFixed(1)
      : "100";

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#191919]">
      {/* ================= TOP TARGET BAR ================= */}
      <div className="px-5 py-3 border-b border-[#2A2A2A] bg-[#161616] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Mounted External & Cloud Drives */}
          {drives
            .filter((d) => d.mountPoint !== "/")
            .map((d) => {
              const isSelected = report?.rootPath === d.mountPoint;
              return (
                <button
                  key={d.id}
                  onClick={() => handleRunScan(d.mountPoint)}
                  disabled={isScanning}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-[#3B82F6]/20 border-[#3B82F6]/50 text-[#60A5FA]"
                      : "bg-[#222222] hover:bg-[#2B2B2B] border-[#303030] text-[#EDEDEC]"
                  }`}
                >
                  {d.isCloud ? (
                    <Cloud className="w-3.5 h-3.5 text-[#38BDF8]" />
                  ) : (
                    <HardDrive className="w-3.5 h-3.5 text-[#10B981]" />
                  )}
                  <span>{d.name}</span>
                </button>
              );
            })}

          {/* Quick Local Presets */}
          {presets.map((preset) => {
            const isSelected = report?.rootPath === preset.path;
            return (
              <button
                key={preset.path}
                onClick={() => handleRunScan(preset.path)}
                disabled={isScanning}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-[#3B82F6]/20 border-[#3B82F6]/50 text-[#60A5FA]"
                    : "bg-[#1F1F1F] hover:bg-[#282828] border-[#2C2C2C] text-[#9B9A97] hover:text-[#EDEDEC]"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          {report && (
            <button
              onClick={() => handleRunScan(report.rootPath)}
              disabled={isScanning}
              className="px-2.5 py-1 rounded-lg bg-[#222222] hover:bg-[#2C2C2C] border border-[#323232] text-xs text-[#9B9A97] hover:text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
              title="Relancer le scan"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isScanning ? "animate-spin text-[#3B82F6]" : ""
                }`}
              />
              <span>Rescanner</span>
            </button>
          )}

          <button
            onClick={handlePickCustomFolder}
            disabled={isScanning}
            className="px-3 py-1 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Choisir un dossier…</span>
          </button>
        </div>
      </div>

      {/* ================= BREADCRUMB & CATEGORY BAR ================= */}
      {report && currentFocusNode && (
        <div className="px-5 py-2 border-b border-[#252525] bg-[#191919] flex items-center justify-between gap-4 shrink-0">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 text-xs overflow-x-auto min-w-0">
            {focusStack.map((node, i) => {
              const isLast = i === focusStack.length - 1;
              return (
                <div key={node.path + i} className="flex items-center gap-1 shrink-0">
                  {i > 0 && (
                    <ChevronRight className="w-3.5 h-3.5 text-[#555555]" />
                  )}
                  <button
                    onClick={() =>
                      setFocusStack((prev) => prev.slice(0, i + 1))
                    }
                    className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                      isLast
                        ? "bg-[#262626] text-[#EDEDEC] font-semibold"
                        : "text-[#9B9A97] hover:text-[#EDEDEC] hover:bg-[#222222]"
                    }`}
                  >
                    {node.name}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Scan speed & stats */}
          <div className="flex items-center gap-3 text-[11px] font-mono text-[#787774] shrink-0">
            <span>{report.totalFiles.toLocaleString("fr-FR")} fichiers</span>
            <span>•</span>
            <span>{report.scanDurationMs} ms</span>
          </div>
        </div>
      )}

      {/* ================= MAIN SPLIT VIEW: SUNBURST + LIST ================= */}
      {isScanning ? (
        <ScanningRadar
          icon={<PieChart className="w-8 h-8 text-[#3B82F6]" />}
          title="Cartographie Space Lens en cours…"
          subtitle={currentScanningPath ? `Chemin : ${currentScanningPath}` : undefined}
          color="blue"
          stages={[
            "Traversée récursive du système de fichiers...",
            "Parcours multi-cœur haute performance (Rayon)...",
            "Calcul des allocations physiques et dossiers volumineux...",
            "Génération de la rosace visuelle interactive...",
          ]}
        />
      ) : !report || !currentFocusNode ? (
        <div className="flex-1 flex items-center justify-center p-8 text-center">
          <div className="space-y-3">
            <p className="text-xs text-[#9B9A97]">
              Sélectionnez un support ou un dossier ci-dessus pour lancer Space Lens.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
          {/* LEFT: DAISYDISK INTERACTIVE SUNBURST */}
          <div className="lg:col-span-6 border-r border-[#262626] p-5 flex flex-col items-center justify-between min-h-0 overflow-hidden bg-[#171717]">
            {/* Interactive SVG Sunburst */}
            <div className="relative flex-1 flex items-center justify-center w-full min-h-0">
              <svg
                viewBox="0 0 400 400"
                className="w-full h-full max-w-[380px] max-h-[380px] select-none"
              >
                {/* Background guide circle */}
                <circle
                  cx={200}
                  cy={200}
                  r={62}
                  fill="#1F1F1F"
                  stroke="#2E2E2E"
                  strokeWidth={1.5}
                />

                {sunburstArcs.map((arc) => {
                  const isHovered = hoveredNode?.path === arc.node.path;
                  const pathD = describeDonutArc(
                    200,
                    200,
                    arc.innerR,
                    arc.outerR,
                    arc.startAngle,
                    arc.endAngle
                  );
                  const opacity =
                    hoveredNode && !isHovered
                      ? 0.45
                      : 1 - (arc.depth - 1) * 0.14;

                  return (
                    <path
                      key={arc.id}
                      d={pathD}
                      fill={arc.color}
                      fillOpacity={Math.max(0.3, opacity)}
                      stroke="#171717"
                      strokeWidth={1.6}
                      onMouseEnter={() => setHoveredNode(arc.node)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onClick={() => handleDrillDown(arc.node)}
                      className={
                        arc.node.isDir && !arc.node.name.startsWith("Autres (")
                          ? "cursor-pointer transition-opacity duration-150"
                          : "transition-opacity duration-150"
                      }
                    />
                  );
                })}
              </svg>

              {/* Center Hub Readout */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-28 h-28 rounded-full flex flex-col items-center justify-center text-center px-2 pointer-events-auto">
                  {focusStack.length > 1 && !hoveredNode && (
                    <button
                      onClick={handleStepUp}
                      className="mb-0.5 px-2 py-0.5 rounded-full bg-[#2B2B2B] hover:bg-[#383838] text-[10px] text-[#93C5FD] flex items-center gap-0.5 cursor-pointer"
                      title="Remonter au dossier parent"
                    >
                      <ArrowUpLeft className="w-3 h-3" />
                      <span>Parent</span>
                    </button>
                  )}
                  <span className="text-[11px] font-medium text-[#9B9A97] truncate max-w-[102px]">
                    {activeDisplayNode?.name}
                  </span>
                  <span className="text-sm font-bold text-[#EDEDEC] font-mono mt-0.5">
                    {formatBytes(activeDisplayNode?.sizeBytes || 0)}
                  </span>
                  <span className="text-[10px] font-mono text-[#10B981]">
                    {activeDisplayPct}%
                  </span>
                </div>
              </div>
            </div>

            {/* Category Breakdown Bar */}
            {report.categories.length > 0 && (
              <div className="w-full pt-3 border-t border-[#252525] space-y-2 shrink-0">
                <div className="w-full h-2 rounded-full bg-[#121212] overflow-hidden flex">
                  {report.categories.map((cat: CategoryStat) => {
                    const pct =
                      report.totalScannedBytes > 0
                        ? (cat.sizeBytes / report.totalScannedBytes) * 100
                        : 0;
                    if (pct < 0.8) return null;
                    return (
                      <div
                        key={cat.category}
                        style={{
                          width: `${pct}%`,
                          backgroundColor:
                            CATEGORY_COLORS[cat.category] || "#64748B",
                        }}
                        title={`${cat.label}: ${formatBytes(cat.sizeBytes)}`}
                        className="h-full"
                      />
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {report.categories.slice(0, 5).map((cat: CategoryStat) => (
                    <div
                      key={cat.category}
                      className="flex items-center gap-1.5 text-[11px]"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            CATEGORY_COLORS[cat.category] || "#64748B",
                        }}
                      />
                      <span className="text-[#9B9A97]">{cat.label}</span>
                      <span className="font-mono text-[#EDEDEC]">
                        {formatBytes(cat.sizeBytes)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: CHILDREN EXPLORER & TOP LARGEST FILES */}
          <div className="lg:col-span-6 flex flex-col min-h-0 overflow-hidden bg-[#191919]">
            {/* Mode Switcher Header */}
            <div className="px-4 py-2.5 border-b border-[#262626] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-1 bg-[#141414] p-0.5 rounded-lg border border-[#282828]">
                <button
                  onClick={() => setRightListMode("children")}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                    rightListMode === "children"
                      ? "bg-[#262626] text-[#EDEDEC]"
                      : "text-[#9B9A97] hover:text-[#EDEDEC]"
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span>
                    Dossiers &amp; Éléments ({currentFocusNode.children.length})
                  </span>
                </button>

                <button
                  onClick={() => setRightListMode("topFiles")}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                    rightListMode === "topFiles"
                      ? "bg-[#262626] text-[#EDEDEC]"
                      : "text-[#9B9A97] hover:text-[#EDEDEC]"
                  }`}
                >
                  <Flame className="w-3.5 h-3.5 text-[#F59E0B]" />
                  <span>Top Fichiers Lourds ({report.topFiles.length})</span>
                </button>
              </div>

              {focusStack.length > 1 && rightListMode === "children" && (
                <button
                  onClick={handleStepUp}
                  className="px-2.5 py-1 rounded-lg bg-[#232323] hover:bg-[#2D2D2D] border border-[#333333] text-xs text-[#EDEDEC] flex items-center gap-1 cursor-pointer"
                >
                  <ArrowUpLeft className="w-3.5 h-3.5" />
                  <span>Remonter</span>
                </button>
              )}
            </div>

            {/* Scrollable List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {rightListMode === "children" ? (
                currentFocusNode.children.map((child, idx) => {
                  const pct =
                    currentFocusNode.sizeBytes > 0
                      ? Math.min(
                          100,
                          (child.sizeBytes / currentFocusNode.sizeBytes) * 100
                        )
                      : 0;
                  const barColor =
                    child.category === "cache"
                      ? "#F59E0B"
                      : BRANCH_PALETTE[idx % BRANCH_PALETTE.length];
                  const collected = isInCollector(child.path);
                  const isAggregate = child.name.startsWith("Autres (");

                  return (
                    <div
                      key={child.path + idx}
                      onMouseEnter={() => setHoveredNode(child)}
                      onMouseLeave={() => setHoveredNode(null)}
                      className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                        hoveredNode?.path === child.path
                          ? "bg-[#252525] border-[#3A3A3A]"
                          : "bg-[#1E1E1E] border-[#292929]"
                      }`}
                    >
                      <div
                        onClick={() => handleDrillDown(child)}
                        className={`flex items-center gap-2.5 min-w-0 flex-1 ${
                          child.isDir && !isAggregate ? "cursor-pointer" : ""
                        }`}
                      >
                        <div
                          className="w-2.5 h-8 rounded-full shrink-0"
                          style={{ backgroundColor: barColor }}
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {child.isDir ? (
                                <Folder className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
                              ) : (
                                <File className="w-3.5 h-3.5 text-[#9B9A97] shrink-0" />
                              )}
                              <span className="text-xs font-medium text-[#EDEDEC] truncate">
                                {child.name}
                              </span>
                              {child.category === "cache" && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#F59E0B]/15 text-[#FBBF24] shrink-0">
                                  Cache
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-mono font-semibold text-[#EDEDEC] shrink-0">
                              {formatBytes(child.sizeBytes)}
                            </span>
                          </div>

                          <div className="w-full h-1 rounded-full bg-[#131313] overflow-hidden">
                            <div
                              style={{
                                width: `${Math.max(2, pct)}%`,
                                backgroundColor: barColor,
                              }}
                              className="h-full rounded-full"
                            />
                          </div>
                        </div>
                      </div>

                      {!isAggregate && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleReveal(child.path)}
                            className="p-1.5 rounded-lg bg-[#161616] hover:bg-[#2E2E2E] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
                            title="Révéler dans le Finder"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() =>
                              toggleCollectorItem({
                                path: child.path,
                                name: child.name,
                                sizeBytes: child.sizeBytes,
                                isDir: child.isDir,
                                category: child.category,
                              })
                            }
                            className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 border transition-colors cursor-pointer ${
                              collected
                                ? "bg-[#EF4444]/20 border-[#EF4444]/40 text-[#FCA5A5]"
                                : "bg-[#161616] hover:bg-[#2A2A2A] border-[#2E2E2E] text-[#9B9A97] hover:text-[#EDEDEC]"
                            }`}
                            title="Ajouter au Collecteur de Purge"
                          >
                            {collected ? (
                              <>
                                <Check className="w-3 h-3" />
                                <span>Collecté</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3 h-3" />
                                <span>Purge</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : report.topFiles.length === 0 ? (
                <div className="py-10 text-center text-xs text-[#787774]">
                  Aucun fichier supérieur à 10 Mo dans ce dossier.
                </div>
              ) : (
                report.topFiles.map((file, idx) => {
                  const collected = isInCollector(file.path);
                  return (
                    <div
                      key={file.path + idx}
                      className="p-2.5 rounded-xl bg-[#1E1E1E] border border-[#292929] flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-[#EDEDEC] truncate">
                            {file.name}
                          </span>
                          <span className="text-xs font-mono font-semibold text-[#FBBF24] shrink-0">
                            {formatBytes(file.sizeBytes)}
                          </span>
                        </div>
                        <p className="text-[10px] font-mono text-[#787774] truncate mt-0.5">
                          {file.path}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleReveal(file.path)}
                          className="p-1.5 rounded-lg bg-[#161616] hover:bg-[#2E2E2E] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
                          title="Révéler dans le Finder"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() =>
                            toggleCollectorItem({
                              path: file.path,
                              name: file.name,
                              sizeBytes: file.sizeBytes,
                              isDir: false,
                              category: file.category,
                            })
                          }
                          className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 border transition-colors cursor-pointer ${
                            collected
                              ? "bg-[#EF4444]/20 border-[#EF4444]/40 text-[#FCA5A5]"
                              : "bg-[#161616] hover:bg-[#2A2A2A] border-[#2E2E2E] text-[#9B9A97] hover:text-[#EDEDEC]"
                          }`}
                        >
                          {collected ? (
                            <>
                              <Check className="w-3 h-3" />
                              <span>Collecté</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3 h-3" />
                              <span>Purge</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= BOTTOM DOCK: PURGE COLLECTOR ================= */}
      {collector.length > 0 && (
        <div className="px-5 py-3 border-t border-[#382323] bg-[#1D1616] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-lg bg-[#EF4444]/20 border border-[#EF4444]/40 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-[#EF4444]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#EDEDEC]">
                  Collecteur de Purge ({collector.length})
                </span>
                <span className="text-xs font-mono font-bold text-[#FCA5A5]">
                  {formatBytes(totalCollectedBytes)} à libérer
                </span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto mt-1">
                {collector.map((item) => (
                  <span
                    key={item.path}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#2A1E1E] border border-[#422B2B] text-[10px] text-[#EDEDEC] shrink-0"
                  >
                    <span className="truncate max-w-[140px]">{item.name}</span>
                    <span className="font-mono text-[#FCA5A5]">
                      ({formatBytes(item.sizeBytes)})
                    </span>
                    <button
                      onClick={() => toggleCollectorItem(item)}
                      className="hover:text-[#EF4444] cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setCollector([])}
              className="px-3 py-1.5 rounded-lg bg-[#282020] hover:bg-[#332727] text-xs text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
            >
              Vider
            </button>
            <button
              onClick={() => setConfirmPurgeModal(true)}
              className="px-4 py-1.5 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Libérer {formatBytes(totalCollectedBytes)}</span>
            </button>
          </div>
        </div>
      )}

      {/* ================= CONFIRMATION MODAL FOR PURGE COLLECTOR ================= */}
      {confirmPurgeModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-[#EF4444]" />
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Confirmer la purge immédiate
                </h3>
              </div>
              <button
                onClick={() => setConfirmPurgeModal(false)}
                className="p-1 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-[#9B9A97]">
                Ces {collector.length} élément(s) seront supprimés définitivement (sans passer par `.Trashes`) pour libérer immédiatement{" "}
                <strong className="text-[#EDEDEC]">
                  {formatBytes(totalCollectedBytes)}
                </strong>
                .
              </p>

              <div className="max-h-44 overflow-y-auto space-y-1.5 p-2 rounded-xl bg-[#161616] border border-[#282828]">
                {collector.map((c) => (
                  <div
                    key={c.path}
                    className="flex items-center justify-between text-xs gap-2 px-2 py-1"
                  >
                    <span className="truncate text-[#EDEDEC] font-mono text-[11px]">
                      {c.path}
                    </span>
                    <span className="font-mono text-[#FCA5A5] shrink-0">
                      {formatBytes(c.sizeBytes)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setConfirmPurgeModal(false)}
                  className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handleExecuteCollectorPurge}
                  disabled={isPurging}
                  className="px-4 py-2 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {isPurging
                      ? "Suppression…"
                      : `Supprimer (${formatBytes(totalCollectedBytes)})`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

