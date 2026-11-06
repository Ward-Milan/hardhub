import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sparkles,
  Trash2,
  Check,
  RefreshCw,
  History,
  HardDrive,
  Code2,
} from "lucide-react";
import ScanningRadar from "./ScanningRadar";
import type {
  GhostPurgeReport,
  GhostScanReport,
  SnapshotReport,
  StorageDriveInfo,
  SystemGhostReport,
  SystemGhostPurgeReport,
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

interface Props {
  drives: StorageDriveInfo[];
  onShowToast: (msg: string) => void;
  onShowError: (err: string) => void;
  onRefreshDrives: () => void;
}

export default function CleanerPurgeView({
  drives,
  onShowToast,
  onShowError,
  onRefreshDrives,
}: Props) {
  const [selectedMountPoint, setSelectedMountPoint] = useState<string>("/");

  // Ghost & Cache Cleaner state
  const [ghostReport, setGhostReport] = useState<GhostScanReport | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    "apple_double",
    "trashes",
    "media_caches",
  ]);
  const [isScanningGhost, setIsScanningGhost] = useState(false);
  const [isPurgingGhost, setIsPurgingGhost] = useState(false);

  // System Ghost Cleaner State (Xcode, Packagers, Logs)
  const [systemGhostReport, setSystemGhostReport] =
    useState<SystemGhostReport | null>(null);
  const [selectedGhostIds, setSelectedGhostIds] = useState<string[]>([]);
  const [isScanningSystemGhost, setIsScanningSystemGhost] = useState(false);
  const [isPurgingSystemGhost, setIsPurgingSystemGhost] = useState(false);
  const [systemGhostTab, setSystemGhostTab] = useState<
    "all" | "developer" | "package_manager" | "logs"
  >("all");

  // APFS Snapshots state
  const [snapshotReport, setSnapshotReport] = useState<SnapshotReport | null>(null);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [isPurgingSnapshots, setIsPurgingSnapshots] = useState(false);

  const filteredGhostItems = useMemo(() => {
    if (!systemGhostReport) return [];
    if (systemGhostTab === "all") return systemGhostReport.items;
    return systemGhostReport.items.filter((i) => i.category === systemGhostTab);
  }, [systemGhostReport, systemGhostTab]);

  const totalSelectedGhostBytes = useMemo(() => {
    if (!systemGhostReport) return 0;
    return systemGhostReport.items
      .filter((i) => selectedGhostIds.includes(i.id))
      .reduce((acc, curr) => acc + curr.sizeBytes, 0);
  }, [systemGhostReport, selectedGhostIds]);

  const handleScanGhost = async (targetPath: string) => {
    setIsScanningGhost(true);
    try {
      const rep = await invoke<GhostScanReport>("scan_ghost_cleaner", {
        targetPath,
      });
      setGhostReport(rep);
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsScanningGhost(false);
    }
  };

  const handleScanSystemGhost = async () => {
    setIsScanningSystemGhost(true);
    try {
      const rep = await invoke<SystemGhostReport>("scan_system_ghost_cmd");
      setSystemGhostReport(rep);
      setSelectedGhostIds(rep.items.map((i) => i.id));
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsScanningSystemGhost(false);
    }
  };

  const handlePurgeSystemGhost = async () => {
    if (selectedGhostIds.length === 0) return;
    setIsPurgingSystemGhost(true);
    try {
      const rep = await invoke<SystemGhostPurgeReport>(
        "purge_system_ghost_cmd",
        { ids: selectedGhostIds }
      );
      onShowToast(
        `Espace fantôme système libéré avec succès : ${formatBytes(
          rep.freedBytes
        )}`
      );
      await handleScanSystemGhost();
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsPurgingSystemGhost(false);
    }
  };

  const handlePurgeGhost = async () => {
    if (selectedCategories.length === 0) return;
    setIsPurgingGhost(true);
    try {
      const res = await invoke<GhostPurgeReport>("purge_ghost_cleaner", {
        targetPath: selectedMountPoint,
        selectedCategories,
      });
      onShowToast(
        `${res.deletedItems} élément(s) nettoyé(s) (${formatBytes(
          res.freedBytes
        )} libérés)`
      );
      await handleScanGhost(selectedMountPoint);
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsPurgingGhost(false);
    }
  };

  const handleScanSnapshots = async (mountPoint: string) => {
    setIsLoadingSnapshots(true);
    try {
      const rep = await invoke<SnapshotReport>("list_volume_snapshots_cmd", {
        mountPoint,
      });
      setSnapshotReport(rep);
    } catch (err) {
      console.warn("Could not list snapshots", err);
      setSnapshotReport(null);
    } finally {
      setIsLoadingSnapshots(false);
    }
  };

  const handleDeleteSnapshot = async (name: string, uuid: string) => {
    try {
      await invoke("delete_single_snapshot_cmd", {
        mountPoint: selectedMountPoint,
        snapshotName: name,
        snapshotUuid: uuid,
      });
      onShowToast(`Instantané ${name} purgé.`);
      await handleScanSnapshots(selectedMountPoint);
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    }
  };

  const handlePurgeAllSnapshots = async () => {
    setIsPurgingSnapshots(true);
    try {
      const res = await invoke<number>("thin_and_purge_all_snapshots_cmd", {
        mountPoint: selectedMountPoint,
      });
      onShowToast(
        `Snapshots purgés : ${res} instantané(s) système Time Machine supprimé(s).`
      );
      await handleScanSnapshots(selectedMountPoint);
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsPurgingSnapshots(false);
    }
  };

  const toggleGhostCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const selectedPurgeBytes = useMemo(() => {
    if (!ghostReport) return 0;
    return ghostReport.categories
      .filter((c) => selectedCategories.includes(c.id))
      .reduce((acc, c) => acc + c.totalBytes, 0);
  }, [ghostReport, selectedCategories]);

  const selectedPurgeCount = useMemo(() => {
    if (!ghostReport) return 0;
    return ghostReport.categories
      .filter((c) => selectedCategories.includes(c.id))
      .reduce((acc, c) => acc + c.itemCount, 0);
  }, [ghostReport, selectedCategories]);

  // Initial load once on mount
  useEffect(() => {
    handleScanGhost(selectedMountPoint);
    handleScanSnapshots(selectedMountPoint);
    handleScanSystemGhost();
  }, [selectedMountPoint]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 space-y-6 bg-[#191919]">
      {/* ================= TARGET DRIVE SELECTOR ================= */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#282828]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#9B9A97] mr-1">
            Support cible :
          </span>
          {drives
            .filter((d) => !d.isCloud)
            .map((d) => {
              const active = selectedMountPoint === d.mountPoint;
              return (
                <button
                  key={d.id}
                  onClick={() => setSelectedMountPoint(d.mountPoint)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-2 border transition-colors cursor-pointer ${
                    active
                      ? "bg-[#10B981]/20 border-[#10B981]/50 text-[#34D399]"
                      : "bg-[#202020] hover:bg-[#282828] border-[#2E2E2E] text-[#EDEDEC]"
                  }`}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>
                    {d.mountPoint === "/" ? `${d.name} (Système Mac)` : d.name}
                  </span>
                </button>
              );
            })}
        </div>

        <button
          onClick={() => {
            handleScanGhost(selectedMountPoint);
            handleScanSnapshots(selectedMountPoint);
            handleScanSystemGhost();
          }}
          disabled={isScanningGhost || isLoadingSnapshots || isScanningSystemGhost}
          className="px-3 py-1.5 rounded-xl bg-[#222222] hover:bg-[#2B2B2B] border border-[#323232] text-xs text-[#9B9A97] hover:text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              isScanningGhost || isLoadingSnapshots || isScanningSystemGhost
                ? "animate-spin text-[#10B981]"
                : ""
            }`}
          />
          <span>Réanalyser</span>
        </button>
      </div>

      {/* ================= CARDS CONTAINER ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* CARD 0 (12 cols): NETTOYEUR ESPACE FANTÔME SYSTÈME */}
        <div className="lg:col-span-12 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#6366F1]/15 border border-[#6366F1]/30 flex items-center justify-center text-[#818CF8]">
                  <Code2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    Espace Fantôme Système (Xcode, Paquets &amp; Logs)
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    Récupère l&apos;espace gaspillé par les recompilations Xcode, simulateurs iOS, caches npm/Gradle et journaux
                  </p>
                </div>
              </div>

              {systemGhostReport && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-[#161616] border border-[#2C2C2C] text-[#818CF8]">
                    {formatBytes(systemGhostReport.totalBytes)} récupérables
                  </span>
                </div>
              )}
            </div>

            {/* Category tabs */}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-b border-[#292929] pb-3">
              {[
                { id: "all", label: "Tous" },
                { id: "developer", label: "Xcode & Développeur" },
                { id: "package_manager", label: "Gestionnaires de Paquets" },
                { id: "logs", label: "Journaux & Crashs" },
              ].map((tab) => {
                const count =
                  tab.id === "all"
                    ? systemGhostReport?.items.length || 0
                    : systemGhostReport?.items.filter((i) => i.category === tab.id).length || 0;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setSystemGhostTab(tab.id as any)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                      systemGhostTab === tab.id
                        ? "bg-[#6366F1]/20 border border-[#6366F1]/40 text-[#818CF8]"
                        : "bg-[#181818] hover:bg-[#222222] border border-[#2A2A2A] text-[#9B9A97]"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className="text-[10px] opacity-75 font-mono">({count})</span>
                  </button>
                );
              })}
            </div>

            {/* Items list */}
            {isScanningSystemGhost ? (
              <ScanningRadar
                icon={<Code2 className="w-8 h-8 text-[#818CF8]" />}
                title="Analyse de l'espace fantome systeme..."
                color="purple"
                stages={[
                  "Exploration des caches de build Xcode (DerivedData, Archives)...",
                  "Analyse des simulateurs iOS et runtimes orphelins...",
                  "Scan des gestionnaires de paquets (Homebrew, npm, CocoaPods)...",
                  "Identification des journaux et caches macOS volumineux...",
                ]}
              />
            ) : filteredGhostItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#787774]">
                Aucun cache fantôme détecté dans cette catégorie. Votre système est déjà propre.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {filteredGhostItems.map((item) => {
                  const checked = selectedGhostIds.includes(item.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => {
                        setSelectedGhostIds((prev) =>
                          checked ? prev.filter((id) => id !== item.id) : [...prev, item.id]
                        );
                      }}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                        checked
                          ? "bg-[#1A1A2E] border-[#6366F1]/40"
                          : "bg-[#181818] border-[#292929]"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                            checked
                              ? "bg-[#6366F1] border-[#6366F1] text-white"
                              : "border-[#454545] bg-[#121212]"
                          }`}
                        >
                          {checked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-[#EDEDEC] truncate">
                              {item.name}
                            </span>
                            <span className="text-[10px] font-mono text-[#787774] truncate">
                              {item.itemCount} fichier(s)
                            </span>
                          </div>
                          <p className="text-[11px] text-[#9B9A97] truncate">
                            {item.description}
                          </p>
                          <p className="text-[10px] font-mono text-[#555555] truncate">
                            {item.path}
                          </p>
                        </div>
                      </div>

                      <span className="font-mono text-xs font-semibold text-[#818CF8] shrink-0">
                        {formatBytes(item.sizeBytes)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="pt-3 border-t border-[#292929] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setSelectedGhostIds(
                    systemGhostReport ? systemGhostReport.items.map((i) => i.id) : []
                  )
                }
                className="text-[11px] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
              >
                Tout cocher
              </button>
              <span className="text-[#3E3E3E]">•</span>
              <button
                onClick={() => setSelectedGhostIds([])}
                className="text-[11px] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
              >
                Tout décocher
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-[#9B9A97]">
                {selectedGhostIds.length} sélectionné(s) ({formatBytes(totalSelectedGhostBytes)})
              </span>

              <button
                onClick={handlePurgeSystemGhost}
                disabled={isPurgingSystemGhost || selectedGhostIds.length === 0}
                className="px-4 py-2 rounded-xl bg-[#6366F1] hover:bg-[#4F46E5] disabled:opacity-40 text-white font-semibold text-xs flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-[#6366F1]/10"
              >
                <Trash2
                  className={`w-3.5 h-3.5 ${isPurgingSystemGhost ? "animate-spin" : ""}`}
                />
                <span>
                  {isPurgingSystemGhost
                    ? "Purge en cours…"
                    : `Purger (${formatBytes(totalSelectedGhostBytes)})`}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* CARD 1 (6 cols): GHOST & MEDIA CACHE CLEANER */}
        <div className="lg:col-span-6 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-[#34D399]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    Nettoyeur Fantômes macOS &amp; Caches
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    Élimine les fichiers invisibles ._* / .DS_Store, .Trashes et caches médias
                  </p>
                </div>
              </div>

              {ghostReport && (
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-[#161616] border border-[#2C2C2C] text-[#34D399]">
                  {formatBytes(ghostReport.totalReclaimableBytes)} détectés
                </span>
              )}
            </div>

            {isScanningGhost ? (
              <ScanningRadar
                icon={<Trash2 className="w-8 h-8 text-[#10B981]" />}
                title="Inspection des fichiers invisibles et corbeilles..."
                color="emerald"
                stages={[
                  "Detection des fichiers fantomes Apple Double (._*)...",
                  "Inspection des corbeilles distantes .Trashes...",
                  "Calcul des blocs recuperables sur le support...",
                ]}
              />
            ) : !ghostReport ? null : (
              <div className="space-y-2">
                {ghostReport.categories.map((cat) => {
                  const checked = selectedCategories.includes(cat.id);
                  return (
                    <div
                      key={cat.id}
                      onClick={() => toggleGhostCategory(cat.id)}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                        checked
                          ? "bg-[#19231E] border-[#10B981]/40"
                          : "bg-[#181818] border-[#292929]"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                            checked
                              ? "bg-[#10B981] border-[#10B981] text-black"
                              : "border-[#454545] bg-[#121212]"
                          }`}
                        >
                          {checked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#EDEDEC]">
                              {cat.label}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#262626] text-[#9B9A97]">
                              {cat.itemCount} élément(s)
                            </span>
                          </div>
                          <p className="text-[11px] text-[#787774] mt-0.5">
                            {cat.description}
                          </p>
                        </div>
                      </div>

                      <span className="text-xs font-mono font-semibold text-[#EDEDEC] shrink-0">
                        {formatBytes(cat.totalBytes)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[#2A2A2A] flex items-center justify-between gap-3">
            <span className="text-xs text-[#9B9A97]">
              Sélection :{" "}
              <strong className="text-[#EDEDEC] font-mono">
                {selectedPurgeCount} élément(s) ({formatBytes(selectedPurgeBytes)})
              </strong>
            </span>

            <button
              onClick={handlePurgeGhost}
              disabled={isPurgingGhost || selectedPurgeCount === 0}
              className="px-4 py-2 rounded-xl bg-[#10B981] hover:bg-[#059669] disabled:opacity-40 text-black font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>
                {isPurgingGhost
                  ? "Nettoyage…"
                  : `Purger (${formatBytes(selectedPurgeBytes)})`}
              </span>
            </button>
          </div>
        </div>

        {/* CARD 2 (6 cols): APFS SNAPSHOTS & TIME MACHINE RECLAIMER */}
        <div className="lg:col-span-6 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#8B5CF6]/15 border border-[#8B5CF6]/30 flex items-center justify-center">
                  <History className="w-4 h-4 text-[#A78BFA]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    Instantanés APFS &amp; Purge Système
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    Libère les gigaoctets gelés par Time Machine et l&apos;OS
                  </p>
                </div>
              </div>

              {snapshotReport && (
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-[#161616] border border-[#2C2C2C] text-[#A78BFA]">
                  {snapshotReport.purgeableSnapshots} purgeable(s)
                </span>
              )}
            </div>

            {isLoadingSnapshots ? (
              <div className="py-12 text-center text-xs text-[#9B9A97]">
                Inspection des instantanés APFS…
              </div>
            ) : !snapshotReport || snapshotReport.snapshots.length === 0 ? (
              <div className="p-6 rounded-xl bg-[#171717] border border-[#262626] text-center space-y-1.5">
                <p className="text-xs font-semibold text-[#EDEDEC]">
                  Aucun instantané Time Machine actif
                </p>
                <p className="text-[11px] text-[#787774] max-w-xs mx-auto">
                  Aucun snapshot local ne bloque l&apos;espace système sur ce volume.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {snapshotReport.snapshots.map((s) => (
                  <div
                    key={s.uuid || s.name}
                    className="p-3 rounded-xl bg-[#181818] border border-[#292929] flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#EDEDEC] truncate">
                          {s.dateLabel}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                            s.isSystemRoot
                              ? "bg-[#3B82F6]/15 text-[#60A5FA]"
                              : "bg-[#F59E0B]/15 text-[#FBBF24]"
                          }`}
                        >
                          {s.isSystemRoot ? "Scellé Système" : "Time Machine"}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-[#787774] truncate mt-0.5">
                        {s.name}
                      </p>
                    </div>

                    {s.isPurgeable && (
                      <button
                        onClick={() => handleDeleteSnapshot(s.name, s.uuid)}
                        className="p-1.5 rounded-lg bg-[#141414] hover:bg-[#282828] text-[#787774] hover:text-[#EF4444] cursor-pointer shrink-0"
                        title="Purger cet instantané"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-[#2A2A2A] flex items-center justify-between gap-3">
            <span className="text-xs text-[#9B9A97]">
              Réclame immédiatement les blocs disque gelés
            </span>

            <button
              onClick={handlePurgeAllSnapshots}
              disabled={isPurgingSnapshots || (snapshotReport?.purgeableSnapshots === 0)}
              className="px-4 py-2 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-40 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <History className="w-3.5 h-3.5" />
              <span>
                {isPurgingSnapshots
                  ? "Purge en cours…"
                  : "Forcer la purge système"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
