import { DriveCard } from "../DriveCard";
import { SdCardIcon } from "../Logo";
import type { StorageDriveInfo } from "../types";

export interface DrivesViewProps {
  externalDrives: StorageDriveInfo[];
  internalDrives: StorageDriveInfo[];
  isEjecting: string | null;
  onRefresh: () => void;
  onEject: (drive: StorageDriveInfo) => void;
  onRevealFinder: (path: string) => void;
  onOpenSpaceLens: (mountPoint: string) => void;
  onQuickPurgeTrash: (drive: StorageDriveInfo) => void;
  onOpenBlockerInspector: (drive: StorageDriveInfo) => void;
  onOpenEncryptModal: (drive: StorageDriveInfo) => void;
}

export function DrivesView({
  externalDrives,
  internalDrives,
  isEjecting,
  onRefresh,
  onEject,
  onRevealFinder,
  onOpenSpaceLens,
  onQuickPurgeTrash,
  onOpenBlockerInspector,
  onOpenEncryptModal,
}: DrivesViewProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#9B9A97]">
            Disques externes &amp; Cartes mémoire ({externalDrives.length})
          </span>
        </div>

        {externalDrives.length === 0 ? (
          <div className="rounded-xl border border-[#2B2B2B] bg-[#202020]/40 p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SdCardIcon className="w-5 h-5 text-[#787774]" />
              <span className="text-xs text-[#9B9A97]">
                Aucun disque externe ou carte SD branché.
              </span>
            </div>
            <button
              onClick={onRefresh}
              className="px-3 py-1 rounded-lg bg-[#262626] hover:bg-[#303030] border border-[#353535] text-xs text-[#EDEDEC] cursor-pointer"
            >
              Actualiser
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {externalDrives.map((drive) => (
              <DriveCard
                key={drive.id}
                drive={drive}
                isEjecting={isEjecting === drive.id}
                onEject={onEject}
                onRevealFinder={onRevealFinder}
                onOpenSpaceLens={onOpenSpaceLens}
                onQuickPurgeTrash={onQuickPurgeTrash}
                onOpenBlockerInspector={onOpenBlockerInspector}
                onEncryptDrive={onOpenEncryptModal}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <span className="text-xs font-semibold text-[#9B9A97]">
          Stockage interne Mac ({internalDrives.length})
        </span>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {internalDrives.map((drive) => (
            <DriveCard
              key={drive.id}
              drive={drive}
              onRevealFinder={onRevealFinder}
              onOpenSpaceLens={onOpenSpaceLens}
              onQuickPurgeTrash={onQuickPurgeTrash}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
