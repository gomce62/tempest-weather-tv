/**
 * Morro Bay Doppler Radar Controller using RainViewer Weather Maps API + Leaflet
 * Docs: https://www.rainviewer.com/api/weather-maps-api.html
 */

const RAINVIEWER_API_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const MORRO_BAY_COORDS = [35.3658, -120.85];
const CARD_DEFAULT_ZOOM = 7;
const MODAL_DEFAULT_ZOOM = 7;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // RainViewer refreshes every 5 minutes
const FRAME_DELAY_MS = 650;
const LATEST_FRAME_DWELL_MS = 1600;
const RADAR_OPACITY = 0.78;
const DARK_BASEMAP_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export class MorroBayRadarController {
  constructor(els) {
    this.els = els || {};
    this.cardMap = null;
    this.modalMap = null;
    this.host = 'https://tilecache.rainviewer.com';
    this.frames = [];
    this.frameIdx = 0;
    this.isPlaying = true;
    this.cardLayers = new Map();
    this.modalLayers = new Map();
    this.activeCardLayer = null;
    this.activeModalLayer = null;
    this.playTimer = null;
    this.modalOpen = false;
    this.timezone = 'America/Los_Angeles';
    this.refreshTimer = null;
    this.loadingToken = 0;
    this.tileSize = (typeof window !== 'undefined' && window.devicePixelRatio >= 2) ? 512 : 256;
  }

  init() {
    this.bindUi();
    if (typeof window === 'undefined' || !window.L) {
      this.setStatus('Map N/A', false);
      return;
    }
    this.initCardMap();
    this.fetchRadarFrames();
    this.refreshTimer = setInterval(() => this.fetchRadarFrames(), REFRESH_INTERVAL_MS);
  }

  setTimezone(tz) {
    if (tz) this.timezone = tz;
  }

  createMarkerIcon(showLabel = false) {
    return window.L.divIcon({
      className: 'radar-morro-marker-wrap',
      html: `<div class="radar-morro-dot"></div>${showLabel ? '<span class="radar-morro-label">Morro Bay</span>' : ''}`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  initCardMap() {
    const container = this.els.cardMapEl;
    if (!container || this.cardMap || !window.L) return;

    this.cardMap = window.L.map(container, {
      center: MORRO_BAY_COORDS,
      zoom: CARD_DEFAULT_ZOOM,
      minZoom: 5,
      maxZoom: 10,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: false,
      boxZoom: false,
      keyboard: false,
    });

    window.L.tileLayer(DARK_BASEMAP_URL, {
      maxZoom: 19,
      className: 'radar-basemap-tiles',
    }).addTo(this.cardMap);

    window.L.marker(MORRO_BAY_COORDS, {
      icon: this.createMarkerIcon(false),
      interactive: false,
      zIndexOffset: 500,
    }).addTo(this.cardMap);
  }

  initModalMap() {
    const container = this.els.modalMapEl;
    if (!container || !window.L) return;
    if (this.modalMap) {
      this.modalMap.invalidateSize();
      return;
    }

    this.modalMap = window.L.map(container, {
      center: MORRO_BAY_COORDS,
      zoom: MODAL_DEFAULT_ZOOM,
      minZoom: 4,
      maxZoom: 11,
      zoomControl: false,
      attributionControl: false,
    });

    window.L.tileLayer(DARK_BASEMAP_URL, {
      maxZoom: 19,
      className: 'radar-basemap-tiles',
    }).addTo(this.modalMap);

    window.L.marker(MORRO_BAY_COORDS, {
      icon: this.createMarkerIcon(true),
      interactive: false,
      zIndexOffset: 500,
    }).addTo(this.modalMap);
  }

  bindUi() {
    const {
      btnCardPlay,
      btnCardExpand,
      btnModalPlay,
      btnModalPrev,
      btnModalNext,
      btnModalZoomIn,
      btnModalZoomOut,
      btnModalRecenter,
      btnModalClose,
      modalBackdrop,
      modalSlider,
    } = this.els;

    if (btnCardPlay) {
      btnCardPlay.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePlay();
      });
    }

    if (btnCardExpand) {
      btnCardExpand.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openFullView();
      });
    }

    if (this.els.cardMapWrap) {
      this.els.cardMapWrap.addEventListener('dblclick', () => this.openFullView());
    }

    if (btnModalPlay) {
      btnModalPlay.addEventListener('click', () => this.togglePlay());
    }
    if (btnModalPrev) {
      btnModalPrev.addEventListener('click', () => {
        this.stop();
        this.showFrame(this.frameIdx - 1);
      });
    }
    if (btnModalNext) {
      btnModalNext.addEventListener('click', () => {
        this.stop();
        this.showFrame(this.frameIdx + 1);
      });
    }
    if (btnModalZoomIn) {
      btnModalZoomIn.addEventListener('click', () => this.modalMap && this.modalMap.zoomIn());
    }
    if (btnModalZoomOut) {
      btnModalZoomOut.addEventListener('click', () => this.modalMap && this.modalMap.zoomOut());
    }
    if (btnModalRecenter) {
      btnModalRecenter.addEventListener('click', () => {
        if (this.modalMap) this.modalMap.setView(MORRO_BAY_COORDS, MODAL_DEFAULT_ZOOM, { animate: true });
      });
    }
    if (btnModalClose) {
      btnModalClose.addEventListener('click', () => this.closeFullView());
    }
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) this.closeFullView();
      });
    }
    if (modalSlider) {
      modalSlider.addEventListener('input', (e) => {
        this.stop();
        const idx = Number(e.target.value);
        if (!Number.isNaN(idx)) this.showFrame(idx);
      });
    }
  }

  async fetchRadarFrames() {
    try {
      const res = await fetch(RAINVIEWER_API_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const past = Array.isArray(json?.radar?.past) ? json.radar.past : [];
      if (!past.length) throw new Error('No radar frames available');

      this.host = json.host || 'https://tilecache.rainviewer.com';
      this.frames = past;

      this.pruneUnusedLayers(this.cardMap, this.cardLayers);
      this.pruneUnusedLayers(this.modalMap, this.modalLayers);

      if (this.els.modalSlider) {
        this.els.modalSlider.max = String(Math.max(0, this.frames.length - 1));
      }

      // Start at latest frame, then auto-play loop
      const startIdx = this.frames.length - 1;
      await this.showFrame(startIdx);
      if (this.isPlaying) {
        this.scheduleNextFrame(LATEST_FRAME_DWELL_MS);
      }
    } catch (err) {
      console.warn('RainViewer radar load warning:', err);
      if (!this.frames.length) {
        this.setStatus('Radar unavailable');
      }
    }
  }

  pruneUnusedLayers(map, layerCache) {
    if (!map) {
      layerCache.clear();
      return;
    }
    const validPaths = new Set(this.frames.map((f) => f.path));
    for (const [path, layer] of layerCache.entries()) {
      if (!validPaths.has(path)) {
        if (map.hasLayer(layer)) map.removeLayer(layer);
        if (this.activeCardLayer === layer) this.activeCardLayer = null;
        if (this.activeModalLayer === layer) this.activeModalLayer = null;
        layerCache.delete(path);
      }
    }
  }

  buildLayer(frame) {
    // RainViewer Free Weather Maps API: color scheme 2 (Universal Blue), smooth=1, snow=1, maxNativeZoom=7
    const url = `${this.host}${frame.path}/${this.tileSize}/{z}/{x}/{y}/2/1_1.png`;
    return window.L.tileLayer(url, {
      tileSize: 256,
      opacity: 0,
      maxNativeZoom: 7,
      maxZoom: 12,
      zIndex: 10,
    });
  }

  ensureLayerOnMap(map, layerCache, frame) {
    if (!map || !frame) return Promise.resolve(null);
    const existing = layerCache.get(frame.path);
    if (existing) return Promise.resolve(existing);

    const layer = this.buildLayer(frame);
    layerCache.set(frame.path, layer);

    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(layer);
      };
      const timer = setTimeout(done, 2500);
      layer.once('load', done);
      layer.addTo(map);
    });
  }

  wrapIdx(idx) {
    if (!this.frames.length) return 0;
    const len = this.frames.length;
    return ((idx % len) + len) % len;
  }

  formatFrameTime(epochSec) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: this.timezone || undefined,
      }).format(new Date(epochSec * 1000));
    } catch {
      return new Date(epochSec * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
  }

  setStatus(text, isLatest = false) {
    if (this.els.cardTimeEl) this.els.cardTimeEl.textContent = text;
    if (this.els.modalTimeEl) this.els.modalTimeEl.textContent = text;
    if (this.els.cardLiveBadge) {
      this.els.cardLiveBadge.classList.toggle('is-live', isLatest);
      this.els.cardLiveBadge.textContent = isLatest ? 'LIVE' : 'PAST';
    }
    if (this.els.modalLiveBadge) {
      this.els.modalLiveBadge.classList.toggle('is-live', isLatest);
      this.els.modalLiveBadge.textContent = isLatest ? 'LATEST RADAR' : 'PAST RADAR';
    }
  }

  updateFrameUi(idx) {
    const frame = this.frames[idx];
    if (!frame) return;
    const isLatest = idx === this.frames.length - 1;
    const timeStr = this.formatFrameTime(frame.time);
    const ageMins = Math.max(0, Math.round((this.frames[this.frames.length - 1].time - frame.time) / 60));
    const modalText = isLatest ? `${timeStr} · Latest` : `${timeStr} · -${ageMins}m`;

    if (this.els.cardTimeEl) this.els.cardTimeEl.textContent = timeStr;
    if (this.els.modalTimeEl) this.els.modalTimeEl.textContent = modalText;
    if (this.els.cardLiveBadge) {
      this.els.cardLiveBadge.classList.toggle('is-live', isLatest);
      this.els.cardLiveBadge.textContent = isLatest ? 'LIVE' : `-${ageMins}m`;
    }
    if (this.els.modalLiveBadge) {
      this.els.modalLiveBadge.classList.toggle('is-live', isLatest);
      this.els.modalLiveBadge.textContent = isLatest ? 'LIVE' : `-${ageMins} MIN`;
    }

    const pct = this.frames.length > 1 ? (idx / (this.frames.length - 1)) * 100 : 100;
    if (this.els.cardProgressFill) {
      this.els.cardProgressFill.style.width = `${pct.toFixed(1)}%`;
    }
    if (this.els.modalSlider) {
      this.els.modalSlider.value = String(idx);
    }
  }

  updatePlayButtons() {
    const playIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20"></polygon></svg>`;
    const pauseIcon = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    if (this.els.btnCardPlay) {
      this.els.btnCardPlay.innerHTML = this.isPlaying ? pauseIcon : playIcon;
      this.els.btnCardPlay.title = this.isPlaying ? 'Pause radar loop' : 'Play radar loop';
      this.els.btnCardPlay.setAttribute('aria-label', this.els.btnCardPlay.title);
    }
    if (this.els.btnModalPlay) {
      this.els.btnModalPlay.innerHTML = this.isPlaying ? `${pauseIcon}<span>Pause</span>` : `${playIcon}<span>Play</span>`;
    }
  }

  async showFrame(targetIdx) {
    if (!this.frames.length) return;
    const idx = this.wrapIdx(targetIdx);
    const frame = this.frames[idx];
    const token = ++this.loadingToken;
    this.frameIdx = idx;
    this.updateFrameUi(idx);

    const activeMap = this.modalOpen && this.modalMap ? this.modalMap : this.cardMap;
    const activeCache = this.modalOpen && this.modalMap ? this.modalLayers : this.cardLayers;
    const layer = await this.ensureLayerOnMap(activeMap, activeCache, frame);
    if (token !== this.loadingToken) return;

    if (this.modalOpen && this.modalMap) {
      if (this.activeModalLayer && this.activeModalLayer !== layer) {
        this.activeModalLayer.setOpacity(0);
      }
      if (layer) {
        layer.setOpacity(RADAR_OPACITY);
        this.activeModalLayer = layer;
      }
    } else if (this.cardMap) {
      if (this.activeCardLayer && this.activeCardLayer !== layer) {
        this.activeCardLayer.setOpacity(0);
      }
      if (layer) {
        layer.setOpacity(RADAR_OPACITY);
        this.activeCardLayer = layer;
      }
    }
  }

  scheduleNextFrame(delayMs) {
    this.clearPlayTimer();
    if (!this.isPlaying || !this.frames.length) return;
    this.playTimer = setTimeout(async () => {
      if (!this.isPlaying) return;
      const nextIdx = this.wrapIdx(this.frameIdx + 1);
      await this.showFrame(nextIdx);
      if (this.isPlaying) {
        const isLast = nextIdx === this.frames.length - 1;
        this.scheduleNextFrame(isLast ? LATEST_FRAME_DWELL_MS : FRAME_DELAY_MS);
      }
    }, delayMs);
  }

  clearPlayTimer() {
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }

  play() {
    this.isPlaying = true;
    this.updatePlayButtons();
    this.scheduleNextFrame(FRAME_DELAY_MS);
  }

  stop() {
    this.isPlaying = false;
    this.clearPlayTimer();
    this.updatePlayButtons();
  }

  togglePlay() {
    if (this.isPlaying) this.stop();
    else this.play();
  }

  openFullView() {
    if (!this.els.modalBackdrop) return;
    this.modalOpen = true;
    this.els.modalBackdrop.classList.remove('hidden');
    this.initModalMap();
    if (this.modalMap) {
      setTimeout(() => {
        this.modalMap.invalidateSize();
        this.showFrame(this.frameIdx);
      }, 40);
    }
    if (this.isPlaying) {
      this.scheduleNextFrame(FRAME_DELAY_MS);
    }
    this.updatePlayButtons();
  }

  closeFullView() {
    if (!this.els.modalBackdrop) return;
    this.modalOpen = false;
    this.els.modalBackdrop.classList.add('hidden');
    if (this.cardMap) {
      this.cardMap.invalidateSize();
      this.showFrame(this.frameIdx);
    }
    if (this.isPlaying) {
      this.scheduleNextFrame(FRAME_DELAY_MS);
    }
  }

  invalidateSize() {
    if (this.cardMap) this.cardMap.invalidateSize();
    if (this.modalOpen && this.modalMap) this.modalMap.invalidateSize();
  }
}
