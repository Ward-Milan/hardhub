import { Info, Shield, X } from "lucide-react";

export interface DisclaimerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DisclaimerModal({ isOpen, onClose }: DisclaimerModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#202020] border border-[#2F2F2F] rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#2C2C2C] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-[#3B82F6]" />
            <h3 className="text-sm font-semibold text-[#EDEDEC]">
              Conditions d&apos;utilisation &amp; Mentions Légales
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#2A2A2A] text-[#9B9A97] hover:text-[#EDEDEC] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4 text-xs text-[#9B9A97] leading-relaxed">
          <div className="p-3.5 rounded-xl bg-[#282828] border border-[#353535] space-y-1.5">
            <p className="font-semibold text-[#EDEDEC] flex items-center gap-2">
              <Info className="w-4 h-4 text-[#3B82F6]" />
              Logiciel Local &amp; Respect de la Confidentialité
            </p>
            <p>
              HardHub et l&apos;ensemble de la Hard Suite fonctionnent de manière 100% autonome et hors-ligne sur votre machine. Aucune donnée personnelle, statistique d&apos;usage ou télémétrie n&apos;est transmise à un serveur tiers.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-[#EDEDEC]">Responsabilité de l&apos;utilisateur</h4>
            <p>
              Les outils proposés par Hard Suite (manipulation de systèmes de fichiers, éjection forcée, formatage, nettoyage de caches et récupération de données) interagissent directement avec vos périphériques de stockage.
            </p>
            <p>
              L&apos;utilisateur demeure seul responsable des actions menées sur ses supports. Il est vivement conseillé de maintenir des sauvegardes vérifiées et à jour avant toute opération de maintenance ou de reformatage de disque.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#191919] border border-[#2C2C2C] space-y-1 font-mono text-[11px] text-[#787774]">
            <p className="text-[#9B9A97] font-sans font-semibold">Licence MIT — Clause de non-garantie</p>
            <p>
              LE LOGICIEL EST FOURNI « TEL QUEL », SANS AUCUNE GARANTIE D&apos;AUCUNE SORTE, EXPRESSE OU IMPLICITE, Y COMPRIS MAIS NON LIMITÉ AUX GARANTIES DE QUALITÉ MARCHANDE OU D&apos;ADÉQUATION À UN USAGE PARTICULIER.
            </p>
          </div>
        </div>

        <div className="px-6 py-3.5 bg-[#191919] border-t border-[#2C2C2C] flex items-center justify-between text-xs">
          <span className="text-[#787774]">Hard Suite v1.0 • Open Source</span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-[#EDEDEC] text-[#191919] hover:bg-white transition-colors cursor-pointer"
          >
            Compris
          </button>
        </div>
      </div>
    </div>
  );
}
