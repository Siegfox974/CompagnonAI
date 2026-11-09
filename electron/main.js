// Application desktop : démarre le serveur local puis ouvre la fenêtre.
// Le site en fond est chargé dans un <webview>, ce qui contourne l'interdiction
// d'affichage en iframe (X-Frame-Options) que posent la plupart des sites.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, shell } from 'electron';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* pas de .env : valeurs par défaut */
}

// Cookies, cache vidéo, etc. restent dans le dossier du projet (pas sur C:).
app.setPath('userData', path.join(ROOT, 'data', 'electron'));

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

const { ready } = await import('../server/index.js');

app.whenReady().then(async () => {
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
