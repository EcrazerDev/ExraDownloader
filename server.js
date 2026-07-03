const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Global downloads registry
const activeDownloads = new Map();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helpers
const ffmpegDir = path.dirname(ffmpegPath);

function buildYtDlpArgs(url, format, quality, outputTemplate) {
  const args = [
    '-m', 'yt_dlp',
    '--no-playlist',
    '--ffmpeg-location', ffmpegDir,
    '-o', outputTemplate
  ];

  const audioFormats = ['mp3', 'flac', 'wav', 'ogg'];
  const videoFormats = ['mp4', 'mkv', 'avi'];

  if (audioFormats.includes(format)) {
    args.push('--extract-audio');
    if (format === 'mp3') {
      args.push('--audio-format', 'mp3', '--audio-quality', '320k');
    } else if (format === 'flac') {
      args.push('--audio-format', 'flac');
    } else if (format === 'wav') {
      args.push('--audio-format', 'wav');
    } else if (format === 'ogg') {
      args.push('--audio-format', 'vorbis');
    }
  } else if (videoFormats.includes(format)) {
    const resHeight = quality || '1080';
    args.push('-f', `bestvideo[height<=${resHeight}]+bestaudio/best[height<=${resHeight}]`);
    
    if (format === 'mp4') {
      args.push('--merge-output-format', 'mp4');
    } else if (format === 'mkv') {
      args.push('--merge-output-format', 'mkv');
    } else if (format === 'avi') {
      args.push('--recode-video', 'avi');
    }
  }

  args.push(url);
  return args;
}

function formatDuration(seconds) {
  if (!seconds) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Endpoints
// 1. Get video details
function isUrl(str) {
  if (str.startsWith('http://') || str.startsWith('https://') || str.startsWith('www.')) {
    return true;
  }
  const urlPattern = /^[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}(\/\S*)?$/;
  return urlPattern.test(str);
}

function getEntryThumbnail(entry) {
  if (entry.thumbnail) return entry.thumbnail;
  if (entry.thumbnails && entry.thumbnails.length) {
    return entry.thumbnails[entry.thumbnails.length - 1].url;
  }
  if (entry.id && entry.id.length === 11 && !entry.id.includes(' ')) {
    return `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`;
  }
  return 'https://images.unsplash.com/photo-1614680376573-df3480f0c6ff?w=360';
}

function extractFlatPlaylist(url) {
  return new Promise((resolve, reject) => {
    const args = ['-m', 'yt_dlp', '--dump-json', '--flat-playlist', url];
    const ytDlp = spawn('python', args);

    let stdoutData = '';
    let stderrData = '';

    ytDlp.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    ytDlp.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    ytDlp.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderrData || `yt-dlp exited with code ${code}`));
      }

      try {
        const lines = stdoutData.trim().split('\n').filter(l => l.trim());
        const entries = lines.map(line => JSON.parse(line));
        resolve(entries);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function getSingleVideoInfo(url, res) {
  const args = ['-m', 'yt_dlp', '--dump-json', '--no-playlist', url];
  const ytDlp = spawn('python', args);

  let stdoutData = '';
  let stderrData = '';

  ytDlp.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  ytDlp.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  ytDlp.on('close', (code) => {
    if (code !== 0) {
      console.error(`yt-dlp info failed with code ${code}. Error: ${stderrData}`);
      return res.status(500).json({ error: 'Impossible de récupérer les informations de la vidéo.' });
    }

    try {
      const info = JSON.parse(stdoutData);
      res.json({
        type: 'video',
        id: info.id,
        title: info.title,
        thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails.length ? info.thumbnails[info.thumbnails.length - 1].url : `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`),
        duration: formatDuration(info.duration),
        uploader: info.uploader || info.channel || 'Inconnu',
        views: info.view_count ? info.view_count.toLocaleString() : null,
      });
    } catch (err) {
      console.error('Failed to parse yt-dlp JSON output', err);
      res.status(500).json({ error: 'Erreur lors de l\'analyse des détails de la vidéo.' });
    }
  });
}

app.post('/api/info', (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL ou recherche requise' });
  }

  let targetUrl = url.trim();

  if (!isUrl(targetUrl)) {
    // Treat as search query
    const searchQuery = `ytsearch10:${targetUrl}`;
    extractFlatPlaylist(searchQuery)
      .then(entries => {
        const results = entries.map(entry => ({
          id: entry.id,
          title: entry.title,
          thumbnail: getEntryThumbnail(entry),
          duration: formatDuration(entry.duration),
          uploader: entry.uploader || entry.channel || 'Inconnu',
          url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`
        }));
        res.json({
          type: 'search',
          results
        });
      })
      .catch(err => {
        console.error('Search failed:', err);
        res.status(500).json({ error: 'La recherche a échoué ou n\'a retourné aucun résultat.' });
      });
  } else {
    // Direct URL
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    const isPlaylistUrl = targetUrl.includes('list=') || 
                          targetUrl.includes('/sets/') || 
                          targetUrl.includes('/album/') || 
                          targetUrl.includes('/playlist/');

    if (isPlaylistUrl) {
      extractFlatPlaylist(targetUrl)
        .then(entries => {
          if (entries.length === 0) {
            throw new Error('Playlist vide ou introuvable');
          }

          const results = entries.map(entry => ({
            id: entry.id,
            title: entry.title,
            thumbnail: getEntryThumbnail(entry),
            duration: formatDuration(entry.duration),
            uploader: entry.uploader || entry.channel || 'Inconnu',
            url: entry.url || `https://www.youtube.com/watch?v=${entry.id}`
          }));

          const playlistTitle = entries[0].playlist_title || entries[0].playlist || 'Playlist';

          res.json({
            type: 'playlist',
            title: playlistTitle,
            entries: results
          });
        })
        .catch(err => {
          console.error('Playlist extraction failed, falling back to single video:', err);
          getSingleVideoInfo(targetUrl, res);
        });
    } else {
      getSingleVideoInfo(targetUrl, res);
    }
  }
});

// 2. Start download
app.post('/api/download', (req, res) => {
  const { url, format, quality, title } = req.body;
  if (!url || !format) {
    return res.status(400).json({ error: 'URL et format sont requis' });
  }

  const audioFormats = ['mp3', 'flac', 'wav', 'ogg'];
  const videoFormats = ['mp4', 'mkv', 'avi'];

  if (!audioFormats.includes(format) && !videoFormats.includes(format)) {
    return res.status(400).json({ error: 'Format invalide' });
  }

  const id = uuidv4();
  const safeTitle = (title || 'video').replace(/[\\/:*?"<>|]/g, '_'); // Sanitization for filename
  const ext = format;
  
  const outputTemplate = path.join(downloadsDir, `${id}.%(ext)s`);
  const args = buildYtDlpArgs(url, format, quality, outputTemplate);

  console.log(`Starting download ${id} with args:`, args);

  // Spawn download process
  const child = spawn('python', args);

  // Create download record
  const downloadRecord = {
    id,
    status: 'downloading',
    progress: 0,
    speed: '0 B/s',
    eta: 'En attente',
    title: safeTitle,
    ext,
    filepath: null,
    error: null,
    clients: []
  };

  activeDownloads.set(id, downloadRecord);

  // Parse yt-dlp download progress
  // Format: [download]   2.3% of ~50.23MiB at  3.45MiB/s ETA 00:15
  const progressRegex = /\[download\]\s+([\d.]+)%\s+of\s+(?:~)?([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)/;
  // Format during post-processing: [ExtractAudio] Destination: ... or [Merger] Merging formats into ...
  const postProcessRegex = /\[(ExtractAudio|Merger|ffmpeg|VideoConvertor)\]/;

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      const match = progressRegex.exec(line);
      if (match) {
        downloadRecord.progress = parseFloat(match[1]);
        downloadRecord.speed = match[3];
        downloadRecord.eta = match[4];
        downloadRecord.status = 'downloading';
        notifyClients(id);
      } else if (postProcessRegex.test(line)) {
        downloadRecord.status = 'converting';
        downloadRecord.progress = 99; // Almost done
        downloadRecord.speed = 'N/A';
        downloadRecord.eta = 'Fin de conversion...';
        notifyClients(id);
      }
    }
  });

  child.stderr.on('data', (data) => {
    console.error(`[yt-dlp stderr ${id}]:`, data.toString());
  });

  child.on('close', (code) => {
    if (code === 0) {
      // Find final file that starts with download ID
      fs.readdir(downloadsDir, (err, files) => {
        if (err) {
          downloadRecord.status = 'failed';
          downloadRecord.error = 'Erreur lors de la lecture du dossier de téléchargement.';
          notifyClients(id);
          return;
        }

        const downloadedFile = files.find(file => file.startsWith(id));
        if (downloadedFile) {
          downloadRecord.status = 'completed';
          downloadRecord.progress = 100;
          downloadRecord.filepath = path.join(downloadsDir, downloadedFile);
          notifyClients(id);
        } else {
          downloadRecord.status = 'failed';
          downloadRecord.error = 'Fichier téléchargé introuvable.';
          notifyClients(id);
        }
      });
    } else {
      downloadRecord.status = 'failed';
      downloadRecord.error = `yt-dlp s'est arrêté avec le code d'erreur ${code}`;
      notifyClients(id);
    }
  });

  res.json({ id });
});

// Helper functions for playlist downloads
function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const stream = fs.createWriteStream(outPath);

    archive.on('error', err => reject(err));
    stream.on('close', () => resolve());

    archive.pipe(stream);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function downloadSinglePlaylistEntry(downloadId, tempDir, entry, format, quality, downloadRecord) {
  return new Promise((resolve, reject) => {
    const videoUrl = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;
    const outputTemplate = path.join(tempDir, `${entry.id}.%(ext)s`);
    const args = buildYtDlpArgs(videoUrl, format, quality, outputTemplate);

    const child = spawn('python', args);

    const progressRegex = /\[download\]\s+([\d.]+)%\s+of\s+(?:~)?([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)/;
    const postProcessRegex = /\[(ExtractAudio|Merger|ffmpeg|VideoConvertor)\]/;

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const match = progressRegex.exec(line);
        if (match) {
          const currentVideoProgress = parseFloat(match[1]);
          const baseProgress = (downloadRecord.currentIndex - 1) * 100;
          downloadRecord.progress = Math.round((baseProgress + currentVideoProgress) / downloadRecord.total);
          downloadRecord.speed = match[3];
          downloadRecord.eta = match[4];
          notifyClients(downloadId);
        } else if (postProcessRegex.test(line)) {
          downloadRecord.eta = 'Fin de conversion...';
          notifyClients(downloadId);
        }
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        fs.readdir(tempDir, (err, files) => {
          if (err) return reject(err);
          const downloadedFile = files.find(file => file.startsWith(entry.id));
          if (downloadedFile) {
            const ext = path.extname(downloadedFile);
            const safeTitle = entry.title.replace(/[\\/:*?"<>|]/g, '_');
            const oldPath = path.join(tempDir, downloadedFile);
            const newPath = path.join(tempDir, `${safeTitle}${ext}`);
            try {
              if (fs.existsSync(newPath)) {
                const dupPath = path.join(tempDir, `${safeTitle}_${entry.id}${ext}`);
                fs.renameSync(oldPath, dupPath);
              } else {
                fs.renameSync(oldPath, newPath);
              }
              resolve();
            } catch (renameErr) {
              resolve();
            }
          } else {
            reject(new Error('File not found after download'));
          }
        });
      } else {
        reject(new Error(`Exit code ${code}`));
      }
    });
  });
}

async function downloadPlaylistEntries(id, entries, format, quality) {
  const downloadRecord = activeDownloads.get(id);
  if (!downloadRecord) return;

  const tempDir = path.join(downloadsDir, id);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const failedEntries = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (downloadRecord.status === 'failed') break;

    downloadRecord.currentIndex = i + 1;
    downloadRecord.currentTitle = entry.title;
    downloadRecord.progress = Math.round((i / entries.length) * 100);
    downloadRecord.speed = '0 B/s';
    downloadRecord.eta = 'Démarrage...';
    notifyClients(id);

    try {
      await downloadSinglePlaylistEntry(id, tempDir, entry, format, quality, downloadRecord);
    } catch (err) {
      console.error(`Failed to download entry ${entry.id}:`, err);
      failedEntries.push(entry.title);
    }
  }

  if (downloadRecord.status !== 'failed') {
    downloadRecord.status = 'converting';
    downloadRecord.progress = 99;
    downloadRecord.eta = 'Compression ZIP...';
    downloadRecord.speed = 'N/A';
    notifyClients(id);

    const zipFilePath = path.join(downloadsDir, `${id}.zip`);
    try {
      await zipDirectory(tempDir, zipFilePath);
      fs.rmSync(tempDir, { recursive: true, force: true });

      downloadRecord.status = 'completed';
      downloadRecord.progress = 100;
      downloadRecord.filepath = zipFilePath;
      if (failedEntries.length > 0) {
        downloadRecord.title = `${downloadRecord.title} (${entries.length - failedEntries.length}/${entries.length})`;
      }
      notifyClients(id);
    } catch (zipErr) {
      console.error('Zipping failed:', zipErr);
      downloadRecord.status = 'failed';
      downloadRecord.error = 'Erreur lors de la création du fichier ZIP.';
      notifyClients(id);
    }
  }
}

// 2.b Start playlist download
app.post('/api/download-playlist', (req, res) => {
  const { entries, format, quality, playlistTitle } = req.body;
  if (!entries || !Array.isArray(entries) || entries.length === 0 || !format) {
    return res.status(400).json({ error: 'Entrées et format requis' });
  }

  const audioFormats = ['mp3', 'flac', 'wav', 'ogg'];
  const videoFormats = ['mp4', 'mkv', 'avi'];

  if (!audioFormats.includes(format) && !videoFormats.includes(format)) {
    return res.status(400).json({ error: 'Format invalide' });
  }

  const id = uuidv4();
  const safeTitle = (playlistTitle || 'playlist').replace(/[\\/:*?"<>|]/g, '_');

  const downloadRecord = {
    id,
    status: 'downloading',
    progress: 0,
    currentIndex: 0,
    total: entries.length,
    currentTitle: '',
    speed: '0 B/s',
    eta: 'En attente',
    title: safeTitle,
    ext: 'zip',
    filepath: null,
    error: null,
    clients: []
  };

  activeDownloads.set(id, downloadRecord);

  // Start download asynchronously
  downloadPlaylistEntries(id, entries, format, quality);

  res.json({ id });
});

// 3. SSE Progress endpoint
app.get('/api/progress/:id', (req, res) => {
  const { id } = req.params;
  const download = activeDownloads.get(id);

  if (!download) {
    return res.status(404).json({ error: 'Téléchargement introuvable' });
  }

  // Setup SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Send initial state
  res.write(`data: ${JSON.stringify(getSafeDownloadObject(download))}\n\n`);

  download.clients.push(res);

  req.on('close', () => {
    download.clients = download.clients.filter(client => client !== res);
  });
});

// 4. Retrieve downloaded file
app.get('/api/retrieve/:id', (req, res) => {
  const { id } = req.params;
  const download = activeDownloads.get(id);

  if (!download) {
    return res.status(404).send('Téléchargement introuvable');
  }

  if (download.status !== 'completed' || !download.filepath || !fs.existsSync(download.filepath)) {
    return res.status(400).send('Le téléchargement n\'est pas complété ou le fichier est manquant.');
  }

  const clientFilename = `${download.title}.${download.ext}`;

  res.download(download.filepath, clientFilename, (err) => {
    if (err) {
      console.error(`Error sending file ${id} to client:`, err);
    }

    // Always attempt to delete file after download completes or errors
    try {
      if (fs.existsSync(download.filepath)) {
        fs.unlinkSync(download.filepath);
        console.log(`Deleted temp file ${download.filepath}`);
      }
    } catch (unlinkErr) {
      console.error(`Failed to delete temp file ${download.filepath}:`, unlinkErr);
    }

    // Clean registry record
    activeDownloads.delete(id);
  });
});

// Notification helper
function notifyClients(id) {
  const download = activeDownloads.get(id);
  if (!download || !download.clients.length) return;

  const data = JSON.stringify(getSafeDownloadObject(download));
  download.clients.forEach(client => {
    client.write(`data: ${data}\n\n`);
  });
}

function getSafeDownloadObject(download) {
  return {
    id: download.id,
    status: download.status,
    progress: download.progress,
    speed: download.speed,
    eta: download.eta,
    title: download.title,
    error: download.error,
    currentIndex: download.currentIndex,
    total: download.total,
    currentTitle: download.currentTitle
  };
}

// Scheduled Cleanup: Remove any orphaned temp files/folders older than 30 minutes
setInterval(() => {
  const now = Date.now();
  fs.readdir(downloadsDir, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(downloadsDir, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return;
        // 30 minutes threshold
        if (now - stats.mtimeMs > 30 * 60 * 1000) {
          try {
            fs.rmSync(filePath, { recursive: true, force: true });
            console.log(`Cleaned up orphaned file or folder: ${file}`);
          } catch (rmErr) {
            console.error(`Failed to delete ${filePath}:`, rmErr);
          }
        }
      });
    });
  });
}, 10 * 60 * 1000); // Check every 10 minutes

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
  console.log(`Using FFMPEG path: ${ffmpegPath}`);
});
