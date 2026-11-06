import React from "react";
import {
  HardDrive,
  Lock,
  Unlock,
  Zap,
  Trash2,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  Search,
  Cloud,
} from "lucide-react";
import { StorageDrive } from "./types";
import { SdCardIcon, SsdIcon, HddIcon } from "./Logo";

function DriveTypeIcon({
  deviceType,
  className = "w-5 h-5",
}: {
  deviceType: string;
  className?: string;
}) {
  if (deviceType === "sd_card") return <SdCardIcon className={className} />;
  if (deviceType === "external_hdd") return <HddIcon className={className} />;
  if (deviceType === "cloud_drive") return <Cloud className={className} />;
  return <SsdIcon className={className} />;
}

interface DriveCardProps {
  drive: StorageDrive;
  isEjecting?: boolean;
  onEject?: (drive: StorageDrive) => void;
  onRevealFinder: (mountPoint: string) => void;
  onOpenSpaceLens: (mountPoint: string) => void;
  onQuickPurgeTrash: (drive: StorageDrive) => void;
  onOpenBlockerInspector?: (drive: StorageDrive) => void;
  onEncryptDrive?: (drive: StorageDrive) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 o";
  const k = 1024;
  const sizes = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

const EjectSvgIcon: React.FC<{ className?: string }> = ({ className = "w-3 h-3" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 4l7 10H5l7-10z" />
    <path d="M5 18h14" />
  </svg>
);

export const DriveCard: React.FC<DriveCardProps> = ({
  drive,
  isEjecting = false,
  onEject,
  onRevealFinder,
  onOpenSpaceLens,
  onQuickPurgeTrash,
  onOpenBlockerInspector,
  onEncryptDrive,
}) => {
  const usedPct =
    drive.totalBytes > 0
      ? Math.min(100, Math.round((drive.usedBytes / drive.totalBytes) * 100))
      : 0;

  const isCriticallyFull = usedPct >= 90;
  const isWarningFull = usedPct >= 75 && !isCriticallyFull;

  // Icon tint according to drive type
  const iconBg = !drive.isRemovable
    ? "bg-[#10B981]/15 border-[#10B981]/30 text-[#34D399]"
    : drive.deviceType === "sd_card"
    ? "bg-[#F59E0B]/15 border-[#F59E0B]/30 text-[#FBBF24]"
    : "bg-[#3B82F6]/15 border-[#3B82F6]/30 text-[#60A5FA]";

  return (
    <div className="bg-[#202020] hover:bg-[#232323] border border-[#2F2F2F] hover:border-[#383838] rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all shadow-sm">
      {/* Top Header: Identity & Main Action Buttons */}
      <div className="flex items-start justify-between gap-3">
        {/* Identity */}
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          <div className={`w-11 h-11 rounded-xl border flex items-center justify-center shrink-0 ${iconBg}`}>
            <DriveTypeIcon deviceType={drive.deviceType} className="w-6 h-6" />
          </div>

          <div className="min-w-0 flex-1">
            {/* Drive Name */}
            <h3
              className="font-bold text-sm text-[#EDEDEC] truncate leading-tight"
              title={drive.name}
            >
              {drive.name}
            </h3>

            {/* Badges line: FileSystem + Mount point / BSD */}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-[#282828] text-[#93C5FD] border border-[#333333]">
                {drive.fileSystem}
              </span>

              {drive.isEncrypted ? (
                <span
                  className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#10B981]/15 border border-[#10B981]/30 text-[#34D399] flex items-center gap-1"
                  title="Protection FileVault active"
                >
                  <Lock className="w-2.5 h-2.5" />
                  <span>FileVault</span>
                </span>
              ) : (
                <span
                  className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#252525] border border-[#303030] text-[#787774] flex items-center gap-1"
                  title="Non chiffre"
                >
                  <Unlock className="w-2.5 h-2.5 text-[#787774]" />
                  <span>Clair</span>
                </span>
              )}

              <span className="text-[10px] font-mono text-[#787774]">
                /dev/{drive.bsdName}
              </span>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {drive.isRemovable && onEject && (
            <button
              onClick={() => onEject(drive)}
              disabled={isEjecting}
              className="px-2.5 py-1.5 rounded-lg bg-[#282828] hover:bg-[#F59E0B] hover:text-black border border-[#363636] text-xs font-medium text-[#EDEDEC] flex items-center gap-1 transition-colors cursor-pointer"
              title="Ejection intelligente securisee"
            >
              <EjectSvgIcon className="w-3 h-3" />
              <span>{isEjecting ? "..." : "Ejecter"}</span>
            </button>
          )}

          <button
            onClick={() => onRevealFinder(drive.mountPoint)}
            className="px-2.5 py-1.5 rounded-lg bg-[#262626] hover:bg-[#303030] border border-[#333333] text-xs font-medium text-[#EDEDEC] flex items-center gap-1 transition-colors cursor-pointer"
            title="Ouvrir dans le Finder"
          >
            <ExternalLink className="w-3 h-3 text-[#9B9A97]" />
            <span>Finder</span>
          </button>

          <button
            onClick={() => onOpenSpaceLens(drive.mountPoint)}
            className="px-3 py-1.5 rounded-lg bg-[#3B82F6]/15 hover:bg-[#3B82F6]/25 border border-[#3B82F6]/35 text-xs font-medium text-[#60A5FA] flex items-center gap-1 transition-colors cursor-pointer"
            title="Analyser la repartition du stockage dans Space Lens"
          >
            <span>Space Lens</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Hardware Link Speed & Status Badges */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <span
          className={`text-[10px] font-mono px-2.5 py-1 rounded-md border flex items-center gap-1.5 whitespace-nowrap ${
            drive.isCableBottlenecked
              ? "bg-[#EF4444]/15 border-[#EF4444]/40 text-[#FCA5A5]"
              : "bg-[#181818] border-[#2A2A2A] text-[#9B9A97]"
          }`}
          title={drive.cableWarning || drive.linkSpeedLabel}
        >
          <Zap
            className={`w-3 h-3 shrink-0 ${
              drive.isCableBottlenecked ? "text-[#EF4444]" : "text-[#10B981]"
            }`}
          />
          <span className="font-medium text-[#EDEDEC]">{drive.linkSpeedLabel}</span>
        </span>

        {/* Cable Bottleneck Warning if present */}
        {drive.isCableBottlenecked && drive.cableWarning && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#EF4444]/15 border border-[#EF4444]/30 text-[#FCA5A5] flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-[#EF4444] shrink-0" />
            <span>{drive.cableWarning}</span>
          </span>
        )}

        {/* Hidden Trash Quick Clean Badge */}
        {drive.hiddenTrashBytes > 0 && (
          <button
            onClick={() => onQuickPurgeTrash(drive)}
            className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#F59E0B]/15 hover:bg-[#F59E0B]/25 border border-[#F59E0B]/35 text-[#FBBF24] flex items-center gap-1 transition-colors cursor-pointer"
            title="Vider la corbeille cachee .Trashes"
          >
            <Trash2 className="w-3 h-3" />
            <span>Corbeille : {formatBytes(drive.hiddenTrashBytes)}</span>
          </button>
        )}

        {/* Encrypt button if removable and not encrypted */}
        {drive.canEncrypt && !drive.isEncrypted && onEncryptDrive && (
          <button
            onClick={() => onEncryptDrive(drive)}
            className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[#3B82F6]/15 hover:bg-[#3B82F6]/25 border border-[#3B82F6]/30 text-[#60A5FA] flex items-center gap-1 transition-colors cursor-pointer"
            title="Verrouiller ce disque avec un mot de passe (Chiffrement APFS)"
          >
            <ShieldCheck className="w-3 h-3" />
            <span>Chiffrer</span>
          </button>
        )}

        {/* Blocker inspector if external */}
        {drive.isRemovable && onOpenBlockerInspector && (
          <button
            onClick={() => onOpenBlockerInspector(drive)}
            className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[#181818] hover:bg-[#252525] border border-[#2A2A2A] text-[#9B9A97] hover:text-[#EDEDEC] flex items-center gap-1 transition-colors cursor-pointer ml-auto"
            title="Identifier les processus ou applications bloquant l'ejection"
          >
            <Lock className="w-2.5 h-2.5 text-[#F59E0B]" />
            <span>Qui bloque ?</span>
          </button>
        )}
      </div>

      {/* Storage Gauge & Usage Metrics */}
      <div className="space-y-2 pt-1 border-t border-[#272727]">
        <div className="flex items-center justify-between text-xs gap-2">
          <div className="text-[#9B9A97] truncate">
            <strong className="text-sm font-bold text-[#EDEDEC]">
              {formatBytes(drive.availableBytes)}
            </strong>{" "}
            <span>libres sur {formatBytes(drive.totalBytes)}</span>
          </div>

          <div className="font-mono text-xs text-[#787774] shrink-0">
            <span>{formatBytes(drive.usedBytes)} occupes</span>{" "}
            <strong className={`font-bold ${
              isCriticallyFull ? "text-[#EF4444]" : isWarningFull ? "text-[#F59E0B]" : "text-[#10B981]"
            }`}>
              ({usedPct}%)
            </strong>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2 rounded-full bg-[#141414] overflow-hidden border border-[#272727]">
          <div
            style={{ width: `${usedPct}%` }}
            className={`h-full rounded-full transition-all duration-300 ${
              isCriticallyFull
                ? "bg-[#EF4444]"
                : isWarningFull
                ? "bg-[#F59E0B]"
                : "bg-[#10B981]"
            }`}
          />
        </div>
      </div>
    </div>
  );
};

export default DriveCard;
