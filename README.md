# HardHub — macOS Storage Control Center & Disk Diagnostics

<p align="center">
  <img src="app-icon.svg" width="120" height="120" alt="HardHub App Icon" />
</p>

<p align="center">
  <strong>Centre de Contrôle de Stockage Intuitif, Éjection Sécurisée & Diagnostics Avancés pour macOS</strong>
  <br />
  <em>Conçu pour remplacer les utilitaires payants et à abonnement par une suite native, rapide et respectueuse de la vie privée.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.0.0-10B981.svg?style=flat-square" alt="Version 1.0.0" />
  <img src="https://img.shields.io/badge/Platform-macOS%20(Apple%20Silicon)-3B82F6.svg?style=flat-square" alt="macOS" />
  <img src="https://img.shields.io/badge/Engine-Rust%20%2B%20Tauri%20v2-F59E0B.svg?style=flat-square" alt="Rust Tauri" />
  <img src="https://img.shields.io/badge/UI-React%2018%20%7C%20Tailwind%20CSS-191919.svg?style=flat-square" alt="React Tailwind" />
  <img src="https://img.shields.io/badge/License-MIT-emerald.svg?style=flat-square" alt="MIT License" />
</p>

---

## Écosystème Hard Suite (macOS)

**HardHub** complète la **Hard Suite**, une famille d'applications macOS dédiées à la gestion, la sécurité et la pérennité du stockage :

| Application | Rôle | Fonctionnalités Clés | Dépôt GitHub |
| :--- | :--- | :--- | :--- |
| **[Hardback](https://github.com/Ward-Milan/hardback)** | **Ingest Sécurisé (Tournage)** | Déchargement multi-destinations en cascade, vérification physique bit-à-bit (XXH64, XXH3, SHA-256), manifestes ASC-MHL et compagnon barre des menus. | [Ward-Milan/hardback](https://github.com/Ward-Milan/hardback) |
| **[HardRecover](https://github.com/Ward-Milan/hardrecover)** | **Sauvetage & Réparation (Urgence)** | Récupération de cartes mémoires formatées (ExFAT / File Carving), reconstruction chirurgicale de conteneurs vidéo/audio MP4/MOV corrompus et clonage 5 passes. | [Ward-Milan/hardrecover](https://github.com/Ward-Milan/hardrecover) |
| **[HardHub](https://github.com/Ward-Milan/hardhub)** | **Centre de Contrôle (Quotidien)** | Cartographie visuelle Space Lens, catalogue de disques hors-ligne, détection de doublons (SHA-256), gros fichiers, désinstallateur d'applications résiduelles et Eject Doctor. | [Ward-Milan/hardhub](https://github.com/Ward-Milan/hardhub) |

---

## Fonctionnalités Clés de HardHub

### 1. Mes Supports & Eject Doctor
- Détection instantanée des volumes internes Apple Silicon et externes (cartes SD/CFexpress, SSD USB-C/Thunderbolt, disques durs externes).
- **Éjection Propre en 1 Clic** : `sync` préalable du cache disque macOS pour prévenir toute perte de métadonnées.
- **Eject Doctor** : Si macOS refuse d'éjecter un disque ("disque en cours d'utilisation"), HardHub inspecte les processus bloquants via `lsof` et permet de les libérer d'un simple clic.
- **Tout Éjecter** : Raccourci global pour démonter l'ensemble des disques externes simultanément en toute sécurité.
- **Chiffrement APFS/FileVault en 1 Clic** : Protection par mot de passe des volumes externes sans ligne de commande.

### 2. Space Lens (Explorateur Visuel de Stockage)
- Visualisation interactive par arborescence imbriquée et barres proportionnelles de l'espace disque.
- Navigation fluide d'un dossier à l'autre avec calcul des sous-totaux en arrière-plan.
- Révélation directe dans le Finder macOS.

### 3. Catalogue de Disques Hors-Ligne
- Indexation rapide de vos disques externes ou cartes mémoires.
- Permet de chercher et retrouver n'importe quel fichier même lorsque le support n'est pas branché au Mac.

### 4. Détecteur de Doublons & Photos Identiques
- Analyse en deux passes : pré-filtrage par taille de fichier puis hachage cryptographique **SHA-256** pour garantir zéro faux positif.
- Sélection intelligente des copies superflues pour libérer du stockage sans risque.

### 5. Scanner de Gros Fichiers
- Tri instantané des fichiers les plus volumineux (vidéos ProRes, archives, images disques) avec filtres de taille configurables.

### 6. Désinstallateur d'Applications Résiduelles
- Détection des applications installées sur le Mac.
- Balayage automatique des caches cachés, conteneurs, préférences et résidus dans `~/Library/Application Support`, `~/Library/Caches` et `~/Library/Preferences`.

### 7. Outils & Purge
- Purge sécurisée des corbeilles masquées (`.Trashes`) sur chaque support externe.
- Nettoyage des fichiers fantômes macOS (`.DS_Store`, `._*` AppleDouble).

### 8. Auto-Updater Intégré
- Vérification automatique et silencieuse des nouvelles versions au démarrage.
- Téléchargement en tâche de fond avec jauge de progression.
- Montage du DMG, remplacement atomique dans `/Applications` et redémarrage automatique en un clic.

---

## Téléchargement Direct (DMG)

Le package d'installation autonome macOS (Apple Silicon) est disponible :

<p align="center">
  <a href="https://github.com/Ward-Milan/hardhub/releases/latest/download/HardHub_1.0.0_macOS.dmg">
    <img src="https://img.shields.io/badge/Télécharger_HardHub_v1.0.0-10B981?style=for-the-badge&logo=apple&logoColor=white" height="42" alt="Télécharger HardHub DMG" />
  </a>
</p>

### Installation sur macOS
1. Téléchargez et ouvrez **`HardHub_1.0.0_macOS.dmg`**.
2. Glissez-déposez **HardHub.app** dans votre dossier **/Applications**.
3. *Note Gatekeeper (macOS Sequoia / Tahoe)* : L'application étant open-source et signée ad-hoc sans certificat commercial, si macOS affiche un avertissement au premier lancement, exécutez dans le Terminal :
   ```bash
   xattr -cr /Applications/HardHub.app
   ```
   (ou autorisez l'application dans *Réglages Système > Confidentialité et sécurité > Ouvrir quand même*).

---

## Architecture Technique

- **Frontend** : React 18, TypeScript, Tailwind CSS, Lucide Icons (SVG natifs, 0 emojis).
- **Backend & Moteur Natif** : Rust 2021, Tauri v2.
- **Appels Système macOS** : `diskutil`, `hdiutil`, `lsof`, `fstatfs`, `FSGetVolumeInfo`, API DiskArbitration / CoreStorage.

---

## Compilation depuis les sources

```bash
# Cloner le dépôt
git clone https://github.com/Ward-Milan/hardhub.git
cd hardhub

# Installer les dépendances
npm install

# Lancer en mode développement
npm run tauri dev

# Compiler le DMG de production
npm run tauri build
```

---

## Licence

Distribué sous licence MIT. Développé pour la communauté des créateurs, DITs et monteurs sur macOS.

