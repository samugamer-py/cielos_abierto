import * as THREE from '../vendor/three.module.js';
import { clamp } from './utils.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.loading = $('loading');
    this.loadingText = $('loading-text');
    this.menu = $('menu');
    this.hud = $('hud');
    this.onlinePanel = $('online-panel');
    this.onlineStatus = $('online-status');
    this.menuHint = $('menu-hint');
    this.chatLog = $('chat-log');
    this.chatForm = $('chat-form');
    this.chatInput = $('chat-input');
    this.chatHint = $('chat-hint');
    this.toastElement = $('toast');
    this.stallElement = $('stall-warning');
    this.rosterList = $('roster-list');
    this.rosterCount = $('roster-count');
    this.netBadge = $('net-badge');
    this.netText = $('net-text');
    this.flashElement = $('flash');
    this.compass = $('compass');
    this.compassCtx = this.compass.getContext('2d');
    this.minimap = $('minimap');
    this.mapCtx = this.minimap.getContext('2d');
    this.mapCoords = $('map-coords');
    this.mapMode = $('map-mode');
    this.toastTimer = null;
    this.flashTimer = null;
    this.hudState = $('hud-state');

    this.hudSpeed = $('hud-speed');
    this.hudAlt = $('hud-alt');
    this.hudAgl = $('hud-agl');
    this.hudVs = $('hud-vs');
    this.hudThr = $('hud-thr');
    this.throttleFill = $('throttle-fill');

    this.pause = $('pause');
    this.crash = $('crash');
    this.crashStats = $('crash-stats');
    this.pauseStats = $('pause-stats');
    this.connectButton = $('btn-connect');
  }

  hideLoading() {
    this.loading.classList.add('hidden');
  }

  setLoadingText(text) {
    this.loadingText.textContent = text;
  }

  showMenu() {
    this.menu.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.crash.classList.add('hidden');
    this.onlinePanel.classList.add('hidden');
    this.menuHint.classList.remove('hidden');
    this.chatLog.innerHTML = '';
    this.chatHint.classList.remove('hidden');
    this.chatForm.classList.add('hidden');
  }

  hideMenu() {
    this.menu.classList.add('hidden');
    this.hud.classList.remove('hidden');
  }

  showHud() {
    this.hud.classList.remove('hidden');
  }

  hideHud() {
    this.hud.classList.add('hidden');
  }

  showOnlinePanel(show) {
    this.onlinePanel.classList.toggle('hidden', !show);
    this.menuHint.classList.toggle('hidden', show);
    if (show) {
      this.onlineStatus.textContent = '';
      this.onlineStatus.className = 'online-status';
    }
  }

  setOnlineStatus(message, type = '') {
    this.onlineStatus.textContent = message;
    this.onlineStatus.className = `online-status ${type}`.trim();
  }

  setConnecting(connecting) {
    this.connectButton.disabled = connecting;
    this.connectButton.querySelector('span').textContent = connecting ? 'CONECTANDO…' : 'CONECTAR';
  }

  showPause(stats) {
    this.pause.classList.remove('hidden');
    if (stats) this.pauseStats.innerHTML = this._statMarkup(stats);
  }

  hidePause() {
    this.pause.classList.add('hidden');
  }

  showCrash(stats) {
    this.crash.classList.remove('hidden');
    this.crashStats.innerHTML = this._statMarkup(stats);
  }

  hideCrash() {
    this.crash.classList.add('hidden');
  }

  _statMarkup(stats) {
    const rows = [
      ['TIEMPO DE VUELO', stats.time],
      ['DISTANCIA', stats.distance],
      ['ALT. MÁXIMA', stats.maxAltitude],
    ];
    return rows
      .map(
        ([label, value]) =>
          `<div><span>${label}</span><strong>${String(value)}</strong></div>`
      )
      .join('');
  }

  setHUD({ speed, altitude, agl, verticalSpeed, throttle, stalled, state }) {
    this.hudSpeed.textContent = Math.round(speed * 3.6);
    this.hudAlt.textContent = Math.round(altitude);
    this.hudAgl.textContent = Math.max(0, Math.round(agl));
    const vertical = Math.round(verticalSpeed);
    this.hudVs.textContent = vertical > 0 ? `+${vertical}` : `${vertical}`;
    this.hudThr.textContent = `${Math.round(throttle * 100)}%`;
    this.throttleFill.style.width = `${Math.round(throttle * 100)}%`;
    this.stallElement.classList.toggle('hidden', !stalled);
    if (state) {
      this.hudState.textContent = state;
      this.hudState.classList.toggle('warn', Boolean(stalled));
    }
  }

  drawCompass(heading) {
    const ctx = this.compassCtx;
    const width = this.compass.width;
    const height = this.compass.height;
    ctx.clearRect(0, 0, width, height);
    const center = width / 2;
    const baseY = height - 16;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const start = Math.floor((heading - 82) / 5) * 5;
    for (let degree = start; degree <= heading + 82; degree += 5) {
      const delta = ((degree - heading + 540) % 360) - 180;
      if (Math.abs(delta) > 80) continue;
      const x = center + delta * 2.25;
      const absolute = ((degree % 360) + 360) % 360;
      const major = absolute % 30 === 0;
      const cardinal = absolute % 90 === 0;

      ctx.strokeStyle = cardinal
        ? 'rgba(255, 196, 107, 0.9)'
        : major
          ? 'rgba(235, 245, 250, 0.55)'
          : 'rgba(235, 245, 250, 0.2)';
      ctx.lineWidth = cardinal ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(x, baseY - (major ? 13 : 7));
      ctx.lineTo(x, baseY);
      ctx.stroke();

      if (major) {
        const labels = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
        ctx.fillStyle = cardinal ? '#ffc46b' : 'rgba(223, 235, 241, 0.72)';
        ctx.font = cardinal ? '600 11px "Cascadia Code", monospace' : '9px "Cascadia Code", monospace';
        ctx.fillText(labels[absolute] ?? String(absolute).padStart(3, '0'), x, baseY - 23);
      }
    }

    // Marcador central y rumbo actual.
    ctx.fillStyle = '#ffc46b';
    ctx.beginPath();
    ctx.moveTo(center, baseY + 7);
    ctx.lineTo(center - 5, baseY);
    ctx.lineTo(center + 5, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(235, 245, 250, 0.9)';
    ctx.font = '600 11px "Cascadia Code", monospace';
    ctx.fillText(String(Math.round((heading + 360) % 360)).padStart(3, '0'), center, height - 5);
  }

  drawMinimap(playerPosition, heading, remotes, world, online) {
    const ctx = this.mapCtx;
    const size = this.minimap.width;
    const center = size / 2;
    const span = 3600;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(center, center, center - 1, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = '#0a2a36';
    ctx.fillRect(0, 0, size, size);

    const map = world.mapCanvas;
    const px = ((playerPosition.x + world.half) / world.size) * map.width;
    const py = ((playerPosition.z + world.half) / world.size) * map.height;
    const sourceSpan = (span / world.size) * map.width;
    const sourceX = clamp(px - sourceSpan / 2, 0, map.width - sourceSpan);
    const sourceY = clamp(py - sourceSpan / 2, 0, map.height - sourceSpan);
    ctx.globalAlpha = 0.9;
    ctx.filter = 'blur(0.6px)';
    ctx.drawImage(
      map,
      sourceX,
      sourceY,
      sourceSpan,
      sourceSpan,
      0,
      0,
      size,
      size
    );
    ctx.filter = 'none';
    ctx.globalAlpha = 1;

    // Pista del aeródromo.
    const runwayX = center + ((world.runway.x - playerPosition.x) / span) * size;
    const runwayZ = center + ((world.runway.z - playerPosition.z) / span) * size;
    if (Math.hypot(runwayX - center, runwayZ - center) < center - 12) {
      ctx.strokeStyle = 'rgba(255, 221, 160, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(runwayX, runwayZ - (world.runway.length / span) * size);
      ctx.lineTo(runwayX, runwayZ + (world.runway.length / span) * size);
      ctx.stroke();
    }

    // Anillos de alcance.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    for (const radius of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(center, center, center * radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Otros pilotos.
    for (const remote of remotes) {
      if (!remote.hasState) continue;
      const dx = remote.position.x - playerPosition.x;
      const dz = remote.position.z - playerPosition.z;
      if (Math.abs(dx) > span / 2 || Math.abs(dz) > span / 2) continue;
      const x = center + (dx / span) * size;
      const y = center + (dz / span) * size;
      ctx.beginPath();
      ctx.fillStyle = `#${remote.color.getHexString()}`;
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Flecha del jugador.
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate((heading * Math.PI) / 180);
    ctx.fillStyle = '#ffc46b';
    ctx.shadowColor = 'rgba(255, 196, 107, 0.8)';
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 7);
    ctx.lineTo(0, 4);
    ctx.lineTo(-5.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Retícula central.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.beginPath();
    ctx.arc(center, center, 15, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    // Borde.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center, center, center - 1, 0, Math.PI * 2);
    ctx.stroke();

    this.mapCoords.textContent = `X ${Math.round(playerPosition.x)} · Z ${Math.round(playerPosition.z)}`;
    this.mapMode.textContent = online ? 'ONLINE' : 'LIBRE';
  }

  setRoster(players, myId) {
    this.rosterList.innerHTML = '';
    this.rosterCount.textContent = String(players.length);
    for (const player of players) {
      const item = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.color = `#${new THREE.Color(player.color ?? 0x7ee0f2).getHexString()}`;
      const name = document.createElement('span');
      name.textContent = player.name || 'Piloto';
      item.append(dot, name);
      if (player.id === myId) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'TÚ';
        item.append(tag);
      }
      this.rosterList.append(item);
    }
    if (players.length === 0) {
      const item = document.createElement('li');
      item.textContent = 'Sin conexión';
      item.style.opacity = '0.5';
      this.rosterList.append(item);
    }
  }

  showToast(message, duration = 2800) {
    window.clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.add('visible');
    this.toastTimer = window.setTimeout(() => {
      this.toastElement.classList.remove('visible');
    }, duration);
  }

  setNetBadge(visible, text) {
    this.netBadge.classList.toggle('hidden', !visible);
    if (text) this.netText.textContent = text;
  }

  appendChat(name, text, color = '#ffc46b', system = false) {
    const line = document.createElement('div');
    line.className = `line${system ? ' system' : ''}`;
    if (system) {
      line.textContent = text;
    } else {
      const strong = document.createElement('strong');
      strong.textContent = name;
      strong.style.color = color;
      const body = document.createElement('span');
      body.textContent = text;
      line.append(strong, body);
    }
    this.chatLog.append(line);
    while (this.chatLog.children.length > 5) this.chatLog.firstElementChild.remove();
  }

  openChat() {
    this.chatForm.classList.remove('hidden');
    this.chatHint.classList.add('hidden');
    this.chatInput.value = '';
    this.chatInput.focus();
  }

  closeChat() {
    this.chatForm.classList.add('hidden');
    this.chatHint.classList.remove('hidden');
    this.chatInput.blur();
  }

  isChatOpen() {
    return !this.chatForm.classList.contains('hidden');
  }

  setChatAvailable(available) {
    this.chatHint.classList.toggle('hidden', !available);
    if (!available) this.chatForm.classList.add('hidden');
  }

  flash() {
    window.clearTimeout(this.flashTimer);
    this.flashElement.classList.add('active');
    this.flashTimer = window.setTimeout(() => {
      this.flashElement.classList.remove('active');
    }, 90);
  }

  setOnlineMode(online) {
    this.mapMode.textContent = online ? 'ONLINE' : 'LIBRE';
  }
}

export function formatFlightTime(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function flightStats(timeSeconds, distanceMeters, maxAltitude) {
  return {
    time: formatFlightTime(timeSeconds),
    distance: `${(distanceMeters / 1000).toFixed(1)} km`,
    maxAltitude: `${Math.round(maxAltitude)} m`,
  };
}

export { clamp };
