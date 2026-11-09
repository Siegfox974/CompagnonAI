// Application desktop : démarre le serveur local puis ouvre la fenêtre.
// Le site en fond est chargé dans un <webview>, ce qui contourne l'interdiction
// d'affichage en iframe (X-Frame-Options) que posent la plupart des sites.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { app, BrowserWindow, session, shell } from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* pas de .env : valeurs par défaut */
}

// Cookies, cache vidéo, etc. restent dans le dossier du projet (pas sur C:).
app.setPath('userData', path.join(ROOT, 'data', 'electron'));
// Le cache HTTP (morceaux de vidéos des sites) est plafonné à 300 Mo, puis vidé à chaque fermeture.
app.commandLine.appendSwitch('disk-cache-size', String(300 * 1024 * 1024));

app.on('web-contents-created', (_e, contents) => {
  // Sécurité du <webview> : pas de preload, pas de Node, isolation stricte.
  contents.on('will-attach-webview', (_ev, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });
  // Toutes les pop-ups du site en fond sont bloquées (ce sont presque toujours des pubs).
  if (contents.getType() === 'webview') contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

/**
 * Bloqueur de pubs et de pisteurs pour le site en fond (listes EasyList/Ghostery,
 * téléchargées au premier lancement puis mises en cache dans data/).
 */
async function enableAdblock() {
  try {
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      path: path.join(ROOT, 'data', 'adblock-cache.bin'),
      read: fs.readFile,
      write: fs.writeFile,
    });
    blocker.enableBlockingInSession(session.fromPartition('persist:site'));
    console.log('Bloqueur de pubs actif.');
  } catch (err) {
    console.warn('Bloqueur de pubs indisponible :', err.message);
  }
}

const { ready } = await import('../server/index.js');

app.whenReady().then(async () => {
  // On n'attend pas plus de 8 s le téléchargement des listes au premier lancement.
  await Promise.race([enableAdblock(), new Promise((r) => setTimeout(r, 8000))]);
  const url = await ready;
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    backgroundColor: '#120a16',
    autoHideMenuBar: true,
    title: 'CompagnonAI',
    webPreferences: { webviewTag: true, contextIsolation: true, nodeIntegration: false },
  });
  // Les liens de l'interface (pas du site en fond) s'ouvrent dans le navigateur par défaut.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.loadURL(url);
});

app.on('window-all-closed', () => app.quit());

// Vide le cache du site en fond avant de quitter (les cookies et la session sont conservés).
let cacheCleared = false;
app.on('before-quit', (event) => {
  if (cacheCleared) return;
  event.preventDefault();
  cacheCleared = true;
  const done = () => app.quit();
  Promise.race([
    Promise.all([session.fromPartition('persist:site').clearCache(), session.defaultSession.clearCache()]),
    new Promise((r) => setTimeout(r, 3000)),
  ]).then(done, done);
});
