import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertTriangle,
  Copy,
  Camera,
  FolderOpen,
  RefreshCw,
  Trash2,
  Check,
  CheckSquare,
  Square,
  ExternalLink,
  ShieldAlert,
  HardDrive,
  X,
} from "lucide-react";
import type {
  DuplicateGroup,
  DuplicatePurgeReport,
  DuplicateScanReport,
  StorageDriveInfo,
} from "./types";
import ScanningRadar from "./ScanningRadar";

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

interface Props {
  drives: StorageDriveInfo[];
  onShowToast: (msg: string) => void;
  onShowError: (err: string) => void;
  onRefreshDrives: () => void;
}

export default function DuplicatesView({
  drives,
  onShowToast,
  onShowError,
  onRefreshDrives,
}: Props) {
  const [selectedMountPoint, setSelectedMountPoint] = useState<string>("/");
  const [customFolderPath, setCustomFolderPath] = useState<string | null>(null);
  const [includeSimilarPhotos, setIncludeSimilarPhotos] =
    useState<boolean>(true);
  const [minSizePreset, setMinSizePreset] = useState<number>(1024 * 1024); // 1 MB default

  const [isScanning, setIsScanning] = useState(false);
  const [report, setReport] = useState<DuplicateScanReport | null>(null);
  const [filterType, setFilterType] = useState<"all" | "exact" | "similar">(
    "all"
  );

  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [moveToTrash, setMoveToTrash] = useState<boolean>(true);
  const [confirmPurgeModal, setConfirmPurgeModal] = useState<boolean>(false);
  const [confirmIrreversible, setConfirmIrreversible] = useState<boolean>(false);
  const [isPurging, setIsPurging] = useState<boolean>(false);

  const activeTargetPath = customFolderPath || selectedMountPoint;
  const activeTargetLabel =
    activeTargetPath === "/" ? "Dossier Utilisateur (~)" : activeTargetPath;

  const resetResults = () => {
    setReport(null);
    setGroups([]);
  };

  const handleStartScan = async () => {
    setIsScanning(true);
    try {
      const res = await invoke<DuplicateScanReport>("scan_duplicates_cmd", {
        targetPath: activeTargetPath,
        includeSimilarPhotos,
        minSizeBytes: minSizePreset,
      });
      setReport(res);
      setGroups(res.groups);
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
        title: "Choisir un dossier à analyser pour les doublons",
      });
      if (typeof selected === "string" && selected) {
        setCustomFolderPath(selected);
        resetResults();
      }
    } catch (err) {
      onShowError(String(err));
    }
  };

  // Toggle single file deletion flag
  const toggleFileDeletion = (groupId: string, filePath: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.groupId !== groupId) return g;
        return {
          ...g,
          files: g.files.map((f) =>
            f.path === filePath
              ? { ...f, isMarkedForDeletion: !f.isMarkedForDeletion }
              : f
          ),
        };
      })
    );
  };

  // Selection strategies
  const applySelectionStrategy = (strategy: "default" | "newest" | "oldest" | "none") => {
    setGroups((prev) =>
      prev.map((g) => {
        let sorted = [...g.files];
        if (strategy === "newest") {
          sorted.sort((a, b) => b.modifiedTs - a.modifiedTs);
        } else if (strategy === "oldest" || strategy === "default") {
          sorted.sort((a, b) => a.modifiedTs - b.modifiedTs);
        }

        const keepPath =
          strategy === "none"
            ? null
            : sorted[0]?.path;

        return {
          ...g,
          files: g.files.map((f) => ({
            ...f,
            isMarkedForDeletion: strategy === "none" ? false : f.path !== keepPath,
          })),
        };
      })
    );
  };

  const filteredGroups = useMemo(() => {
    if (filterType === "exact") {
      return groups.filter((g) => g.matchType === "exact");
    }
    if (filterType === "similar") {
      return groups.filter((g) => g.matchType !== "exact");
    }
    return groups;
  }, [groups, filterType]);

  const selectedForDeletion = useMemo(() => {
    const list: { path: string; sizeBytes: number; name: string }[] = [];
    for (const g of groups) {
      for (const f of g.files) {
        if (f.isMarkedForDeletion) {
          list.push({ path: f.path, sizeBytes: f.sizeBytes, name: f.name });
        }
      }
    }
    return list;
  }, [groups]);

  const groupsWithAllSelectedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const g of groups) {
      if (g.files.length > 0 && g.files.every((f) => f.isMarkedForDeletion)) {
        ids.add(g.groupId);
      }
    }
    return ids;
  }, [groups]);

  const totalSelectedBytes = useMemo(
    () => selectedForDeletion.reduce((acc, f) => acc + f.sizeBytes, 0),
    [selectedForDeletion]
  );

  const openConfirmPurgeModal = () => {
    setConfirmIrreversible(false);
    setConfirmPurgeModal(true);
  };

  const handleExecutePurge = async () => {
    if (selectedForDeletion.length === 0) return;
    setIsPurging(true);
    try {
      const paths = selectedForDeletion.map((f) => f.path);
      const res = await invoke<DuplicatePurgeReport>("purge_duplicates_cmd", {
        pathsToDelete: paths,
        moveToTrash,
      });

      setConfirmPurgeModal(false);
      if (res.errors.length > 0) {
        onShowError(res.errors.join(" • "));
      }
      if (res.deletedFilesCount > 0) {
        onShowToast(
          `${res.deletedFilesCount} doublon(s) ${
            moveToTrash ? "déplacé(s) dans la Corbeille" : "supprimé(s)"
          } (${formatBytes(res.freedBytes)} libérés)`
        );
      }
      onRefreshDrives();
      await handleStartScan();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsPurging(false);
    }
  };

  const handleRevealFinder = async (path: string) => {
    try {
      await invoke("reveal_in_finder", { path });
    } catch (err) {
      onShowError(String(err));
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#191919]">
      {/* TOP TARGET BAR */}
      <div className="px-5 py-3 border-b border-[#2A2A2A] bg-[#161616] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* Drives Quick Buttons */}
          {drives
            .filter((d) => !d.isCloud)
            .map((d) => {
              const isSelected =
                !customFolderPath && selectedMountPoint === d.mountPoint;
              return (
                <button
                  key={d.id}
                  onClick={() => {
                    setCustomFolderPath(null);
                    setSelectedMountPoint(d.mountPoint);
                    resetResults();
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-[#EF4444]/20 border-[#EF4444]/50 text-[#FCA5A5]"
                      : "bg-[#202020] hover:bg-[#282828] border-[#2E2E2E] text-[#EDEDEC]"
                  }`}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>
                    {d.mountPoint === "/" ? "Dossier Utilisateur (~)" : d.name}
                  </span>
                </button>
              );
            })}

          {/* Custom Folder Button */}
          <button
            onClick={handlePickCustomFolder}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer ${
              customFolderPath
                ? "bg-[#EF4444]/20 border-[#EF4444]/50 text-[#FCA5A5]"
                : "bg-[#202020] hover:bg-[#282828] border-[#2E2E2E] text-[#9B9A97] hover:text-[#EDEDEC]"
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>
              {customFolderPath
                ? customFolderPath.split("/").pop() || "Dossier"
                : "Dossier spécifique…"}
            </span>
          </button>
        </div>

        {/* Scan Options */}
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer">
            <input
              type="checkbox"
              checked={includeSimilarPhotos}
              onChange={(e) => {
                setIncludeSimilarPhotos(e.target.checked);
                resetResults();
              }}
              className="accent-[#EF4444] rounded"
            />
            <span className="flex items-center gap-1">
              <Camera className="w-3.5 h-3.5 text-[#F59E0B]" />
              Photos similaires (dHash)
            </span>
          </label>

          <select
            value={minSizePreset}
            onChange={(e) => {
              setMinSizePreset(Number(e.target.value));
              resetResults();
            }}
            className="px-2.5 py-1 rounded-lg bg-[#202020] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
          >
            <option value={1024 * 512}>Taille &gt; 500 Ko</option>
            <option value={1024 * 1024}>Taille &gt; 1 Mo</option>
            <option value={10 * 1024 * 1024}>Taille &gt; 10 Mo</option>
            <option value={50 * 1024 * 1024}>Taille &gt; 50 Mo</option>
          </select>

          <button
            onClick={handleStartScan}
            disabled={isScanning}
            className="px-3.5 py-1.5 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isScanning ? "animate-spin" : ""}`}
            />
            <span>{isScanning ? "Analyse…" : report ? "Réanalyser" : "Lancer l'analyse"}</span>
          </button>
        </div>
      </div>

      {/* REPORT STATS & FILTER BAR */}
      {report && (
        <div className="px-5 py-2.5 border-b border-[#242424] bg-[#181818] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-[#EDEDEC]">
              {report.totalDuplicateGroups} groupe(s)
            </span>
            <span className="text-[#787774]">•</span>
            <span className="font-mono font-bold text-[#FCA5A5]">
              {formatBytes(report.totalWastedBytes)} gaspillés
            </span>
            <span className="text-[#787774]">•</span>
            <span className="text-[11px] font-mono text-[#787774]">
              {report.totalScannedFiles} fichiers analysés en {report.scanDurationMs} ms
            </span>
          </div>

          {/* Quick Selection Strategy Pills */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[#787774] text-[11px] mr-1">Sélection :</span>
            <button
              onClick={() => applySelectionStrategy("default")}
              className="px-2.5 py-0.5 rounded-lg bg-[#242424] hover:bg-[#2E2E2E] border border-[#333333] text-[11px] text-[#EDEDEC] cursor-pointer"
            >
              Auto (Recommandé)
            </button>
            <button
              onClick={() => applySelectionStrategy("newest")}
              className="px-2.5 py-0.5 rounded-lg bg-[#242424] hover:bg-[#2E2E2E] border border-[#333333] text-[11px] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
            >
              Garder le plus récent
            </button>
            <button
              onClick={() => applySelectionStrategy("oldest")}
              className="px-2.5 py-0.5 rounded-lg bg-[#242424] hover:bg-[#2E2E2E] border border-[#333333] text-[11px] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
            >
              Garder le plus ancien
            </button>
            <button
              onClick={() => applySelectionStrategy("none")}
              className="px-2.5 py-0.5 rounded-lg bg-[#242424] hover:bg-[#2E2E2E] border border-[#333333] text-[11px] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
            >
              Désélectionner
            </button>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="px-5 py-2 border-b border-[#252525] bg-[#161616] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-[#121212] p-0.5 rounded-lg border border-[#282828]">
          <button
            onClick={() => setFilterType("all")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filterType === "all"
                ? "bg-[#252525] text-[#EDEDEC]"
                : "text-[#9B9A97] hover:text-[#EDEDEC]"
            }`}
          >
            Tous ({groups.length})
          </button>
          <button
            onClick={() => setFilterType("exact")}
            className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              filterType === "exact"
                ? "bg-[#252525] text-[#EDEDEC]"
                : "text-[#9B9A97] hover:text-[#EDEDEC]"
            }`}
          >
            <Copy className="w-3.5 h-3.5 text-[#10B981]" />
            <span>
              Doublons exacts ({groups.filter((g) => g.matchType === "exact").length})
            </span>
          </button>
          <button
            onClick={() => setFilterType("similar")}
            className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
              filterType === "similar"
                ? "bg-[#252525] text-[#EDEDEC]"
                : "text-[#9B9A97] hover:text-[#EDEDEC]"
            }`}
          >
            <Camera className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>
              Photos similaires ({groups.filter((g) => g.matchType !== "exact").length})
            </span>
          </button>
        </div>
      </div>

      {/* TRUNCATION WARNING */}
      {report?.truncated && (
        <div className="mx-5 mt-3 px-4 py-2.5 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#FCD34D] flex items-center gap-2.5 shrink-0">
          <AlertTriangle className="w-4 h-4 text-[#F59E0B] shrink-0" />
          <span>
            Analyse plafonnée pour préserver les performances : affichage des 300 groupes les plus volumineux. Sélectionnez un dossier précis pour un scan complet.
          </span>
        </div>
      )}

      {/* MAIN DUPLICATE GROUPS LIST */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {isScanning ? (
          <ScanningRadar
            icon={<Copy className="w-8 h-8 text-[#F59E0B]" />}
            title="Détection des doublons &amp; photos similaires…"
            subtitle={`Analyse sur : ${activeTargetLabel}`}
            color="amber"
            stages={[
              "Filtrage ultra-rapide par taille de fichiers...",
              "Calcul d'empreintes XXH3 à débit mémoire (10 Go/s)...",
              "Analyse perceptuelle dHash pour photos similaires...",
              "Regroupement et calcul des gigaoctets gaspillés...",
            ]}
          />
        ) : !report ? (
          <div className="max-w-xl mx-auto my-10 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-6 space-y-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/30 flex items-center justify-center shrink-0">
                <Copy className="w-5 h-5 text-[#F59E0B]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Recherche de doublons manuelle et sécurisée
                </h3>
                <p className="text-xs text-[#9B9A97] mt-1">
                  Cible sélectionnée :{" "}
                  <span className="font-mono text-[#EDEDEC]">{activeTargetLabel}</span>
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#161616] border border-[#2C2C2C] flex items-start gap-2.5 text-xs text-[#9B9A97]">
              <ShieldAlert className="w-4 h-4 text-[#10B981] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-[#EDEDEC] font-medium">
                  Protection macOS active — Aucun fichier sélectionné par défaut
                </p>
                <p className="text-[11px] leading-relaxed">
                  Les fichiers système macOS, <span className="font-mono">~/Library</span>, les paquets{" "}
                  <span className="font-mono">.app</span>, photothèques et fichiers iCloud évincés sont automatiquement exclus. Par défaut, les suppressions passent par la Corbeille ; la suppression définitive est irréversible.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                onClick={handleStartScan}
                className="px-4 py-2.5 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-xs flex items-center gap-2 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Lancer la recherche de doublons</span>
              </button>
              <button
                onClick={handlePickCustomFolder}
                className="px-4 py-2.5 rounded-xl bg-[#262626] hover:bg-[#303030] border border-[#383838] text-xs font-medium text-[#EDEDEC] flex items-center gap-2 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>Choisir un dossier précis (recommandé)</span>
              </button>
            </div>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="py-20 text-center space-y-2">
            <div className="w-10 h-10 rounded-2xl bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center mx-auto">
              <Check className="w-5 h-5 text-[#34D399]" />
            </div>
            <h3 className="text-sm font-semibold text-[#EDEDEC]">
              Aucun doublon trouvé
            </h3>
            <p className="text-xs text-[#787774] max-w-sm mx-auto">
              Ce dossier ou support est sain et ne contient pas de fichiers en double au-dessus du seuil de taille sélectionné.
            </p>
          </div>
        ) : (
          filteredGroups.map((group) => {
            const isExact = group.matchType === "exact";
            const allInGroupSelected = groupsWithAllSelectedIds.has(group.groupId);
            return (
              <div
                key={group.groupId}
                className={`bg-[#202020] border rounded-2xl overflow-hidden ${
                  allInGroupSelected ? "border-[#F59E0B]/60" : "border-[#2D2D2D]"
                }`}
              >
                {/* Group Header */}
                <div className="px-4 py-2.5 bg-[#1B1B1B] border-b border-[#282828] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 ${
                        isExact
                          ? "bg-[#10B981]/15 border border-[#10B981]/30 text-[#34D399]"
                          : "bg-[#F59E0B]/15 border border-[#F59E0B]/30 text-[#FBBF24]"
                      }`}
                    >
                      {isExact ? (
                        <Copy className="w-3 h-3" />
                      ) : (
                        <Camera className="w-3 h-3" />
                      )}
                      <span>{group.similarityLabel}</span>
                    </span>

                    {allInGroupSelected && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-[#FCD34D] flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-[#F59E0B]" />
                        <span>Attention : tous les exemplaires sélectionnés</span>
                      </span>
                    )}

                    <span className="text-xs text-[#9B9A97]">
                      {group.files.length} fichiers • Taille :{" "}
                      <strong className="text-[#EDEDEC] font-mono">
                        {formatBytes(group.sharedSizeBytes)}
                      </strong>
                    </span>
                  </div>

                  <span className="text-xs font-mono font-bold text-[#FCA5A5]">
                    +{formatBytes(group.wastedBytes)} récupérables
                  </span>
                </div>

                {/* File Items in Group */}
                <div className="divide-y divide-[#262626]">
                  {group.files.map((file) => (
                    <div
                      key={file.path}
                      onClick={() =>
                        toggleFileDeletion(group.groupId, file.path)
                      }
                      className={`px-4 py-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                        file.isMarkedForDeletion
                          ? "bg-[#241A1A]/70 hover:bg-[#2A1E1E]"
                          : "hover:bg-[#242424]"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {/* Checkbox */}
                        <div className="shrink-0 text-[#9B9A97]">
                          {file.isMarkedForDeletion ? (
                            <CheckSquare className="w-4 h-4 text-[#EF4444]" />
                          ) : (
                            <Square className="w-4 h-4 text-[#555555]" />
                          )}
                        </div>

                        {/* File icon & names */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-[#EDEDEC] truncate">
                              {file.name}
                            </span>

                            {file.isSuggestedOriginal ? (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#10B981]/15 text-[#34D399] font-medium shrink-0">
                                Original conseillé
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#EF4444]/15 text-[#FCA5A5] font-medium shrink-0">
                                Doublon
                              </span>
                            )}
                          </div>

                          <p className="text-[10px] font-mono text-[#787774] truncate mt-0.5">
                            {file.path}
                          </p>
                        </div>
                      </div>

                      {/* Right metadata & Finder reveal */}
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs font-mono text-[#9B9A97]">
                          {formatBytes(file.sizeBytes)}
                        </span>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRevealFinder(file.path);
                          }}
                          className="p-1.5 rounded-lg bg-[#181818] hover:bg-[#2C2C2C] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
                          title="Révéler dans le Finder"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* BOTTOM STICKY ACTION BAR */}
      {selectedForDeletion.length > 0 && (
        <div className="px-5 py-3 border-t border-[#382323] bg-[#1D1616] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-[#EF4444]/20 border border-[#EF4444]/40 flex items-center justify-center shrink-0">
              <Trash2 className="w-4 h-4 text-[#EF4444]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#EDEDEC]">
                  {selectedForDeletion.length} fichier(s) sélectionné(s)
                </span>
                <span className="text-xs font-mono font-bold text-[#FCA5A5]">
                  • {formatBytes(totalSelectedBytes)} à récupérer
                </span>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-[#9B9A97] cursor-pointer mt-0.5">
                <input
                  type="checkbox"
                  checked={moveToTrash}
                  onChange={(e) => {
                    setMoveToTrash(e.target.checked);
                    setConfirmIrreversible(false);
                  }}
                  className="accent-[#10B981] rounded"
                />
                <span>Déplacer dans la Corbeille (récupérable)</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => applySelectionStrategy("none")}
              className="px-3 py-1.5 rounded-lg bg-[#282020] hover:bg-[#332727] text-xs text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
            >
              Annuler sélection
            </button>
            <button
              onClick={openConfirmPurgeModal}
              className="px-4 py-1.5 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Nettoyer ({formatBytes(totalSelectedBytes)})</span>
            </button>
          </div>
        </div>
      )}

      {/* CONFIRM PURGE MODAL */}
      {confirmPurgeModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-[#EF4444]" />
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Confirmer le nettoyage des doublons
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
              {moveToTrash ? (
                <div className="p-3 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 text-xs text-[#34D399] flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>
                    Déplacement vers la Corbeille macOS — fichiers récupérables ultérieurement.
                  </span>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-[#EF4444]/15 border border-[#EF4444]/40 text-xs text-[#FCA5A5] space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-[#EF4444]">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>ACTION IRRÉVERSIBLE — Suppression définitive sans passer par la Corbeille</span>
                  </div>
                  <p className="text-[11px] text-[#FCA5A5]/90">
                    Les fichiers supprimés définitivement ne pourront pas être restaurés depuis la Corbeille.
                  </p>
                </div>
              )}

              {groupsWithAllSelectedIds.size > 0 && (
                <div className="p-3 rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-xs text-[#FCD34D] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
                  <span>
                    Attention : tous les exemplaires de{" "}
                    <strong>{groupsWithAllSelectedIds.size} groupe(s)</strong> sont sélectionnés — aucune copie ne sera conservée.
                  </span>
                </div>
              )}

              <p className="text-xs text-[#9B9A97]">
                Vous allez {moveToTrash ? "déplacer dans la Corbeille" : "supprimer définitivement"}{" "}
                <strong className="text-[#EDEDEC]">
                  {selectedForDeletion.length} doublon(s)
                </strong>{" "}
                pour libérer{" "}
                <strong className="text-[#FCA5A5] font-mono">
                  {formatBytes(totalSelectedBytes)}
                </strong>
                .
              </p>

              <div className="max-h-40 overflow-y-auto space-y-1 p-2.5 rounded-xl bg-[#161616] border border-[#282828]">
                {selectedForDeletion.slice(0, 10).map((f) => (
                  <div
                    key={f.path}
                    className="text-[11px] font-mono text-[#EDEDEC] truncate"
                    title={f.path}
                  >
                    {f.path}
                  </div>
                ))}
                {selectedForDeletion.length > 10 && (
                  <div className="text-[10px] text-[#787774] pt-1">
                    … et {selectedForDeletion.length - 10} autre(s) fichier(s)
                  </div>
                )}
              </div>

              {!moveToTrash && (
                <label className="flex items-center gap-2 text-xs text-[#EDEDEC] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmIrreversible}
                    onChange={(e) => setConfirmIrreversible(e.target.checked)}
                    className="accent-[#EF4444]"
                  />
                  <span>
                    Je comprends que cette suppression est définitive et irréversible
                  </span>
                </label>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  onClick={() => setConfirmPurgeModal(false)}
                  className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handleExecutePurge}
                  disabled={isPurging || (!moveToTrash && !confirmIrreversible)}
                  className="px-4 py-2 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>
                    {isPurging
                      ? "Nettoyage en cours…"
                      : `Nettoyer maintenant (${formatBytes(totalSelectedBytes)})`}
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

