import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FolderArchive,
  Search,
  RefreshCw,
  Trash2,
  ExternalLink,
  Check,
  CheckSquare,
  Square,
  AlertTriangle,
  HardDrive,
  FileText,
  Video,
  Archive,
  Smartphone,
  Disc,
  File,
  X,
  Filter,
} from "lucide-react";
import ScanningRadar from "./ScanningRadar";
import type {
  LargeFileItem,
  LargeFilesPurgeReport,
  LargeFilesReport,
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

function CategoryBadgeIcon({
  category,
  className = "w-4 h-4",
}: {
  category: string;
  className?: string;
}) {
  switch (category) {
    case "installer":
      return <Disc className={`${className} text-[#F59E0B]`} />;
    case "video":
      return <Video className={`${className} text-[#3B82F6]`} />;
    case "archive":
      return <Archive className={`${className} text-[#8B5CF6]`} />;
    case "ios_backup":
      return <Smartphone className={`${className} text-[#10B981]`} />;
    case "disk_image":
      return <HardDrive className={`${className} text-[#EC4899]`} />;
    default:
      return <File className={`${className} text-[#9B9A97]`} />;
  }
}

interface Props {
  drives: StorageDriveInfo[];
  onShowToast: (msg: string) => void;
  onShowError: (err: string) => void;
  onRefreshDrives: () => void;
}

export default function LargeFilesView({
  drives,
  onShowToast,
  onShowError,
  onRefreshDrives,
}: Props) {
  const [selectedMountPoint, setSelectedMountPoint] = useState<string>("/");
  const [minSizeBytes, setMinSizeBytes] = useState<number>(1024 * 1024 * 1024); // 1 GB default
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [ageFilter, setAgeFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [report, setReport] = useState<LargeFilesReport | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [moveToTrash, setMoveToTrash] = useState(true);
  const [confirmPurgeModal, setConfirmPurgeModal] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  const handleScan = async (targetPath: string, minSize: number) => {
    setIsScanning(true);
    setSelectedPaths([]);
    try {
      const rep = await invoke<LargeFilesReport>("scan_large_files_cmd", {
        targetPath,
        minSizeBytes: minSize,
      });
      setReport(rep);
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsScanning(false);
    }
  };

  useEffect(() => {
    handleScan(selectedMountPoint, minSizeBytes);
  }, [selectedMountPoint, minSizeBytes]);

  const filteredItems = useMemo(() => {
    if (!report) return [];
    return report.items.filter((item) => {
      // Category filter
      if (categoryFilter !== "all" && item.category !== categoryFilter) {
        return false;
      }
      // Age filter
      if (ageFilter === "older_than_year" && item.ageCategory !== "older_than_year") {
        return false;
      }
      if (
        ageFilter === "older_than_6m" &&
        item.ageCategory !== "older_than_year" &&
        item.ageCategory !== "older_than_6m"
      ) {
        return false;
      }
      if (
        ageFilter === "older_than_3m" &&
        item.ageCategory === "recent"
      ) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          item.path.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [report, categoryFilter, ageFilter, searchQuery]);

  const toggleSelect = (path: string) => {
    setSelectedPaths((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  const selectAllFiltered = () => {
    if (selectedPaths.length === filteredItems.length) {
      setSelectedPaths([]);
    } else {
      setSelectedPaths(filteredItems.map((i) => i.path));
    }
  };

  const selectedBytes = useMemo(() => {
    if (!report) return 0;
    return report.items
      .filter((i) => selectedPaths.includes(i.path))
      .reduce((acc, i) => acc + i.sizeBytes, 0);
  }, [report, selectedPaths]);

  const handlePurgeSelected = async () => {
    if (selectedPaths.length === 0) return;
    setIsPurging(true);
    try {
      const rep = await invoke<LargeFilesPurgeReport>("purge_large_files_cmd", {
        pathsToDelete: selectedPaths,
        moveToTrash,
      });
      setConfirmPurgeModal(false);
      onShowToast(
        `${rep.deletedCount} fichier(s) nettoyé(s) (${formatBytes(
          rep.freedBytes
        )} libérés)`
      );
      if (rep.errors.length > 0) {
        onShowError(rep.errors[0]);
      }
      await handleScan(selectedMountPoint, minSizeBytes);
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsPurging(false);
    }
  };

  const handleRevealFinder = async (filePath: string) => {
    try {
      await invoke("reveal_in_finder", { path: filePath });
    } catch (err) {
      onShowError(String(err));
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#191919]">
      {/* ================= TOP CONTROLS BAR ================= */}
      <div className="p-5 border-b border-[#282828] bg-[#171717] space-y-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 flex items-center justify-center">
              <FolderArchive className="w-4 h-4 text-[#A78BFA]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#EDEDEC]">
                Gros Fichiers Oubliés
              </h2>
              <p className="text-[11px] text-[#9B9A97]">
                Détecte les installateurs, vidéos et archives volumineux non ouverts depuis des mois
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleScan(selectedMountPoint, minSizeBytes)}
              disabled={isScanning}
              className="px-3 py-1.5 rounded-xl bg-[#222222] hover:bg-[#2B2B2B] border border-[#333333] text-xs text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isScanning ? "animate-spin text-[#8B5CF6]" : ""}`}
              />
              <span>{isScanning ? "Recherche…" : "Réanalyser"}</span>
            </button>
          </div>
        </div>

        {/* Drives & Size presets */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Drive Selector */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[#787774] mr-1">Support :</span>
            {drives
              .filter((d) => !d.isCloud)
              .map((d) => {
                const active = selectedMountPoint === d.mountPoint;
                return (
                  <button
                    key={d.id}
                    onClick={() => setSelectedMountPoint(d.mountPoint)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      active
                        ? "bg-[#8B5CF6]/20 border-[#8B5CF6]/50 text-[#C4B5FD]"
                        : "bg-[#1E1E1E] hover:bg-[#262626] border-[#2C2C2C] text-[#EDEDEC]"
                    }`}
                  >
                    {d.mountPoint === "/" ? "Disque Principal (Mac)" : d.name}
                  </button>
                );
              })}
          </div>

          {/* Size Threshold Pills */}
          <div className="flex items-center p-0.5 rounded-xl bg-[#161616] border border-[#2B2B2B]">
            {[
              { id: 500 * 1024 * 1024, label: "> 500 Mo" },
              { id: 1024 * 1024 * 1024, label: "> 1 Go" },
              { id: 5 * 1024 * 1024 * 1024, label: "> 5 Go" },
            ].map((preset) => (
              <button
                key={preset.id}
                onClick={() => setMinSizeBytes(preset.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  minSizeBytes === preset.id
                    ? "bg-[#252525] text-[#EDEDEC] shadow-sm"
                    : "text-[#787774] hover:text-[#9B9A97]"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filters: Category & Age & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-[#242424]">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Category Filter */}
            {[
              { id: "all", label: "Tous" },
              { id: "installer", label: "Installateurs (.dmg, .pkg)" },
              { id: "video", label: "Vidéos" },
              { id: "archive", label: "Archives (.zip)" },
              { id: "ios_backup", label: "Sauvegardes iOS" },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  categoryFilter === cat.id
                    ? "bg-[#333333] text-[#EDEDEC]"
                    : "text-[#787774] hover:text-[#9B9A97]"
                }`}
              >
                {cat.label}
              </button>
            ))}

            <span className="text-[#353535] px-1">•</span>

            {/* Age Filter */}
            {[
              { id: "all", label: "Tous les âges" },
              { id: "older_than_year", label: "> 1 an" },
              { id: "older_than_6m", label: "> 6 mois" },
              { id: "older_than_3m", label: "> 3 mois" },
            ].map((age) => (
              <button
                key={age.id}
                onClick={() => setAgeFilter(age.id)}
                className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  ageFilter === age.id
                    ? "bg-[#8B5CF6]/20 text-[#C4B5FD] border border-[#8B5CF6]/40"
                    : "text-[#787774] hover:text-[#9B9A97]"
                }`}
              >
                {age.label}
              </button>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative w-48">
            <Search className="w-3.5 h-3.5 text-[#787774] absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrer…"
              className="w-full pl-8 pr-2.5 py-1 rounded-lg bg-[#161616] border border-[#2D2D2D] text-xs text-[#EDEDEC] focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* ================= FILE LIST ================= */}
      <div className="flex-1 overflow-y-auto p-5 space-y-2">
        {isScanning && !report ? (
          <ScanningRadar
            icon={<Archive className="w-8 h-8 text-[#8B5CF6]" />}
            title="Inspection des gros fichiers sur le disque…"
            subtitle={selectedMountPoint ? `Disque cible : ${selectedMountPoint}` : undefined}
            color="purple"
            stages={[
              "Balayage rapide des catalogues de fichiers...",
              "Filtrage des archives et fichiers géants...",
              "Calcul de la date de dernier accès et d'ancienneté...",
              "Classement par impact sur le stockage...",
            ]}
          />
        ) : filteredItems.length === 0 ? (
          <div className="p-8 rounded-2xl bg-[#171717] border border-[#272727] text-center text-xs text-[#787774] space-y-1.5 max-w-md mx-auto my-12">
            <p className="font-semibold text-[#EDEDEC]">
              Aucun fichier correspondant trouvé
            </p>
            <p className="text-[11px]">
              Aucun fichier ne dépasse ce seuil de taille ou ce critère d&apos;âge sur le support sélectionné.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-3 py-1 text-[11px] text-[#787774]">
              <button
                onClick={selectAllFiltered}
                className="hover:text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
              >
                {selectedPaths.length === filteredItems.length ? (
                  <CheckSquare className="w-3.5 h-3.5 text-[#8B5CF6]" />
                ) : (
                  <Square className="w-3.5 h-3.5 text-[#555555]" />
                )}
                <span>
                  {selectedPaths.length === filteredItems.length
                    ? "Tout désélectionner"
                    : "Tout sélectionner"}
                </span>
              </button>
              <span>
                {filteredItems.length} fichier(s) trouvé(s) •{" "}
                {formatBytes(
                  filteredItems.reduce((acc, i) => acc + i.sizeBytes, 0)
                )}
              </span>
            </div>

            {filteredItems.map((item) => {
              const checked = selectedPaths.includes(item.path);
              return (
                <div
                  key={item.path}
                  onClick={() => toggleSelect(item.path)}
                  className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                    checked
                      ? "bg-[#211B2B] border-[#8B5CF6]/50"
                      : "bg-[#181818] hover:bg-[#1E1E1E] border-[#292929]"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="shrink-0 text-[#9B9A97]">
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-[#8B5CF6]" />
                      ) : (
                        <Square className="w-4 h-4 text-[#555555]" />
                      )}
                    </div>

                    <div className="w-8 h-8 rounded-lg bg-[#222222] border border-[#333333] flex items-center justify-center shrink-0">
                      <CategoryBadgeIcon category={item.category} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#EDEDEC] truncate">
                          {item.name}
                        </span>
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded font-medium ${
                            item.ageCategory === "older_than_year"
                              ? "bg-[#EF4444]/15 text-[#F87171]"
                              : item.ageCategory === "older_than_6m"
                              ? "bg-[#F59E0B]/15 text-[#FBBF24]"
                              : "bg-[#252525] text-[#9B9A97]"
                          }`}
                        >
                          {item.ageDays >= 365
                            ? `> 1 an (${item.ageDays} jours)`
                            : item.ageDays >= 180
                            ? `> 6 mois (${item.ageDays} jours)`
                            : `${item.ageDays} jours`}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-[#787774] truncate mt-0.5">
                        {item.path}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono font-semibold text-[#EDEDEC]">
                      {formatBytes(item.sizeBytes)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRevealFinder(item.path);
                      }}
                      title="Afficher dans le Finder"
                      className="p-1.5 rounded-lg bg-[#202020] hover:bg-[#2A2A2A] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ================= BOTTOM ACTION BAR ================= */}
      {selectedPaths.length > 0 && (
        <div className="p-4 border-t border-[#2A2A2A] bg-[#161616] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 text-xs">
            <span className="font-semibold text-[#EDEDEC]">
              {selectedPaths.length} élément(s) sélectionné(s) :
            </span>
            <span className="font-mono text-[#A78BFA] font-bold">
              {formatBytes(selectedBytes)}
            </span>

            <label className="flex items-center gap-2 cursor-pointer ml-4 text-[#9B9A97] hover:text-[#EDEDEC]">
              <input
                type="checkbox"
                checked={moveToTrash}
                onChange={(e) => setMoveToTrash(e.target.checked)}
                className="accent-[#8B5CF6] cursor-pointer"
              />
              <span>Déplacer dans la Corbeille (récupérable)</span>
            </label>
          </div>

          <button
            onClick={() => setConfirmPurgeModal(true)}
            className="px-4 py-2 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Purger {formatBytes(selectedBytes)}</span>
          </button>
        </div>
      )}

      {/* ================= CONFIRM PURGE MODAL ================= */}
      {confirmPurgeModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Confirmer le nettoyage
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
                Vous êtes sur le point de{" "}
                <strong className="text-[#EDEDEC]">
                  {moveToTrash ? "déplacer dans la Corbeille" : "supprimer définitivement"}
                </strong>{" "}
                {selectedPaths.length} gros fichier(s) pour un total de{" "}
                <strong className="text-[#EF4444]">{formatBytes(selectedBytes)}</strong>.
              </p>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmPurgeModal(false)}
                  className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handlePurgeSelected}
                  disabled={isPurging}
                  className="px-4 py-2 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-xs cursor-pointer"
                >
                  {isPurging
                    ? "Nettoyage en cours…"
                    : `Purger (${formatBytes(selectedBytes)})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

