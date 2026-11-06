import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Sparkles,
  Gauge,
  Disc,
  HardDrive,
  RefreshCw,
  Trash2,
  Check,
  AlertTriangle,
  Zap,
  History,
  Plus,
  Split,
  X,
  Lock,
  Layers,
  Cpu,
  ShieldCheck,
  ShieldAlert,
  Activity,
  HeartPulse,
  Thermometer,
  Database,
  CheckCircle2,
  Code2,
  Terminal,
  FileCode,
  Unlock,
} from "lucide-react";
import type {
  AddVolumeRequest,
  ApfsContainerInfo,
  ApfsVolumeItem,
  FlashTestProgress,
  FlashTestResult,
  FormatDriveResult,
  GhostPurgeReport,
  GhostScanReport,
  PartitionActionResult,
  SnapshotPurgeResult,
  SnapshotReport,
  SpeedTestResult,
  SplitPartitionRequest,
  SsdHealthReport,
  StorageDriveInfo,
  SystemGhostItem,
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

export default function ToolsView({
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

  // APFS Volume Encryption Modal inside ToolsView
  const [encryptVolumeTarget, setEncryptVolumeTarget] =
    useState<ApfsVolumeItem | null>(null);
  const [volumePassphrase, setVolumePassphrase] = useState<string>("");
  const [volumeConfirmPassphrase, setVolumeConfirmPassphrase] =
    useState<string>("");
  const [isEncryptingVolume, setIsEncryptingVolume] = useState<boolean>(false);

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

  // SpeedTest state
  const [speedResult, setSpeedResult] = useState<SpeedTestResult | null>(null);
  const [isRunningSpeed, setIsRunningSpeed] = useState(false);

  // APFS Snapshots state
  const [snapshotReport, setSnapshotReport] =
    useState<SnapshotReport | null>(null);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [isPurgingSnapshots, setIsPurgingSnapshots] = useState(false);

  // 1-Click Formatter state
  const externalRemovableDrives = useMemo(
    () => drives.filter((d) => d.isRemovable && !d.isCloud && d.mountPoint !== "/"),
    [drives]
  );
  const [formatTargetId, setFormatTargetId] = useState<string>("");
  const [formatFs, setFormatFs] = useState<"ExFAT" | "APFS" | "FAT32">("ExFAT");
  const [formatVolumeName, setFormatVolumeName] = useState<string>("UNTITLED");
  const [confirmFormatModal, setConfirmFormatModal] = useState(false);
  const [isFormatting, setIsFormatting] = useState(false);

  // APFS Containers & Partitioning state
  const [apfsContainers, setApfsContainers] = useState<ApfsContainerInfo[]>([]);
  const [selectedContainerId, setSelectedContainerId] = useState<string>("");
  const [partitionTab, setPartitionTab] = useState<
    "apfs_volume" | "format_single" | "hybrid_split"
  >("apfs_volume");
  const [newApfsVolumeName, setNewApfsVolumeName] =
    useState<string>("MonVolume");
  const [newApfsRole, setNewApfsRole] = useState<"standard" | "backup">(
    "standard"
  );
  const [newApfsQuotaGb, setNewApfsQuotaGb] = useState<number>(0);
  const [isAddingVolume, setIsAddingVolume] = useState(false);
  const [hybridSplitPct, setHybridSplitPct] = useState<number>(50);
  const [hybridName1, setHybridName1] = useState<string>("Mac_APFS");
  const [hybridName2, setHybridName2] = useState<string>("PC_ExFAT");
  const [isSplitting, setIsSplitting] = useState(false);
  const [confirmSplitModal, setConfirmSplitModal] = useState(false);

  // Flash Authenticity Test state
  const [flashTargetId, setFlashTargetId] = useState<string>("");
  const [flashTestMb, setFlashTestMb] = useState<number>(1024);
  const [flashProgress, setFlashProgress] = useState<FlashTestProgress | null>(null);
  const [flashResult, setFlashResult] = useState<FlashTestResult | null>(null);
  const [isRunningFlashTest, setIsRunningFlashTest] = useState(false);

  // SSD Health state
  const [ssdHealth, setSsdHealth] = useState<SsdHealthReport | null>(null);
  const [isLoadingHealth, setIsLoadingHealth] = useState(false);

  const handleLoadSsdHealth = async (mountOrBsd: string) => {
    setIsLoadingHealth(true);
    try {
      const matched = drives.find(
        (d) => d.mountPoint === mountOrBsd || d.bsdName === mountOrBsd
      );
      const bsd = matched?.bsdName || mountOrBsd || "disk0";
      const rep = await invoke<SsdHealthReport>("get_ssd_health_cmd", {
        bsdName: bsd,
      });
      setSsdHealth(rep);
    } catch (err) {
      console.warn("Could not load SSD health report", err);
    } finally {
      setIsLoadingHealth(false);
    }
  };

  useEffect(() => {
    handleLoadSsdHealth(selectedMountPoint);
  }, [selectedMountPoint, drives]);

  useEffect(() => {
    handleScanSystemGhost();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<FlashTestProgress>("flash_test_progress", (event) => {
      setFlashProgress(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const loadApfsContainers = async () => {
    try {
      const list = await invoke<ApfsContainerInfo[]>(
        "list_apfs_containers_cmd"
      );
      setApfsContainers(list);
      if (!selectedContainerId && list.length > 0) {
        setSelectedContainerId(list[0].containerId);
      }
    } catch (err) {
      console.warn("Could not load APFS containers", err);
    }
  };

  useEffect(() => {
    loadApfsContainers();
  }, [drives]);

  useEffect(() => {
    if (externalRemovableDrives.length > 0 && !formatTargetId) {
      setFormatTargetId(externalRemovableDrives[0].id);
      setFormatVolumeName(externalRemovableDrives[0].name.slice(0, 20));
    }
  }, [externalRemovableDrives]);

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
        {
          ids: selectedGhostIds,
        }
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

  const handleExecuteVolumeEncryption = async () => {
    if (!encryptVolumeTarget) return;
    if (volumePassphrase.length < 4) {
      onShowError("Le mot de passe doit comporter au moins 4 caractères.");
      return;
    }
    if (volumePassphrase !== volumeConfirmPassphrase) {
      onShowError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setIsEncryptingVolume(true);
    try {
      const res = await invoke<PartitionActionResult>(
        "encrypt_external_volume_cmd",
        {
          bsdName: encryptVolumeTarget.bsdName,
          passphrase: volumePassphrase,
        }
      );
      onShowToast(res.message);
      setEncryptVolumeTarget(null);
      setVolumePassphrase("");
      setVolumeConfirmPassphrase("");
      await loadApfsContainers();
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsEncryptingVolume(false);
    }
  };

  const handleScanSnapshots = async (targetPath: string) => {
    setIsLoadingSnapshots(true);
    try {
      const rep = await invoke<SnapshotReport>("list_volume_snapshots_cmd", {
        mountPoint: targetPath,
      });
      setSnapshotReport(rep);
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsLoadingSnapshots(false);
    }
  };

  const handleDeleteSnapshot = async (name: string, uuid: string) => {
    try {
      const res = await invoke<SnapshotPurgeResult>(
        "delete_single_snapshot_cmd",
        {
          mountPoint: selectedMountPoint,
          name,
          uuid,
        }
      );
      onShowToast(res.message);
      await handleScanSnapshots(selectedMountPoint);
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    }
  };

  const handlePurgeAllSnapshots = async () => {
    setIsPurgingSnapshots(true);
    try {
      const res = await invoke<SnapshotPurgeResult>(
        "thin_and_purge_all_snapshots_cmd",
        {
          mountPoint: selectedMountPoint,
        }
      );
      onShowToast(res.message);
      await handleScanSnapshots(selectedMountPoint);
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsPurgingSnapshots(false);
    }
  };

  useEffect(() => {
    handleScanGhost(selectedMountPoint);
    handleScanSnapshots(selectedMountPoint);
    setSpeedResult(null);
  }, [selectedMountPoint]);

  const toggleGhostCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
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

  const handleRunSpeedTest = async () => {
    setIsRunningSpeed(true);
    try {
      const res = await invoke<SpeedTestResult>("run_hardware_speedtest", {
        targetPath: selectedMountPoint,
      });
      setSpeedResult(res);
      onShowToast(
        `SpeedTest terminé : ${res.writeMbps} Mo/s écriture • ${res.readMbps} Mo/s lecture`
      );
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsRunningSpeed(false);
    }
  };

  const selectedFormatDrive = useMemo(
    () => externalRemovableDrives.find((d) => d.id === formatTargetId) || null,
    [externalRemovableDrives, formatTargetId]
  );

  const [volumeToDelete, setVolumeToDelete] = useState<ApfsVolumeItem | null>(null);

  const currentContainer = useMemo(() => {
    return (
      apfsContainers.find((c) => c.containerId === selectedContainerId) ||
      apfsContainers[0] ||
      null
    );
  }, [apfsContainers, selectedContainerId]);

  const handleAddApfsVolume = async () => {
    if (!selectedContainerId) {
      onShowError("Veuillez sélectionner un conteneur APFS.");
      return;
    }
    const clean = newApfsVolumeName.trim();
    if (!clean) {
      onShowError("Veuillez saisir un nom pour le volume.");
      return;
    }
    setIsAddingVolume(true);
    try {
      const res = await invoke<PartitionActionResult>("add_apfs_volume_cmd", {
        req: {
          containerId: selectedContainerId,
          volumeName: clean,
          volumeFormat: "APFS",
          roleType: newApfsRole,
          quotaGb: newApfsQuotaGb > 0 ? Number(newApfsQuotaGb) : null,
          reserveGb: null,
          passphrase: null,
        },
      });
      onShowToast(res.message);
      setNewApfsVolumeName("MonVolume");
      setNewApfsQuotaGb(0);
      await loadApfsContainers();
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsAddingVolume(false);
    }
  };

  const handleConfirmDeleteVolume = async () => {
    if (!volumeToDelete) return;
    try {
      const res = await invoke<PartitionActionResult>("delete_apfs_volume_cmd", {
        bsdName: volumeToDelete.bsdName,
        mountPoint: volumeToDelete.mountPoint,
      });
      onShowToast(res.message);
      setVolumeToDelete(null);
      await loadApfsContainers();
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    }
  };

  const handleExecuteFormat = async () => {
    if (!selectedFormatDrive) return;
    setIsFormatting(true);
    try {
      const res = await invoke<FormatDriveResult>("format_removable_drive", {
        bsdName: selectedFormatDrive.bsdName,
        mountPoint: selectedFormatDrive.mountPoint,
        isRemovable: selectedFormatDrive.isRemovable,
        fileSystem: formatFs,
        newVolumeName: formatVolumeName,
      });
      setConfirmFormatModal(false);
      onShowToast(res.message);
      onRefreshDrives();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsFormatting(false);
    }
  };

  const handleExecuteSplit = async () => {
    if (!selectedFormatDrive) return;
    setIsSplitting(true);
    try {
      const res = await invoke<PartitionActionResult>("split_dual_partition_cmd", {
        req: {
          parentDisk: selectedFormatDrive.bsdName,
          isRemovable: selectedFormatDrive.isRemovable,
          partition1Name: hybridName1.trim() || "Mac_APFS",
          partition1Fs: "APFS",
          partition1Pct: Number(hybridSplitPct),
          partition2Name: hybridName2.trim() || "PC_ExFAT",
          partition2Fs: "ExFAT",
        },
      });
      setConfirmSplitModal(false);
      onShowToast(res.message);
      onRefreshDrives();
      await loadApfsContainers();
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsSplitting(false);
    }
  };

  const selectedFlashDrive = useMemo(
    () => externalRemovableDrives.find((d) => d.id === flashTargetId) || externalRemovableDrives[0] || null,
    [externalRemovableDrives, flashTargetId]
  );

  const handleRunFlashTest = async () => {
    if (!selectedFlashDrive) {
      onShowError("Veuillez connecter un support externe amovible pour lancer le test flash.");
      return;
    }
    setIsRunningFlashTest(true);
    setFlashResult(null);
    setFlashProgress({
      stage: "writing",
      percent: 0,
      currentMb: 0,
      totalMb: flashTestMb,
      speedMbps: 0,
      message: "Préparation des mires physiques de test…",
    });

    try {
      const res = await invoke<FlashTestResult>("run_flash_test_cmd", {
        mountPoint: selectedFlashDrive.mountPoint,
        targetMb: flashTestMb,
        isRemovable: selectedFlashDrive.isRemovable,
      });
      setFlashResult(res);
      if (res.isCounterfeit) {
        onShowError(res.verdictDescription);
      } else {
        onShowToast(`Test réussi : ${res.verdictTitle}`);
      }
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIsRunningFlashTest(false);
    }
  };

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
                    {d.mountPoint === "/" ? `${d.name} (Utilisateur)` : d.name}
                  </span>
                </button>
              );
            })}
        </div>

        <button
          onClick={() => {
            handleScanGhost(selectedMountPoint);
            handleScanSnapshots(selectedMountPoint);
            handleLoadSsdHealth(selectedMountPoint);
            handleScanSystemGhost();
          }}
          disabled={
            isScanningGhost ||
            isLoadingSnapshots ||
            isLoadingHealth ||
            isScanningSystemGhost
          }
          className="px-3 py-1.5 rounded-xl bg-[#222222] hover:bg-[#2B2B2B] border border-[#323232] text-xs text-[#9B9A97] hover:text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              isScanningGhost ||
              isLoadingSnapshots ||
              isLoadingHealth ||
              isScanningSystemGhost
                ? "animate-spin text-[#10B981]"
                : ""
            }`}
          />
          <span>Réanalyser</span>
        </button>
      </div>

      {/* ================= GRID: CLEANER + SNAPSHOTS + SPEEDTEST + FORMATTER ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* CARD 0 (12 cols): NETTOYEUR ESPACE FANTÔME SYSTÈME (Xcode, Paquets & Logs) */}
        <div className="lg:col-span-12 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 flex flex-col justify-between gap-5">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#6366F1]/15 border border-[#6366F1]/30 flex items-center justify-center text-[#818CF8]">
                  <Code2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    Nettoyeur d&apos;Espace Fantôme Système (Xcode, Paquets &amp; Logs)
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    Récupère l&apos;espace gaspillé par les recompilations Xcode, simulateurs iOS, caches npm/Gradle et fichiers journaux
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
              <div className="py-10 text-center text-xs text-[#9B9A97] flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-[#818CF8]" />
                <span>Analyse approfondie de l&apos;espace fantôme système…</span>
              </div>
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
                    Élimine les fichiers invisibles ._* / .DS_Store, .Trashes et caches vidéo
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
              <div className="py-12 text-center text-xs text-[#9B9A97]">
                Inspection des fichiers fantômes et caches en cours…
              </div>
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
              Reclame immédiatement les blocs disque gelés
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

        {/* CARD 3 (6 cols): SPEEDTEST */}
        <div className="lg:col-span-6 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 flex flex-col justify-between gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#3B82F6]/15 border border-[#3B82F6]/30 flex items-center justify-center">
                  <Gauge className="w-4 h-4 text-[#60A5FA]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    SpeedTest Matériel (Direct I/O)
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    Mesure hors-cache RAM (F_NOCACHE) du support actif
                  </p>
                </div>
              </div>

              <button
                onClick={handleRunSpeedTest}
                disabled={isRunningSpeed}
                className="px-3 py-1.5 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>{isRunningSpeed ? "Test…" : "Tester"}</span>
              </button>
            </div>

            {speedResult ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-[#171717] border border-[#2A2A2A]">
                    <span className="text-[11px] text-[#9B9A97] block">
                      Écriture réelle
                    </span>
                    <span className="text-lg font-bold font-mono text-[#10B981]">
                      {speedResult.writeMbps} Mo/s
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#171717] border border-[#2A2A2A]">
                    <span className="text-[11px] text-[#9B9A97] block">
                      Lecture réelle
                    </span>
                    <span className="text-lg font-bold font-mono text-[#60A5FA]">
                      {speedResult.readMbps} Mo/s
                    </span>
                  </div>
                </div>

                <div
                  className={`p-2.5 rounded-xl border text-xs flex items-center gap-2 ${
                    speedResult.isUsb2Limited
                      ? "bg-[#EF4444]/15 border-[#EF4444]/40 text-[#FCA5A5]"
                      : "bg-[#161616] border-[#2C2C2C] text-[#EDEDEC]"
                  }`}
                >
                  <Zap className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
                  <span>{speedResult.capabilityVerdict}</span>
                </div>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-[#171717] border border-[#282828] text-xs text-[#787774]">
                Cliquez sur « Tester » pour mesurer le débit réel de lecture et d&apos;écriture du support sélectionné.
              </div>
            )}
          </div>

          {/* CARD 4 (6 cols): PARTITIONING & APFS VOLUMES */}
          <div className="lg:col-span-6 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 flex flex-col justify-between gap-4">
            <div className="space-y-3">
              {/* Header with Title and Tab Pill */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#F59E0B]/15 border border-[#F59E0B]/30 flex items-center justify-center">
                    <Split className="w-4 h-4 text-[#FBBF24]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[#EDEDEC]">
                      Partitionnement &amp; Volumes APFS
                    </h3>
                    <p className="text-[11px] text-[#9B9A97]">
                      Volumes partagés dynamiques ou double partition externe
                    </p>
                  </div>
                </div>

                {/* Sub-tabs pills */}
                <div className="flex items-center p-0.5 rounded-xl bg-[#161616] border border-[#2B2B2B]">
                  <button
                    onClick={() => setPartitionTab("apfs_volume")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      partitionTab === "apfs_volume"
                        ? "bg-[#252525] text-[#EDEDEC] shadow-sm"
                        : "text-[#787774] hover:text-[#9B9A97]"
                    }`}
                  >
                    Volumes APFS
                  </button>
                  <button
                    onClick={() => setPartitionTab("hybrid_split")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      partitionTab === "hybrid_split"
                        ? "bg-[#252525] text-[#EDEDEC] shadow-sm"
                        : "text-[#787774] hover:text-[#9B9A97]"
                    }`}
                  >
                    Hybride ExFAT
                  </button>
                  <button
                    onClick={() => setPartitionTab("format_single")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      partitionTab === "format_single"
                        ? "bg-[#252525] text-[#EDEDEC] shadow-sm"
                        : "text-[#787774] hover:text-[#9B9A97]"
                    }`}
                  >
                    Format 1-Clic
                  </button>
                </div>
              </div>

              {/* TAB 1: DYNAMIC APFS VOLUMES */}
              {partitionTab === "apfs_volume" && (
                <div className="space-y-3">
                  {/* Container Selector & Free Space Pill */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <select
                        value={selectedContainerId}
                        onChange={(e) => setSelectedContainerId(e.target.value)}
                        className="w-full px-2.5 py-1 rounded-lg bg-[#161616] border border-[#2E2E2E] text-xs text-[#EDEDEC] focus:outline-none"
                      >
                        {apfsContainers.map((c) => (
                          <option key={c.containerId} value={c.containerId}>
                            Conteneur {c.containerId} ({c.isInternal ? "Interne" : "Externe"} • {formatBytes(c.totalBytes)})
                          </option>
                        ))}
                      </select>
                    </div>
                    {currentContainer && (
                      <span className="text-[11px] font-mono text-[#10B981] px-2 py-1 rounded-lg bg-[#14231B] border border-[#10B981]/30 shrink-0">
                        {formatBytes(currentContainer.freeBytes)} libres
                      </span>
                    )}
                  </div>

                  {/* Volume List in Container */}
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {!currentContainer || currentContainer.volumes.length === 0 ? (
                      <div className="py-4 text-center text-xs text-[#787774]">
                        Aucun volume détecté dans ce conteneur.
                      </div>
                    ) : (
                      currentContainer.volumes.map((vol) => (
                        <div
                          key={vol.bsdName}
                          className="p-2 rounded-xl bg-[#171717] border border-[#272727] flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <Layers className="w-3.5 h-3.5 text-[#9B9A97] shrink-0" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-[#EDEDEC] truncate">
                                  {vol.name || "Sans nom"}
                                </span>
                                <span className="text-[10px] font-mono text-[#787774]">
                                  {vol.bsdName}
                                </span>
                                <span
                                  className={`text-[9px] px-1.5 py-0.2 rounded font-medium ${
                                    vol.isSystemLocked
                                      ? "bg-[#3B82F6]/15 text-[#60A5FA]"
                                      : vol.role.toLowerCase().includes("backup")
                                      ? "bg-[#F59E0B]/15 text-[#FBBF24]"
                                      : "bg-[#252525] text-[#9B9A97]"
                                  }`}
                                >
                                  {vol.role || "Standard"}
                                </span>
                                <span
                                  className={`text-[9px] px-1.5 py-0.2 rounded font-medium flex items-center gap-0.5 ${
                                    vol.isEncrypted
                                      ? "bg-[#10B981]/15 text-[#34D399]"
                                      : "bg-[#252525] text-[#9B9A97]"
                                  }`}
                                  title={
                                    vol.isEncrypted
                                      ? "Volume APFS chiffré et protégé par mot de passe"
                                      : "Volume non chiffré"
                                  }
                                >
                                  {vol.isEncrypted ? (
                                    <Lock className="w-2.5 h-2.5" />
                                  ) : (
                                    <Unlock className="w-2.5 h-2.5" />
                                  )}
                                  <span>{vol.isEncrypted ? "Chiffré" : "Clair"}</span>
                                </span>
                              </div>
                              <p className="text-[10px] text-[#787774] truncate">
                                {vol.mountPoint}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-[11px] text-[#EDEDEC]">
                              {formatBytes(vol.capacityConsumedBytes)}
                            </span>
                            {!vol.isEncrypted &&
                              !vol.isSystemLocked &&
                              currentContainer &&
                              !currentContainer.isInternal && (
                                <button
                                  onClick={() => {
                                    setEncryptVolumeTarget(vol);
                                    setVolumePassphrase("");
                                    setVolumeConfirmPassphrase("");
                                  }}
                                  title="Protéger ce volume par un mot de passe (Chiffrement APFS)"
                                  className="p-1 rounded text-[#60A5FA] hover:text-white hover:bg-[#3B82F6]/20 cursor-pointer"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                </button>
                              )}
                            {vol.isSystemLocked ? (
                              <span
                                title="Verrouillé Système macOS"
                                className="p-1 rounded text-[#555555]"
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </span>
                            ) : (
                              <button
                                onClick={() => setVolumeToDelete(vol)}
                                title="Supprimer ce volume"
                                className="p-1 rounded text-[#787774] hover:text-[#EF4444] hover:bg-[#252525] cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Add New Volume Form */}
                  <div className="pt-2 border-t border-[#292929] space-y-2">
                    <span className="text-[11px] font-medium text-[#9B9A97] block">
                      Ajouter un volume partagé (zéro-risque, instantané) :
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={newApfsVolumeName}
                        onChange={(e) => setNewApfsVolumeName(e.target.value)}
                        placeholder="Nom du volume"
                        maxLength={24}
                        className="flex-1 min-w-[120px] px-2.5 py-1.5 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                      />
                      <select
                        value={newApfsRole}
                        onChange={(e) =>
                          setNewApfsRole(e.target.value as "standard" | "backup")
                        }
                        className="px-2.5 py-1.5 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                      >
                        <option value="standard">Standard (Données)</option>
                        <option value="backup">Sauvegarde (Time Machine)</option>
                      </select>
                      <input
                        type="number"
                        min={0}
                        max={9999}
                        value={newApfsQuotaGb || ""}
                        onChange={(e) =>
                          setNewApfsQuotaGb(Math.max(0, parseInt(e.target.value) || 0))
                        }
                        placeholder="Quota Go (opt)"
                        title="Quota maximal en Go (optionnel, 0 = illimité)"
                        className="w-24 px-2.5 py-1.5 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] font-mono focus:outline-none"
                      />
                      <button
                        onClick={handleAddApfsVolume}
                        disabled={isAddingVolume || !newApfsVolumeName.trim()}
                        className="px-3 py-1.5 rounded-xl bg-[#10B981] hover:bg-[#059669] disabled:opacity-40 text-black font-semibold text-xs flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{isAddingVolume ? "Création…" : "Créer"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: HYBRID DUAL PARTITION */}
              {partitionTab === "hybrid_split" && (
                <div className="space-y-3">
                  {externalRemovableDrives.length === 0 ? (
                    <div className="p-4 rounded-xl bg-[#171717] border border-[#282828] text-xs text-[#787774] text-center space-y-1">
                      <p className="font-semibold text-[#EDEDEC]">
                        Aucun disque externe connecté
                      </p>
                      <p className="text-[11px]">
                        Connectez un SSD ou une clé USB externe pour créer une double partition hybride Mac &amp; PC.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Removable Target */}
                      <div className="space-y-1">
                        <label className="text-[11px] text-[#9B9A97]">
                          Disque externe à partitionner
                        </label>
                        <select
                          value={formatTargetId}
                          onChange={(e) => setFormatTargetId(e.target.value)}
                          className="w-full px-3 py-1.5 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                        >
                          {externalRemovableDrives.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} (/dev/{d.bsdName} • {formatBytes(d.totalBytes)})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Names for Partitions */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#A78BFA] font-medium flex items-center justify-between">
                            <span>Partition 1 : APFS (Mac)</span>
                            <span>{hybridSplitPct}%</span>
                          </label>
                          <input
                            type="text"
                            value={hybridName1}
                            onChange={(e) => setHybridName1(e.target.value)}
                            placeholder="Nom Mac"
                            maxLength={20}
                            className="w-full px-2.5 py-1.5 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] font-mono focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-[#FBBF24] font-medium flex items-center justify-between">
                            <span>Partition 2 : ExFAT (PC/Mac)</span>
                            <span>{100 - hybridSplitPct}%</span>
                          </label>
                          <input
                            type="text"
                            value={hybridName2}
                            onChange={(e) => setHybridName2(e.target.value)}
                            placeholder="Nom PC"
                            maxLength={20}
                            className="w-full px-2.5 py-1.5 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] font-mono focus:outline-none"
                          />
                        </div>
                      </div>

                      {/* Percentage slider & Visual Bar */}
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between text-[11px] text-[#9B9A97]">
                          <span>
                            Mac :{" "}
                            <strong className="text-[#A78BFA]">
                              {selectedFormatDrive
                                ? formatBytes((selectedFormatDrive.totalBytes * hybridSplitPct) / 100)
                                : `${hybridSplitPct}%`}
                            </strong>
                          </span>
                          <span>
                            PC :{" "}
                            <strong className="text-[#FBBF24]">
                              {selectedFormatDrive
                                ? formatBytes((selectedFormatDrive.totalBytes * (100 - hybridSplitPct)) / 100)
                                : `${100 - hybridSplitPct}%`}
                            </strong>
                          </span>
                        </div>

                        {/* Interactive Range Slider */}
                        <input
                          type="range"
                          min={10}
                          max={90}
                          step={5}
                          value={hybridSplitPct}
                          onChange={(e) => setHybridSplitPct(parseInt(e.target.value))}
                          className="w-full accent-[#8B5CF6] cursor-pointer"
                        />

                        {/* Visual Split Bar */}
                        <div className="h-6 rounded-xl overflow-hidden flex text-[10px] font-bold">
                          <div
                            style={{ width: `${hybridSplitPct}%` }}
                            className="bg-[#8B5CF6] text-white flex items-center justify-center transition-all truncate px-2"
                          >
                            {hybridName1 || "Mac"} ({hybridSplitPct}%)
                          </div>
                          <div
                            style={{ width: `${100 - hybridSplitPct}%` }}
                            className="bg-[#F59E0B] text-black flex items-center justify-center transition-all truncate px-2"
                          >
                            {hybridName2 || "PC"} ({100 - hybridSplitPct}%)
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="pt-1 flex items-center justify-end">
                        <button
                          onClick={() => setConfirmSplitModal(true)}
                          className="px-4 py-2 rounded-xl bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                        >
                          <Split className="w-3.5 h-3.5" />
                          <span>Partitionner en 2 volumes…</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: SIMPLE 1-CLICK FORMAT */}
              {partitionTab === "format_single" && (
                externalRemovableDrives.length === 0 ? (
                  <div className="p-3.5 rounded-xl bg-[#171717] border border-[#282828] text-xs text-[#787774]">
                    Branchez un disque externe, une clé USB ou une carte SD pour débloquer le formatage rapide.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Select Removable Drive */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-[#9B9A97]">
                        Support externe à formater
                      </label>
                      <select
                        value={formatTargetId}
                        onChange={(e) => {
                          setFormatTargetId(e.target.value);
                          const d = externalRemovableDrives.find(
                            (x) => x.id === e.target.value
                          );
                          if (d) setFormatVolumeName(d.name.slice(0, 20));
                        }}
                        className="w-full px-3 py-1.5 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                      >
                        {externalRemovableDrives.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} (/dev/{d.bsdName} • {formatBytes(d.totalBytes)})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Filesystem Profile */}
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: "ExFAT", sub: "Mac / PC / Caméra" },
                          { id: "APFS", sub: "Natif macOS SSD" },
                          { id: "FAT32", sub: "Compatibilité TV" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          onClick={() => setFormatFs(opt.id)}
                          className={`p-2 rounded-xl border text-left transition-colors cursor-pointer ${
                            formatFs === opt.id
                              ? "bg-[#F59E0B]/20 border-[#F59E0B]/50 text-[#FBBF24]"
                              : "bg-[#171717] border-[#2A2A2A] text-[#EDEDEC]"
                          }`}
                        >
                          <div className="text-xs font-bold">{opt.id}</div>
                          <div className="text-[10px] text-[#9B9A97] truncate">
                            {opt.sub}
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Volume Name + Action */}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={formatVolumeName}
                        onChange={(e) => setFormatVolumeName(e.target.value)}
                        placeholder="Nom du volume"
                        maxLength={24}
                        className="flex-1 px-3 py-1.5 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] font-mono focus:outline-none"
                      />
                      <button
                        onClick={() => setConfirmFormatModal(true)}
                        className="px-3.5 py-1.5 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-black font-semibold text-xs cursor-pointer shrink-0"
                      >
                        Formater…
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>

          {/* CARD 5 (12 cols): FLASH AUTHENTICITY / ANTI-COUNTERFEIT DETECTOR */}
          <div className="lg:col-span-12 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#06B6D4]/15 border border-[#06B6D4]/30 flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4 text-[#22D3EE]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    Test d&apos;Authenticité Flash (Anti-Arnaque Clés USB &amp; Cartes SD)
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    Détecte les clés contrefaites (faux 1 To / 2 To) dont la mémoire réelle ne fait que 16 ou 32 Go
                  </p>
                </div>
              </div>

              {/* Quick volume selector and start button */}
              <div className="flex flex-wrap items-center gap-2">
                {externalRemovableDrives.length > 0 && (
                  <select
                    value={flashTargetId || (selectedFlashDrive ? selectedFlashDrive.id : "")}
                    onChange={(e) => setFlashTargetId(e.target.value)}
                    disabled={isRunningFlashTest}
                    className="px-3 py-1.5 rounded-xl bg-[#161616] border border-[#303030] text-xs text-[#EDEDEC] focus:outline-none"
                  >
                    {externalRemovableDrives.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} (/dev/{d.bsdName} • {formatBytes(d.totalBytes)})
                      </option>
                    ))}
                  </select>
                )}

                {/* Test Size Pills */}
                <div className="flex items-center p-0.5 rounded-xl bg-[#161616] border border-[#2B2B2B]">
                  {[
                    { id: 512, label: "Rapide (512 Mo)" },
                    { id: 1024, label: "Standard (1 Go)" },
                    { id: 4096, label: "Complet (4 Go)" },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      disabled={isRunningFlashTest}
                      onClick={() => setFlashTestMb(preset.id)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        flashTestMb === preset.id
                          ? "bg-[#252525] text-[#EDEDEC] shadow-sm"
                          : "text-[#787774] hover:text-[#9B9A97]"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={handleRunFlashTest}
                  disabled={isRunningFlashTest || !selectedFlashDrive}
                  className="px-4 py-2 rounded-xl bg-[#06B6D4] hover:bg-[#0891B2] disabled:opacity-40 text-black font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>{isRunningFlashTest ? "Vérification…" : "Tester l'authenticité"}</span>
                </button>
              </div>
            </div>

            {/* Body: No external drive / Progress / Results */}
            {externalRemovableDrives.length === 0 ? (
              <div className="p-4 rounded-xl bg-[#171717] border border-[#282828] text-xs text-[#787774] text-center space-y-1">
                <p className="font-semibold text-[#EDEDEC]">
                  Aucun support amovible connecté
                </p>
                <p className="text-[11px]">
                  Branchez une clé USB, une carte SD ou un SSD externe pour vérifier si la mémoire flash est authentique.
                </p>
              </div>
            ) : isRunningFlashTest && flashProgress ? (
              <div className="p-4 rounded-xl bg-[#171717] border border-[#292929] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#EDEDEC]">
                    {flashProgress.message}
                  </span>
                  <span className="font-mono text-[#22D3EE] font-bold">
                    {Math.round(flashProgress.percent)}% • {flashProgress.speedMbps} Mo/s
                  </span>
                </div>

                <div className="h-2 rounded-full bg-[#262626] overflow-hidden">
                  <div
                    style={{ width: `${flashProgress.percent}%` }}
                    className="h-full bg-[#06B6D4] transition-all duration-200"
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#787774]">
                  <span>
                    Étape : {flashProgress.stage === "writing" ? "Écriture des signatures physiques" : "Vérification bit-à-bit"}
                  </span>
                  <span>
                    {Math.round(flashProgress.currentMb)} / {flashProgress.totalMb} Mo
                  </span>
                </div>
              </div>
            ) : flashResult ? (
              <div
                className={`p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  flashResult.isCounterfeit
                    ? "bg-[#251515] border-[#EF4444]/40"
                    : "bg-[#15231D] border-[#10B981]/40"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      flashResult.isCounterfeit
                        ? "bg-[#EF4444]/20 border border-[#EF4444]/40 text-[#EF4444]"
                        : "bg-[#10B981]/20 border border-[#10B981]/40 text-[#10B981]"
                    }`}
                  >
                    {flashResult.isCounterfeit ? (
                      <ShieldAlert className="w-5 h-5" />
                    ) : (
                      <ShieldCheck className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h4
                      className={`text-sm font-bold ${
                        flashResult.isCounterfeit ? "text-[#F87171]" : "text-[#34D399]"
                      }`}
                    >
                      {flashResult.verdictTitle}
                    </h4>
                    <p className="text-xs text-[#EDEDEC]/80 mt-0.5 max-w-xl">
                      {flashResult.verdictDescription}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-[#2A2A2A]">
                  <div>
                    <span className="text-[10px] text-[#9B9A97] block">Écriture</span>
                    <span className="font-semibold text-[#EDEDEC]">{flashResult.writeSpeedMbps} Mo/s</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#9B9A97] block">Lecture</span>
                    <span className="font-semibold text-[#EDEDEC]">{flashResult.readSpeedMbps} Mo/s</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#9B9A97] block">Durée</span>
                    <span className="font-semibold text-[#EDEDEC]">{flashResult.durationSeconds} s</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-[#171717] border border-[#282828] text-xs text-[#787774] flex items-center justify-between">
                <span>
                  Sélectionnez votre clé ou carte SD et cliquez sur « Tester l&apos;authenticité » pour vérifier que la capacité physique réelle correspond bien à la taille affichée.
                </span>
                <span className="text-[11px] font-mono text-[#9B9A97] shrink-0 ml-3">
                  100% sans risque • Ne supprime aucun fichier existant
                </span>
              </div>
            )}
          </div>

          {/* CARD 6 (12 cols): SANTÉ & USURE SSD EXPRESS (S.M.A.R.T. SIMPLIFIÉ) */}
          <div className="lg:col-span-12 bg-[#202020] border border-[#2F2F2F] rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center">
                  <HeartPulse className="w-4 h-4 text-[#34D399]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    Santé &amp; Usure SSD Express (S.M.A.R.T. Simplifié)
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    Surveillance de la longévité des cellules flash, de l&apos;état matériel et du cumul d&apos;écriture (TBW) sans jargon technique
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {ssdHealth && (
                  <span
                    className={`px-3 py-1 rounded-xl text-xs font-medium border flex items-center gap-1.5 ${
                      ssdHealth.healthPercent >= 90
                        ? "bg-[#10B981]/15 text-[#34D399] border-[#10B981]/30"
                        : ssdHealth.healthPercent >= 70
                        ? "bg-[#F59E0B]/15 text-[#FBBF24] border-[#F59E0B]/30"
                        : "bg-[#EF4444]/15 text-[#F87171] border-[#EF4444]/30"
                    }`}
                  >
                    {ssdHealth.healthPercent >= 90 ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {ssdHealth.healthPercent >= 90
                        ? "Santé Optimale"
                        : ssdHealth.healthPercent >= 70
                        ? "État Correct"
                        : "Usure Avancée"}
                    </span>
                  </span>
                )}

                <button
                  onClick={() => handleLoadSsdHealth(selectedMountPoint)}
                  disabled={isLoadingHealth}
                  className="px-3 py-1.5 rounded-xl bg-[#171717] hover:bg-[#252525] border border-[#2E2E2E] text-xs text-[#9B9A97] hover:text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
                  title="Rafraîchir les métriques S.M.A.R.T."
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      isLoadingHealth ? "animate-spin text-[#10B981]" : ""
                    }`}
                  />
                  <span>Actualiser</span>
                </button>
              </div>
            </div>

            {isLoadingHealth && !ssdHealth ? (
              <div className="py-8 text-center text-xs text-[#9B9A97] flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-[#10B981]" />
                <span>Interrogation des registres S.M.A.R.T. et du contrôleur flash…</span>
              </div>
            ) : ssdHealth ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. Health Score & Verdict */}
                <div className="bg-[#171717] border border-[#282828] rounded-xl p-4 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#9B9A97] mb-1">
                      <span>Indicateur de Santé</span>
                      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[#222222] text-[#EDEDEC]">
                        S.M.A.R.T. {ssdHealth.smartStatus}
                      </span>
                    </div>

                    <div className="flex items-baseline gap-2 my-2">
                      <span
                        className={`text-4xl font-extrabold font-mono tracking-tight ${
                          ssdHealth.healthPercent >= 90
                            ? "text-[#34D399]"
                            : ssdHealth.healthPercent >= 70
                            ? "text-[#FBBF24]"
                            : "text-[#F87171]"
                        }`}
                      >
                        {ssdHealth.healthPercent}%
                      </span>
                      <span className="text-xs text-[#9B9A97]">d&apos;espérance de vie</span>
                    </div>

                    <div className="h-2 rounded-full bg-[#262626] overflow-hidden mb-3">
                      <div
                        style={{ width: `${Math.min(100, Math.max(5, ssdHealth.healthPercent))}%` }}
                        className={`h-full transition-all duration-300 ${
                          ssdHealth.healthPercent >= 90
                            ? "bg-[#10B981]"
                            : ssdHealth.healthPercent >= 70
                            ? "bg-[#F59E0B]"
                            : "bg-[#EF4444]"
                        }`}
                      />
                    </div>

                    <div className="text-xs font-semibold text-[#EDEDEC]">
                      {ssdHealth.statusVerdict}
                    </div>
                  </div>

                  <p className="text-[11px] text-[#9B9A97] leading-relaxed pt-2 border-t border-[#242424]">
                    {ssdHealth.statusAdvice}
                  </p>
                </div>

                {/* 2. Cumulative TBW & Wear Endurance */}
                <div className="bg-[#171717] border border-[#282828] rounded-xl p-4 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs text-[#9B9A97] mb-1">
                      <span>Endurance Écrite (TBW)</span>
                      <span className="text-[11px] font-mono text-[#EDEDEC]">
                        {ssdHealth.tbwWritten.toFixed(1)} / {ssdHealth.ratedTbw} To
                      </span>
                    </div>

                    <div className="flex items-baseline gap-1.5 my-2">
                      <span className="text-2xl font-bold font-mono text-[#EDEDEC]">
                        {ssdHealth.tbwWritten.toFixed(1)} To
                      </span>
                      <span className="text-xs text-[#787774]">écrits à ce jour</span>
                    </div>

                    <div className="h-2 rounded-full bg-[#262626] overflow-hidden mb-2">
                      <div
                        style={{
                          width: `${Math.min(100, (ssdHealth.tbwWritten / ssdHealth.ratedTbw) * 100)}%`,
                        }}
                        className="h-full bg-[#3B82F6] transition-all duration-300"
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[#787774]">
                      <span>Usure endurance constructeur</span>
                      <span className="font-mono text-[#EDEDEC]">
                        {((ssdHealth.tbwWritten / ssdHealth.ratedTbw) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#242424] space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-[#9B9A97]">Données lues :</span>
                      <span className="font-mono text-[#EDEDEC]">{ssdHealth.tbrRead.toFixed(1)} To</span>
                    </div>
                    <p className="text-[10px] text-[#787774] leading-tight">
                      Basé sur la norme d&apos;endurance standard de {ssdHealth.ratedTbw} TBW pour cette capacité de stockage.
                    </p>
                  </div>
                </div>

                {/* 3. Hardware sensors & I/O statistics */}
                <div className="bg-[#171717] border border-[#282828] rounded-xl p-4 flex flex-col justify-between space-y-3 text-xs">
                  <div className="space-y-2">
                    <span className="text-[#9B9A97] text-[11px] block font-medium">
                      Informations Matérielles &amp; Bus
                    </span>

                    <div className="space-y-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-[#787774]">Modèle</span>
                        <span className="font-semibold text-[#EDEDEC] truncate max-w-[150px]">
                          {ssdHealth.modelName}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-[#787774]">Protocole de bus</span>
                        <span className="font-mono text-[#EDEDEC]">
                          {ssdHealth.protocol}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-[#787774]">Technologie</span>
                        <span className="text-[#EDEDEC]">
                          {ssdHealth.isSsd ? "SSD NVMe / Flash" : "Disque Dur HDD"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-[#787774]">Température</span>
                        <div className="flex items-center gap-1 text-[#34D399]">
                          <Thermometer className="w-3.5 h-3.5" />
                          <span>
                            {ssdHealth.temperatureCelsius
                              ? `${ssdHealth.temperatureCelsius} °C (Optimale)`
                              : "Nominale"}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-[#787774]">Erreurs matérielles I/O</span>
                        <span
                          className={`font-mono ${
                            ssdHealth.errorsCount === 0
                              ? "text-[#34D399]"
                              : "text-[#EF4444] font-bold"
                          }`}
                        >
                          {ssdHealth.errorsCount === 0
                            ? "0 erreur"
                            : `${ssdHealth.errorsCount} erreurs`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[#242424] flex items-center justify-between text-[10px] text-[#787774] font-mono">
                    <span>Nœud : /dev/{ssdHealth.bsdName}</span>
                    <span>Capacité : {formatBytes(ssdHealth.totalBytes)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-[#171717] border border-[#282828] text-xs text-[#787774] text-center">
                Aucune information de santé disponible pour ce support.
              </div>
            )}
          </div>
        </div>

      {/* ================= CONFIRM FORMAT MODAL ================= */}
      {confirmFormatModal && selectedFormatDrive && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Confirmer le formatage externe
                </h3>
              </div>
              <button
                onClick={() => setConfirmFormatModal(false)}
                className="p-1 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-[#9B9A97]">
                Toutes les données présentes sur{" "}
                <strong className="text-[#EDEDEC]">
                  {selectedFormatDrive.name} (/dev/{selectedFormatDrive.bsdName})
                </strong>{" "}
                seront effacées et remplacées par une partition{" "}
                <strong className="text-[#FBBF24]">{formatFs}</strong> nommée{" "}
                <strong className="text-[#EDEDEC]">{formatVolumeName}</strong>.
              </p>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmFormatModal(false)}
                  className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handleExecuteFormat}
                  disabled={isFormatting}
                  className="px-4 py-2 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-xs cursor-pointer"
                >
                  {isFormatting
                    ? "Formatage en cours…"
                    : `Formater en ${formatFs}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= CONFIRM HYBRID SPLIT MODAL ================= */}
      {confirmSplitModal && selectedFormatDrive && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#8B5CF6]" />
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Confirmer le partitionnement hybride
                </h3>
              </div>
              <button
                onClick={() => setConfirmSplitModal(false)}
                className="p-1 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-[#9B9A97]">
                Le disque externe{" "}
                <strong className="text-[#EDEDEC]">
                  {selectedFormatDrive.name} (/dev/{selectedFormatDrive.bsdName})
                </strong>{" "}
                sera entièrement effacé et repartitionné en table GUID (GPT) avec 2 partitions :
              </p>

              <div className="space-y-2 p-3 rounded-xl bg-[#171717] border border-[#292929] text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#A78BFA] font-medium">
                    1. {hybridName1 || "Mac_APFS"} (APFS)
                  </span>
                  <span className="font-mono text-[#EDEDEC]">
                    {hybridSplitPct}% • ~
                    {formatBytes((selectedFormatDrive.totalBytes * hybridSplitPct) / 100)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#FBBF24] font-medium">
                    2. {hybridName2 || "PC_ExFAT"} (ExFAT)
                  </span>
                  <span className="font-mono text-[#EDEDEC]">
                    {100 - hybridSplitPct}% • ~
                    {formatBytes((selectedFormatDrive.totalBytes * (100 - hybridSplitPct)) / 100)}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setConfirmSplitModal(false)}
                  className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handleExecuteSplit}
                  disabled={isSplitting}
                  className="px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold text-xs cursor-pointer"
                >
                  {isSplitting ? "Partitionnement…" : "Confirmer le repartitionnement"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= CONFIRM DELETE APFS VOLUME MODAL ================= */}
      {volumeToDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202020] border border-[#333333] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
                <h3 className="text-sm font-semibold text-[#EDEDEC]">
                  Supprimer le volume APFS
                </h3>
              </div>
              <button
                onClick={() => setVolumeToDelete(null)}
                className="p-1 rounded-lg text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-[#9B9A97]">
                Êtes-vous sûr de vouloir supprimer le volume{" "}
                <strong className="text-[#EDEDEC]">
                  « {volumeToDelete.name} » ({volumeToDelete.bsdName})
                </strong>{" "}
                ? Toutes les données de ce volume seront définitivement effacées et l&apos;espace sera restitué au conteneur partagé.
              </p>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setVolumeToDelete(null)}
                  className="px-3 py-2 rounded-lg bg-[#282828] hover:bg-[#323232] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>
                <button
                  onClick={handleConfirmDeleteVolume}
                  className="px-4 py-2 rounded-lg bg-[#EF4444] hover:bg-[#DC2626] text-white font-semibold text-xs cursor-pointer"
                >
                  Supprimer le volume
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= ENCRYPT APFS VOLUME MODAL ================= */}
      {encryptVolumeTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#202020] border border-[#2F2F2F] rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#2C2C2C] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#3B82F6]/15 border border-[#3B82F6]/30 flex items-center justify-center text-[#60A5FA]">
                  <Lock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#EDEDEC]">
                    Chiffrer le volume APFS
                  </h3>
                  <p className="text-[11px] text-[#9B9A97]">
                    {encryptVolumeTarget.name || "Volume"} ({encryptVolumeTarget.bsdName})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEncryptVolumeTarget(null)}
                className="p-1 rounded-lg text-[#787774] hover:text-[#EDEDEC] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 rounded-xl bg-[#171717] border border-[#292929] text-xs text-[#9B9A97] space-y-1.5">
                <p className="text-[#EDEDEC] font-medium">Chiffrement matériel sécurisé</p>
                <p>
                  Protège l&apos;intégralité des données de ce volume APFS. Le mot de passe sera exigé lors du branchement.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[#9B9A97] mb-1">
                    Mot de passe de protection
                  </label>
                  <input
                    type="password"
                    value={volumePassphrase}
                    onChange={(e) => setVolumePassphrase(e.target.value)}
                    placeholder="Au moins 4 caractères"
                    className="w-full px-3 py-2 rounded-xl bg-[#181818] border border-[#2F2F2F] text-sm text-[#EDEDEC] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#9B9A97] mb-1">
                    Confirmer le mot de passe
                  </label>
                  <input
                    type="password"
                    value={volumeConfirmPassphrase}
                    onChange={(e) => setVolumeConfirmPassphrase(e.target.value)}
                    placeholder="Répétez le mot de passe"
                    className="w-full px-3 py-2 rounded-xl bg-[#181818] border border-[#2F2F2F] text-sm text-[#EDEDEC] focus:border-[#3B82F6] focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  onClick={() => setEncryptVolumeTarget(null)}
                  className="px-3 py-2 rounded-lg bg-[#252525] hover:bg-[#2F2F2F] text-xs text-[#9B9A97] cursor-pointer"
                >
                  Annuler
                </button>

                <button
                  onClick={handleExecuteVolumeEncryption}
                  disabled={
                    isEncryptingVolume ||
                    volumePassphrase.length < 4 ||
                    volumePassphrase !== volumeConfirmPassphrase
                  }
                  className="px-4 py-2 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>
                    {isEncryptingVolume ? "Activation du chiffrement…" : "Activer la protection"}
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

