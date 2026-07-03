document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('url-input');
  const analyseBtn = document.getElementById('analyse-btn');
  const errorMessage = document.getElementById('error-message');
  
  const previewSection = document.getElementById('preview-section');
  const videoThumbnail = document.getElementById('video-thumbnail');
  const videoDuration = document.getElementById('video-duration');
  const videoTitle = document.getElementById('video-title');
  const videoChannel = document.getElementById('video-channel');
  
  const downloadBtn = document.getElementById('download-btn');
  
  // Search results elements
  const searchSection = document.getElementById('search-section');
  const searchResultsList = document.getElementById('search-results-list');

  // Playlist elements
  const playlistPreviewSection = document.getElementById('playlist-preview-section');
  const playlistTitle = document.getElementById('playlist-title');
  const playlistCount = document.getElementById('playlist-count');
  const playlistDownloadBtn = document.getElementById('playlist-download-btn');
  const playlistSelectAll = document.getElementById('playlist-select-all');
  const playlistSelectedCount = document.getElementById('playlist-selected-count');
  const playlistItemsList = document.getElementById('playlist-items-list');

  // Progress section elements
  const progressSection = document.getElementById('progress-section');
  const progressStatus = document.getElementById('progress-status');
  const progressPercent = document.getElementById('progress-percent');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressSpeed = document.getElementById('progress-speed');
  const progressEta = document.getElementById('progress-eta');
  const conversionInfo = document.getElementById('conversion-info');
  const playlistProgressDetails = document.getElementById('playlist-progress-details');
  const playlistProgressTrackIndex = document.getElementById('playlist-progress-track-index');
  const playlistProgressTrackTitle = document.getElementById('playlist-progress-track-title');

  let currentVideo = null;
  let currentPlaylist = null;
  let activeEventSource = null;

  // Reusable helper to manage custom dropdown selectors
  function setupFormatDropdown({
    trigger,
    label,
    panel,
    searchInput,
    grid,
    qualityContainer,
    qualityGrid
  }) {
    let currentFormat = 'mp4';
    let currentQuality = '1080';

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('hidden');
      trigger.parentElement.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
        panel.classList.add('hidden');
        trigger.parentElement.classList.remove('open');
      }
    });

    const tabBtns = panel.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const tab = btn.dataset.tab;
        const items = grid.querySelectorAll('.format-grid-item');
        items.forEach(item => {
          if (item.classList.contains(`${tab}-format`)) {
            item.classList.remove('hidden');
          } else {
            item.classList.add('hidden');
          }
        });
        filterItems();
      });
    });

    searchInput.addEventListener('input', filterItems);

    function filterItems() {
      const q = searchInput.value.toLowerCase().trim();
      const activeTab = panel.querySelector('.tab-btn.active').dataset.tab;
      const items = grid.querySelectorAll('.format-grid-item');
      
      items.forEach(item => {
        const ext = item.dataset.ext;
        const matchesTab = item.classList.contains(`${activeTab}-format`);
        const matchesQuery = ext.includes(q);
        
        if (matchesTab && matchesQuery) {
          item.classList.remove('hidden');
        } else {
          item.classList.add('hidden');
        }
      });
    }

    const items = grid.querySelectorAll('.format-grid-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        items.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        currentFormat = item.dataset.ext;
        panel.classList.add('hidden');
        trigger.parentElement.classList.remove('open');

        const isVideo = ['mp4', 'mkv', 'avi'].includes(currentFormat);
        if (isVideo) {
          qualityContainer.classList.remove('hidden');
        } else {
          qualityContainer.classList.add('hidden');
        }

        updateLabel();
      });
    });

    const chips = qualityGrid.querySelectorAll('.quality-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        chips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        
        currentQuality = chip.dataset.quality;
        updateLabel();
      });
    });

    function updateLabel() {
      const isVideo = ['mp4', 'mkv', 'avi'].includes(currentFormat);
      if (isVideo) {
        label.textContent = `.${currentFormat} (Video - ${currentQuality}p)`;
      } else {
        label.textContent = `.${currentFormat} (Audio)`;
      }
    }

    return {
      getValues: () => ({ format: currentFormat, quality: currentQuality }),
      reset: () => {
        currentFormat = 'mp4';
        currentQuality = '1080';
        items.forEach(i => {
          if (i.dataset.ext === 'mp4') i.classList.add('active');
          else i.classList.remove('active');
        });
        chips.forEach(c => {
          if (c.dataset.quality === '1080') c.classList.add('active');
          else c.classList.remove('active');
        });
        tabBtns.forEach(b => {
          if (b.dataset.tab === 'video') b.classList.add('active');
          else b.classList.remove('active');
        });
        items.forEach(i => {
          if (i.classList.contains('video-format')) i.classList.remove('hidden');
          else i.classList.add('hidden');
        });
        searchInput.value = '';
        qualityContainer.classList.remove('hidden');
        updateLabel();
      }
    };
  }

  // Initialize dropdown controllers
  const singleDropdown = setupFormatDropdown({
    trigger: document.getElementById('format-select-trigger'),
    label: document.getElementById('selected-format-label'),
    panel: document.getElementById('format-dropdown-panel'),
    searchInput: document.getElementById('format-search-input'),
    grid: document.getElementById('formats-grid'),
    qualityContainer: document.getElementById('quality-selector-container'),
    qualityGrid: document.getElementById('quality-chips-grid')
  });

  const playlistDropdown = setupFormatDropdown({
    trigger: document.getElementById('playlist-format-select-trigger'),
    label: document.getElementById('playlist-selected-format-label'),
    panel: document.getElementById('playlist-format-dropdown-panel'),
    searchInput: document.getElementById('playlist-format-search-input'),
    grid: document.getElementById('playlist-formats-grid'),
    qualityContainer: document.getElementById('playlist-quality-selector-container'),
    qualityGrid: document.getElementById('playlist-quality-chips-grid')
  });

  // Handle URL Analysis or Search
  async function analyzeVideo() {
    const url = urlInput.value.trim();
    if (!url) {
      showError('Veuillez entrer une URL YouTube ou un titre à chercher.');
      return;
    }

    hideError();
    resetPreview();
    resetProgress();
    setLoading(true);

    try {
      const response = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erreur lors de la récupération des détails.');
      }

      if (data.type === 'search') {
        renderSearchResults(data.results);
      } else if (data.type === 'playlist') {
        renderPlaylistPreview(data);
      } else {
        // Single video
        currentVideo = data;
        currentVideo.url = url;

        // Populate preview UI
        videoThumbnail.src = data.thumbnail;
        videoDuration.textContent = data.duration;
        videoTitle.textContent = data.title;
        videoChannel.textContent = data.uploader;

        // Show preview
        previewSection.classList.remove('hidden');
        previewSection.scrollIntoView({ behavior: 'smooth' });
      }

    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Render search results grid
  function renderSearchResults(results) {
    searchResultsList.innerHTML = '';
    
    if (results.length === 0) {
      searchResultsList.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 20px;">Aucun résultat trouvé.</p>';
    } else {
      results.forEach(video => {
        const card = document.createElement('div');
        card.className = 'search-item-card';
        card.innerHTML = `
          <div class="search-item-thumb">
            <img src="${video.thumbnail}" alt="${video.title}" />
            <span class="duration-badge">${video.duration}</span>
          </div>
          <div class="search-item-info">
            <h4 class="search-item-title">${video.title}</h4>
            <span class="search-item-channel">${video.uploader}</span>
          </div>
        `;
        card.addEventListener('click', () => {
          urlInput.value = video.url;
          analyzeVideo();
        });
        searchResultsList.appendChild(card);
      });
    }

    searchSection.classList.remove('hidden');
    searchSection.scrollIntoView({ behavior: 'smooth' });
  }

  // Render playlist preview and checkbox list
  function renderPlaylistPreview(playlist) {
    currentPlaylist = playlist;
    playlistTitle.textContent = playlist.title;
    playlistCount.textContent = `${playlist.entries.length} vidéos`;
    playlistItemsList.innerHTML = '';

    playlist.entries.forEach((entry, idx) => {
      const item = document.createElement('div');
      item.className = 'playlist-item';
      item.innerHTML = `
        <input type="checkbox" class="playlist-item-checkbox" data-index="${idx}" id="pl-item-${idx}" checked />
        <span class="playlist-item-index">${idx + 1}</span>
        <div class="playlist-item-thumb">
          <img src="${entry.thumbnail}" alt="${entry.title}" />
        </div>
        <div class="playlist-item-details">
          <div class="playlist-item-title">${entry.title}</div>
        </div>
        <span class="playlist-item-duration">${entry.duration}</span>
      `;
      item.addEventListener('click', (e) => {
        if (e.target.tagName !== 'INPUT') {
          const cb = item.querySelector('.playlist-item-checkbox');
          cb.checked = !cb.checked;
          updatePlaylistSelectionCount();
        }
      });
      playlistItemsList.appendChild(item);
    });

    const checkboxes = playlistItemsList.querySelectorAll('.playlist-item-checkbox');
    checkboxes.forEach(cb => {
      cb.addEventListener('change', updatePlaylistSelectionCount);
    });

    playlistSelectAll.checked = true;
    updatePlaylistSelectionCount();

    playlistPreviewSection.classList.remove('hidden');
    playlistPreviewSection.scrollIntoView({ behavior: 'smooth' });
  }

  function updatePlaylistSelectionCount() {
    const checkboxes = playlistItemsList.querySelectorAll('.playlist-item-checkbox');
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    playlistSelectedCount.textContent = `${checked.length} / ${checkboxes.length} sélectionnées`;
    
    playlistDownloadBtn.disabled = checked.length === 0;
    playlistSelectAll.checked = checked.length === checkboxes.length;
  }

  playlistSelectAll.addEventListener('change', () => {
    const checkboxes = playlistItemsList.querySelectorAll('.playlist-item-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = playlistSelectAll.checked;
    });
    updatePlaylistSelectionCount();
  });

  function setButtonsDisabled(disabled) {
    const formatTrigger = document.getElementById('format-select-trigger');
    const playlistFormatTrigger = document.getElementById('playlist-format-select-trigger');
    
    if (formatTrigger) formatTrigger.disabled = disabled;
    if (playlistFormatTrigger) playlistFormatTrigger.disabled = disabled;
    
    downloadBtn.disabled = disabled;
    playlistDownloadBtn.disabled = disabled;
    playlistSelectAll.disabled = disabled;
    const checkboxes = playlistItemsList.querySelectorAll('.playlist-item-checkbox');
    checkboxes.forEach(cb => cb.disabled = disabled);

    const chips = document.querySelectorAll('.quality-chip');
    chips.forEach(chip => chip.disabled = disabled);
  }

  async function startDownload() {
    if (!currentVideo) return;

    const { format, quality } = singleDropdown.getValues();

    resetProgress();
    progressSection.classList.remove('hidden');
    progressSection.scrollIntoView({ behavior: 'smooth' });

    try {
      setButtonsDisabled(true);

      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentVideo.url,
          format: format,
          quality: quality,
          title: currentVideo.title
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Impossible d\'initier le téléchargement.');
      }

      const downloadId = data.id;
      listenToProgress(downloadId);

    } catch (err) {
      showDownloadError(err.message);
      setButtonsDisabled(false);
    }
  }

  async function startPlaylistDownload() {
    if (!currentPlaylist) return;

    const { format, quality } = playlistDropdown.getValues();

    const checkboxes = playlistItemsList.querySelectorAll('.playlist-item-checkbox');
    const selectedEntries = Array.from(checkboxes)
      .filter(cb => cb.checked)
      .map(cb => {
        const idx = parseInt(cb.dataset.index);
        return currentPlaylist.entries[idx];
      });

    if (selectedEntries.length === 0) {
      alert('Veuillez sélectionner au moins une vidéo à télécharger.');
      return;
    }

    resetProgress();
    progressSection.classList.remove('hidden');
    progressSection.scrollIntoView({ behavior: 'smooth' });

    try {
      setButtonsDisabled(true);

      const response = await fetch('/api/download-playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: selectedEntries,
          format: format,
          quality: quality,
          playlistTitle: currentPlaylist.title
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Impossible d\'initier le téléchargement de la playlist.');
      }

      const downloadId = data.id;
      listenToProgress(downloadId);

    } catch (err) {
      showDownloadError(err.message);
      setButtonsDisabled(false);
    }
  }

  // Server-Sent Events listener for real-time download status
  function listenToProgress(id) {
    if (activeEventSource) {
      activeEventSource.close();
    }

    activeEventSource = new EventSource(`/api/progress/${id}`);

    activeEventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      updateProgressUI(data);

      if (data.status === 'completed') {
        activeEventSource.close();
        activeEventSource = null;
        triggerFileDownload(id);
        setButtonsDisabled(false);
      } else if (data.status === 'failed') {
        activeEventSource.close();
        activeEventSource = null;
        showDownloadError(data.error || 'Le téléchargement a échoué.');
        setButtonsDisabled(false);
      }
    };

    activeEventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      activeEventSource.close();
      activeEventSource = null;
      showDownloadError('Connexion perdue avec le serveur de téléchargement.');
      setButtonsDisabled(false);
    };
  }

  // Update UI components with state from SSE
  function updateProgressUI(data) {
    const percent = Math.round(data.progress || 0);
    progressPercent.textContent = `${percent}%`;
    progressBarFill.style.width = `${percent}%`;
    progressSpeed.textContent = data.speed || 'N/A';
    progressEta.textContent = data.eta || 'N/A';

    // Badge formatting
    progressStatus.className = 'status-badge'; // reset
    if (data.status === 'downloading') {
      progressStatus.classList.add('status-downloading');
      progressStatus.textContent = 'Téléchargement...';
      conversionInfo.classList.add('hidden');
    } else if (data.status === 'converting') {
      progressStatus.classList.add('status-converting');
      progressStatus.textContent = 'Conversion...';
      conversionInfo.classList.remove('hidden');
    } else if (data.status === 'completed') {
      progressStatus.classList.add('status-completed');
      progressStatus.textContent = 'Terminé !';
      conversionInfo.classList.add('hidden');
    } else if (data.status === 'failed') {
      progressStatus.classList.add('status-failed');
      progressStatus.textContent = 'Échoué';
      conversionInfo.classList.add('hidden');
    }

    // Playlist detailed progress
    if (data.currentIndex && data.total) {
      playlistProgressDetails.classList.remove('hidden');
      playlistProgressTrackIndex.textContent = `Vidéo ${data.currentIndex} / ${data.total}`;
      playlistProgressTrackTitle.textContent = data.currentTitle || 'Téléchargement en cours...';
    } else {
      playlistProgressDetails.classList.add('hidden');
    }
  }

  // Request browser file retrieval
  function triggerFileDownload(id) {
    const downloadUrl = `/api/retrieve/${id}`;
    
    // Create a hidden link and simulate click to prompt file download dialogue
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // UI Helpers
  function setLoading(loading) {
    analyseBtn.disabled = loading;
    urlInput.disabled = loading;
    const spinner = analyseBtn.querySelector('.btn-spinner');
    const btnText = analyseBtn.querySelector('span');

    if (loading) {
      spinner.classList.remove('hidden');
      btnText.classList.add('hidden');
    } else {
      spinner.classList.add('hidden');
      btnText.classList.remove('hidden');
    }
  }

  function showError(msg) {
    errorMessage.textContent = msg;
    errorMessage.classList.remove('hidden');
  }

  function hideError() {
    errorMessage.textContent = '';
    errorMessage.classList.add('hidden');
  }

  // Error alert styling helper
  function showDownloadError(msg) {
    progressStatus.className = 'status-badge status-failed';
    progressStatus.textContent = 'Erreur';
    progressPercent.textContent = '0%';
    progressBarFill.style.width = '0%';
    progressBarFill.style.background = 'var(--error-color)';
    progressSpeed.textContent = 'N/A';
    progressEta.textContent = 'N/A';
    conversionInfo.classList.add('hidden');
    playlistProgressDetails.classList.add('hidden');
    
    alert(`Erreur de téléchargement: ${msg}`);
  }

  function resetPreview() {
    previewSection.classList.add('hidden');
    videoThumbnail.src = '';
    videoDuration.textContent = '00:00';
    videoTitle.textContent = '';
    videoChannel.textContent = '';
    currentVideo = null;

    playlistPreviewSection.classList.add('hidden');
    playlistTitle.textContent = 'Titre de la Playlist';
    playlistCount.textContent = '0 vidéos';
    playlistItemsList.innerHTML = '';
    currentPlaylist = null;

    searchSection.classList.add('hidden');
    searchResultsList.innerHTML = '';

    // Reset dropdown defaults
    singleDropdown.reset();
    playlistDropdown.reset();
  }

  function resetProgress() {
    progressSection.classList.add('hidden');
    progressStatus.className = 'status-badge status-downloading';
    progressStatus.textContent = 'En attente...';
    progressPercent.textContent = '0%';
    progressBarFill.style.width = '0%';
    progressBarFill.style.background = 'var(--primary-gradient)';
    progressSpeed.textContent = '0 B/s';
    progressEta.textContent = 'En attente';
    conversionInfo.classList.add('hidden');
    playlistProgressDetails.classList.add('hidden');
    
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
  }

  // Event Listeners
  analyseBtn.addEventListener('click', analyzeVideo);
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      analyzeVideo();
    }
  });

  downloadBtn.addEventListener('click', () => startDownload());
  playlistDownloadBtn.addEventListener('click', () => startPlaylistDownload());
});
