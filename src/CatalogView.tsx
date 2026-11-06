import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Search,
  HardDrive,
  Folder,
  File,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  ChevronRight,
  ArrowUpLeft,
  Cloud,
  Database,
  X,
} from "lucide-react";
import type {
  CatalogEntry,
  CatalogSearchResult,
  CatalogVolumeSummary,
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

const CATEGORY_FILTERS = [
  { id: "all", label: "Tout" },
  { id: "folder", label: "Dossiers" },
  { id: "video", label: "Vidéo" },
  { id: "image", label: "Photo" },
  { id: "audio", label: "Audio" },
  { id: "archive", label: "Archives" },
  { id: "document", label: "Docs" },
];

interface Props {
  drives: StorageDriveInfo[];
  onShowToast: (msg: string) => void;
  onShowError: (err: string) => void;
}

export default function CatalogView({
  drives,
  onShowToast,
  onShowError,
}: Props) {
  const [volumes, setVolumes] = useState<CatalogVolumeSummary[]>([]);
  const [selectedVolumeId, setSelectedVolumeId] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Offline folder browsing state when not searching
  const [browseVolume, setBrowseVolume] =
    useState<CatalogVolumeSummary | null>(null);
  const [browseRelPath, setBrowseRelPath] = useState<string>("");
  const [browseEntries, setBrowseEntries] = useState<CatalogEntry[]>([]);

  // Search results state
  const [searchResults, setSearchResults] = useState<CatalogSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [indexingTarget, setIndexingTarget] = useState<string | null>(null);

  const loadCatalogVolumes = async () => {
    try {
      const list = await invoke<CatalogVolumeSummary[]>("list_catalog_volumes");
      setVolumes(list);
      if (!browseVolume && list.length > 0) {
        setBrowseVolume(list[0]);
      } else if (browseVolume) {
        const updated = list.find((v) => v.volumeId === browseVolume.volumeId);
        setBrowseVolume(updated || list[0] || null);
      }
    } catch (err) {
      onShowError(String(err));
    }
  };

  useEffect(() => {
    loadCatalogVolumes();
  }, [drives]);

  // Load offline directory contents when browsing a specific volume
  useEffect(() => {
    if (!browseVolume) {
      setBrowseEntries([]);
      return;
    }
    invoke<CatalogEntry[]>("browse_catalog_volume", {
      volumeId: browseVolume.volumeId,
      parentRelPath: browseRelPath,
    })
      .then((items) => setBrowseEntries(items))
      .catch((err) => onShowError(String(err)));
  }, [browseVolume, browseRelPath]);

  // Perform search across all snapshots when query or filter is active
  const isSearchMode =
    searchQuery.trim().length > 0 || categoryFilter !== "all";

  useEffect(() => {
    if (!isSearchMode) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const hits = await invoke<CatalogSearchResult[]>(
          "search_offline_catalog",
          {
            query: searchQuery,
            volumeFilter: selectedVolumeId === "all" ? null : selectedVolumeId,
            categoryFilter: categoryFilter === "all" ? null : categoryFilter,
          }
        );
        setSearchResults(hits);
      } catch (err) {
        onShowError(String(err));
      } finally {
        setIsSearching(false);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedVolumeId, categoryFilter, isSearchMode, volumes]);

  // Connected external or cloud drives that can be indexed in 1 click
  const indexableConnectedDrives = useMemo(
    () => drives.filter((d) => d.mountPoint !== "/"),
    [drives]
  );

  const handleIndexDrive = async (drive: StorageDriveInfo) => {
    setIndexingTarget(drive.mountPoint);
    try {
      const summary = await invoke<CatalogVolumeSummary>(
        "index_volume_to_catalog",
        {
          mountPoint: drive.mountPoint,
          volumeName: drive.name,
          deviceType: drive.deviceType,
          fileSystem: drive.fileSystem,
          totalBytes: drive.totalBytes,
          usedBytes: drive.usedBytes,
          availableBytes: drive.availableBytes,
        }
      );
      onShowToast(
        `${summary.volumeName} indexé (${summary.totalFilesIndexed.toLocaleString(
          "fr-FR"
        )} fichiers mémorisés hors-ligne)`
      );
      await loadCatalogVolumes();
      setBrowseVolume(summary);
      setBrowseRelPath("");
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIndexingTarget(null);
    }
  };

  const handleIndexCustomFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Choisir un disque ou dossier à indexer dans le catalogue hors-ligne",
      });
      if (typeof selected === "string" && selected) {
        const folderName =
          selected.split("/").filter(Boolean).pop() || "Dossier";
        setIndexingTarget(selected);
        const summary = await invoke<CatalogVolumeSummary>(
          "index_volume_to_catalog",
          {
            mountPoint: selected,
            volumeName: folderName,
            deviceType: "folder",
            fileSystem: "APFS",
            totalBytes: 0,
            usedBytes: 0,
            availableBytes: 0,
          }
        );
        onShowToast(
          `« ${summary.volumeName} » indexé (${summary.totalFilesIndexed.toLocaleString(
            "fr-FR"
          )} fichiers)`
        );
        await loadCatalogVolumes();
        setBrowseVolume(summary);
        setBrowseRelPath("");
      }
    } catch (err) {
      onShowError(String(err));
    } finally {
      setIndexingTarget(null);
    }
  };

  const handleDeleteVolume = async (vol: CatalogVolumeSummary) => {
    try {
      await invoke("delete_catalog_volume", { volumeId: vol.volumeId });
      onShowToast(`Index « ${vol.volumeName} » retiré du catalogue.`);
      if (browseVolume?.volumeId === vol.volumeId) {
        setBrowseVolume(null);
        setBrowseRelPath("");
      }
      await loadCatalogVolumes();
    } catch (err) {
      onShowError(String(err));
    }
  };

  const handleRevealFinder = async (path: string) => {
    try {
      await invoke("reveal_in_finder", { path });
    } catch (err) {
      onShowError(String(err));
    }
  };

  const breadcrumbParts = useMemo(() => {
    if (!browseRelPath) return [];
    return browseRelPath.split("/").filter(Boolean);
  }, [browseRelPath]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-[#191919]">
      {/* ================= TOP SEARCH & FILTER BAR ================= */}
      <div className="px-5 py-3 border-b border-[#2A2A2A] bg-[#161616] flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[260px] max-w-xl">
          <Search className="w-4 h-4 text-[#787774] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher un fichier, rush ou dossier sur tous les disques (même débranchés)…"
            className="w-full pl-9 pr-8 py-1.5 rounded-xl bg-[#222222] border border-[#323232] focus:border-[#F59E0B] focus:outline-none text-xs text-[#EDEDEC] placeholder-[#787774]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#787774] hover:text-[#EDEDEC] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center gap-1 bg-[#121212] p-1 rounded-xl border border-[#282828]">
          {CATEGORY_FILTERS.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(cat.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                categoryFilter === cat.id
                  ? "bg-[#F59E0B] text-black font-semibold"
                  : "text-[#9B9A97] hover:text-[#EDEDEC]"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Add Custom Folder / Volume to Catalog */}
        <button
          onClick={handleIndexCustomFolder}
          disabled={indexingTarget !== null}
          className="px-3 py-1.5 rounded-xl bg-[#262626] hover:bg-[#303030] border border-[#383838] text-xs font-medium text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#F59E0B]" />
          <span>Indexer un dossier…</span>
        </button>
      </div>

      {/* ================= MAIN SPLIT WORKSPACE ================= */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 overflow-hidden">
        {/* LEFT COLUMN (4 cols): INDEXED DRIVES VAULT */}
        <div className="lg:col-span-4 border-r border-[#262626] flex flex-col min-h-0 overflow-hidden bg-[#161616]">
          {/* Quick Index bar for currently connected drives */}
          {indexableConnectedDrives.length > 0 && (
            <div className="p-3 border-b border-[#242424] space-y-2 shrink-0">
              <span className="text-[11px] font-semibold text-[#9B9A97] block">
                Supports branchés (Indexation 1-clic)
              </span>
              <div className="flex flex-wrap gap-1.5">
                {indexableConnectedDrives.map((d) => {
                  const isBusy = indexingTarget === d.mountPoint;
                  const alreadyIndexed = volumes.some(
                    (v) => v.lastMountPoint === d.mountPoint
                  );
                  return (
                    <button
                      key={d.id}
                      onClick={() => handleIndexDrive(d)}
                      disabled={indexingTarget !== null}
                      className="px-2.5 py-1 rounded-lg bg-[#222222] hover:bg-[#2C2C2C] border border-[#333333] text-[11px] text-[#EDEDEC] flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3 h-3 ${
                          isBusy
                            ? "animate-spin text-[#F59E0B]"
                            : alreadyIndexed
                            ? "text-[#10B981]"
                            : "text-[#F59E0B]"
                        }`}
                      />
                      <span className="truncate max-w-[120px]">{d.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Indexed Volumes Header */}
          <div className="px-3.5 py-2.5 border-b border-[#242424] flex items-center justify-between shrink-0">
            <span className="text-xs font-semibold text-[#EDEDEC]">
              Disques mémorisés ({volumes.length})
            </span>
            {isSearchMode && (
              <button
                onClick={() => setSelectedVolumeId("all")}
                className={`text-[11px] px-2 py-0.5 rounded cursor-pointer ${
                  selectedVolumeId === "all"
                    ? "bg-[#F59E0B]/20 text-[#FBBF24]"
                    : "text-[#787774] hover:text-[#EDEDEC]"
                }`}
              >
                Tous les disques
              </button>
            )}
          </div>

          {/* Indexed Volumes List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {volumes.length === 0 ? (
              <div className="p-5 rounded-xl border border-[#262626] bg-[#1C1C1C] text-center space-y-2">
                <Database className="w-6 h-6 text-[#F59E0B] mx-auto opacity-80" />
                <p className="text-xs font-medium text-[#EDEDEC]">
                  Aucun disque indexé
                </p>
                <p className="text-[11px] text-[#787774]">
                  Cliquez sur un support branché ou sur « Indexer un dossier… » pour mémoriser son contenu hors-ligne.
                </p>
              </div>
            ) : (
              volumes.map((vol) => {
                const isSelected = isSearchMode
                  ? selectedVolumeId === vol.volumeId
                  : browseVolume?.volumeId === vol.volumeId;

                return (
                  <div
                    key={vol.volumeId}
                    onClick={() => {
                      if (isSearchMode) {
                        setSelectedVolumeId((prev) =>
                          prev === vol.volumeId ? "all" : vol.volumeId
                        );
                      } else {
                        setBrowseVolume(vol);
                        setBrowseRelPath("");
                      }
                    }}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-[#242424] border-[#F59E0B]/50"
                        : "bg-[#1C1C1C] hover:bg-[#212121] border-[#2A2A2A]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {vol.deviceType === "cloud_drive" ? (
                          <Cloud className="w-4 h-4 text-[#38BDF8] shrink-0" />
                        ) : (
                          <HardDrive
                            className={`w-4 h-4 shrink-0 ${
                              vol.isOnline ? "text-[#10B981]" : "text-[#F59E0B]"
                            }`}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[#EDEDEC] truncate">
                              {vol.volumeName}
                            </span>
                            <span
                              className={`text-[10px] px-1.5 py-0.2 rounded font-medium ${
                                vol.isOnline
                                  ? "bg-[#10B981]/15 text-[#34D399]"
                                  : "bg-[#F59E0B]/15 text-[#FBBF24]"
                              }`}
                            >
                              {vol.isOnline ? "Branché" : "Hors-ligne"}
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-[#787774] mt-0.5">
                            {vol.totalFilesIndexed.toLocaleString("fr-FR")}{" "}
                            fichiers • {vol.indexedAt}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteVolume(vol);
                        }}
                        className="p-1 rounded-lg text-[#787774] hover:text-[#EF4444] hover:bg-[#2A2A2A] cursor-pointer"
                        title="Supprimer cet index hors-ligne"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN (8 cols): SEARCH RESULTS OR OFFLINE FILE BROWSER */}
        <div className="lg:col-span-8 flex flex-col min-h-0 overflow-hidden bg-[#191919]">
          {isSearchMode ? (
            <>
              <div className="px-4 py-2.5 border-b border-[#262626] flex items-center justify-between shrink-0">
                <span className="text-xs font-semibold text-[#EDEDEC]">
                  {isSearching
                    ? "Recherche dans les index…"
                    : `${searchResults.length} résultat(s) trouvé(s)`}
                </span>
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setCategoryFilter("all");
                    setSelectedVolumeId("all");
                  }}
                  className="text-xs text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
                >
                  Réinitialiser
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {isSearching ? (
                  <ScanningRadar
                    icon={<Search className="w-8 h-8 text-[#3B82F6]" />}
                    title="Recherche instantanée dans le coffre hors-ligne…"
                    subtitle={searchQuery ? `Requête : « ${searchQuery} »` : undefined}
                    color="blue"
                    stages={[
                      "Consultation des index de métadonnées hors-ligne...",
                      "Comparaison des motifs de fichiers débranchés...",
                      "Localisation des supports de stockage physiques...",
                    ]}
                  />
                ) : searchResults.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#787774]">
                    Aucun fichier ou dossier correspondant dans vos disques indexés.
                  </div>
                ) : (
                  searchResults.map((hit, idx) => (
                    <div
                      key={`${hit.volumeId}-${hit.relPath}-${idx}`}
                      className="p-2.5 rounded-xl bg-[#1F1F1F] border border-[#2B2B2B] flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {hit.isDir ? (
                          <Folder className="w-4 h-4 text-[#60A5FA] shrink-0" />
                        ) : (
                          <File className="w-4 h-4 text-[#9B9A97] shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-[#EDEDEC] truncate">
                              {hit.name}
                            </span>
                            <span
                              className={`text-[10px] font-medium px-2 py-0.5 rounded-md flex items-center gap-1 shrink-0 ${
                                hit.isOnline
                                  ? "bg-[#10B981]/15 text-[#34D399] border border-[#10B981]/30"
                                  : "bg-[#F59E0B]/15 text-[#FBBF24] border border-[#F59E0B]/30"
                              }`}
                            >
                              <HardDrive className="w-3 h-3" />
                              <span>
                                {hit.volumeName} ({hit.isOnline ? "Branché" : "Débranché"})
                              </span>
                            </span>
                          </div>
                          <p className="text-[10px] font-mono text-[#787774] truncate mt-0.5">
                            {hit.relPath}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {hit.sizeBytes > 0 && (
                          <span className="text-xs font-mono text-[#EDEDEC]">
                            {formatBytes(hit.sizeBytes)}
                          </span>
                        )}
                        {hit.isOnline && (
                          <button
                            onClick={() =>
                              handleRevealFinder(hit.fullPathIfOnline)
                            }
                            className="p-1.5 rounded-lg bg-[#161616] hover:bg-[#2C2C2C] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
                            title="Révéler dans le Finder"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : !browseVolume ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <p className="text-xs text-[#787774]">
                Sélectionnez ou indexez un disque à gauche pour explorer son arborescence hors-ligne.
              </p>
            </div>
          ) : (
            <>
              {/* Offline Breadcrumb Header */}
              <div className="px-4 py-2.5 border-b border-[#262626] flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-1 text-xs overflow-x-auto min-w-0">
                  <button
                    onClick={() => setBrowseRelPath("")}
                    className={`px-2 py-0.5 rounded-md cursor-pointer ${
                      browseRelPath === ""
                        ? "bg-[#262626] text-[#EDEDEC] font-semibold"
                        : "text-[#9B9A97] hover:text-[#EDEDEC]"
                    }`}
                  >
                    {browseVolume.volumeName}
                  </button>

                  {breadcrumbParts.map((part, i) => {
                    const targetRel = breadcrumbParts.slice(0, i + 1).join("/");
                    const isLast = i === breadcrumbParts.length - 1;
                    return (
                      <div key={targetRel} className="flex items-center gap-1 shrink-0">
                        <ChevronRight className="w-3.5 h-3.5 text-[#555555]" />
                        <button
                          onClick={() => setBrowseRelPath(targetRel)}
                          className={`px-2 py-0.5 rounded-md cursor-pointer ${
                            isLast
                              ? "bg-[#262626] text-[#EDEDEC] font-semibold"
                              : "text-[#9B9A97] hover:text-[#EDEDEC]"
                          }`}
                        >
                          {part}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {browseRelPath !== "" && (
                  <button
                    onClick={() => {
                      const parts = browseRelPath.split("/").filter(Boolean);
                      parts.pop();
                      setBrowseRelPath(parts.join("/"));
                    }}
                    className="px-2.5 py-1 rounded-lg bg-[#232323] hover:bg-[#2D2D2D] border border-[#333333] text-xs text-[#EDEDEC] flex items-center gap-1 shrink-0 cursor-pointer"
                  >
                    <ArrowUpLeft className="w-3.5 h-3.5" />
                    <span>Parent</span>
                  </button>
                )}
              </div>

              {/* Offline Folder Contents */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {browseEntries.length === 0 ? (
                  <div className="py-12 text-center text-xs text-[#787774]">
                    Ce dossier est vide dans l&apos;index.
                  </div>
                ) : (
                  browseEntries.map((entry, idx) => {
                    const fullOnlinePath = `${browseVolume.lastMountPoint.replace(
                      /\/$/,
                      ""
                    )}/${entry.relPath}`;

                    return (
                      <div
                        key={entry.relPath + idx}
                        onClick={() => {
                          if (entry.isDir) {
                            setBrowseRelPath(entry.relPath);
                          }
                        }}
                        className={`p-2.5 rounded-xl bg-[#1E1E1E] border border-[#292929] flex items-center justify-between gap-3 ${
                          entry.isDir
                            ? "hover:bg-[#252525] cursor-pointer"
                            : ""
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          {entry.isDir ? (
                            <Folder className="w-4 h-4 text-[#60A5FA] shrink-0" />
                          ) : (
                            <File className="w-4 h-4 text-[#9B9A97] shrink-0" />
                          )}
                          <span className="text-xs font-medium text-[#EDEDEC] truncate">
                            {entry.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {entry.sizeBytes > 0 && (
                            <span className="text-xs font-mono text-[#9B9A97]">
                              {formatBytes(entry.sizeBytes)}
                            </span>
                          )}
                          {browseVolume.isOnline && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRevealFinder(fullOnlinePath);
                              }}
                              className="p-1.5 rounded-lg bg-[#161616] hover:bg-[#2C2C2C] text-[#9B9A97] hover:text-[#EDEDEC] cursor-pointer"
                              title="Révéler dans le Finder"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

