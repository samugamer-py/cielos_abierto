import * as THREE from '../vendor/three.module.js';
import { World } from './world.js';
import { PlayerAircraft, RemoteAircraft } from './aircraft.js';
import { Input } from './input.js';
import { UI, flightStats } from './ui.js';
import { EngineAudio } from './audio.js';
import { Multiplayer } from './network.js';
import { clamp, damp } from './utils.js';

const canvas = document.getElementById('scene');
const ui = new UI();

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
} catch {
  ui.setLoadingText('Tu navegador no ha podido iniciar WebGL. Prueba con Chrome o Edge actualizado.');
  throw new Error('WebGL no disponible');
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 22000);
const world = new World(scene);
const player = new PlayerAircraft(scene, world);
const input = new Input(canvas);
const audio = new EngineAudio();

const SUN_OFFSET = new THREE.Vector3(0.45, 0.55, 0.62).normalize().multiplyScalar(760);
const LOCAL_FORWARD = new THREE.Vector3(0, 0, -1);
const tempForward = new THREE.Vector3();
const tempLook = new THREE.Vector3();
const tempOffset = new THREE.Vector3();
const identityUp = new THREE.Vector3(0, 1, 0);

let state = 'menu'; // menu | flying | paused | crash
let online = false;
let myId = null;
let myName = 'PILOTO';
let myColor = 0x7ee0f2;
let cameraMode = 0;
let elapsed = 0;
let flightTime = 0;
let distance = 0;
let maxAltitude = 0;
let sendAccumulator = 0;
let boundaryTimer = 0;
let hintTimer = 0;
let muted = false;
let explosions = [];
let clock = new THREE.Clock();

const remotes = new Map();

let storedName = '';
let storedServer = '';
try {
  storedName = localStorage.getItem('cielos.name') || '';
  storedServer = localStorage.getItem('cielos.server') || '';
} catch {
  // Almacenamiento no disponible.
}

function requestFullscreenOnMobile() {
  const mobile = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (!mobile) return;
  const target = document.documentElement;
  if (!document.fullscreenElement && target.requestFullscreen) {
    target.requestFullscreen().then(() => {
      if (screen.orientation?.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {
      // Algunos navegadores móviles sólo permiten pantalla completa instalada como PWA.
    });
  }
}

function defaultServerUrl() {
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
  }
  return 'ws://localhost:8000/ws';
}

myName = storedName || `PILOTO-${Math.floor(100 + Math.random() * 900)}`;
document.getElementById('callsign').value = myName;
document.getElementById('server-url').value = storedServer || defaultServerUrl();

// ---------------------------------------------------------------------------
// Red
// ---------------------------------------------------------------------------

const net = new Multiplayer({
  onStatus: handleNetStatus,
  onWelcome: handleWelcome,
  onJoin: handleJoin,
  onState: handleRemoteState,
  onLeave: handleLeave,
  onChat: handleChat,
  onLatency: handleLatency,
});

function handleNetStatus({ state: status, message }) {
  if (status === 'connecting') {
    ui.setOnlineStatus(message);
    ui.setConnecting(true);
    return;
  }

  if (status === 'connected') {
    ui.setOnlineStatus(message, 'ok');
    return;
  }

  if (status === 'error') {
    ui.setConnecting(false);
    ui.setOnlineStatus(message, 'error');
    return;
  }

  if (status === 'disconnected') {
    ui.setConnecting(false);
    online = false;
    ui.setNetBadge(false);
    ui.setOnlineMode(false);
    ui.setChatAvailable(false);
    ui.showToast(message, 4200);
    ui.appendChat('', message, '#7ee0f2', true);
    clearRemotes();
    refreshRoster();
  }
}

function handleWelcome(message) {
  myId = message.id;
  myColor = message.color ?? myColor;
  myName = message.name ?? myName;
  ui.setConnecting(false);
  ui.setOnlineStatus('Conectado al espacio aéreo.', 'ok');
  clearRemotes();
  for (const other of message.players || []) {
    const remote = getRemote(other.id, other.name, other.color);
    if (other.state) applyRemoteState(remote, other.state);
  }
  beginFlight(true);
  ui.showToast(`Conectado como ${myName}`, 3600);
}

function handleJoin(message) {
  if (message.id === myId) return;
  getRemote(message.id, message.name, message.color);
  refreshRoster();
  ui.appendChat('', `${message.name} se ha unido al espacio aéreo`, '#7ee0f2', true);
}

function handleRemoteState(message) {
  if (!message.id || message.id === myId) return;
  const remote = getRemote(message.id, message.name, message.color);
  applyRemoteState(remote, message);
}

function handleLeave(message) {
  const remote = remotes.get(message.id);
  if (!remote) return;
  remote.dispose(scene);
  remotes.delete(message.id);
  refreshRoster();
  if (message.name) ui.appendChat('', `${message.name} ha abandonado el espacio aéreo`, '#7ee0f2', true);
}

function handleChat(message) {
  const color = message.color ? `#${new THREE.Color(message.color).getHexString()}` : '#ffc46b';
  ui.appendChat(message.name || 'Piloto', message.text || '', color);
}

function handleLatency(milliseconds) {
  if (online) ui.setNetBadge(true, `ONLINE · ${milliseconds} ms`);
}

function getRemote(id, name, color) {
  let remote = remotes.get(id);
  if (!remote) {
    remote = new RemoteAircraft(scene, id, name || 'Piloto', color ?? 0x67c7d9);
    remotes.set(id, remote);
    refreshRoster();
  }
  return remote;
}

function applyRemoteState(remote, data) {
  if (!data.p || !data.q) return;
  remote.setState(
    new THREE.Vector3(data.p[0], data.p[1], data.p[2]),
    new THREE.Quaternion(data.q[0], data.q[1], data.q[2], data.q[3]),
    data.s ?? 0
  );
}

function clearRemotes() {
  for (const remote of remotes.values()) remote.dispose(scene);
  remotes.clear();
}

function refreshRoster() {
  if (!online) {
    ui.setRoster([{ id: null, name: 'Vuelo libre', color: 0x7ee0f2 }], null);
    return;
  }
  const players = [{ id: myId, name: myName, color: myColor }];
  for (const remote of remotes.values()) {
    players.push({ id: remote.id, name: remote.name, color: remote.color.getHex() });
  }
  ui.setRoster(players, myId);
}

// ---------------------------------------------------------------------------
// Vuelo
// ---------------------------------------------------------------------------

function resetStats() {
  flightTime = 0;
  distance = 0;
  maxAltitude = player.position.y;
}

function currentStats() {
  return flightStats(flightTime, distance, maxAltitude);
}

function beginFlight(multiplayer) {
  online = multiplayer;
  state = 'flying';
  document.body.classList.add('game-flying');
  cameraMode = 0;
  ui.hideMenu();
  ui.hidePause();
  ui.hideCrash();
  ui.setOnlineMode(online);
  ui.setNetBadge(online, online ? 'ONLINE' : '');
  refreshRoster();
  ui.showHud();
  ui.setChatAvailable(online);
  player.reset(world.getSpawn());
  resetStats();
  input.enabled = true;
  input.clearMouse();
  audio.init();
  boundaryTimer = 0;
  hintTimer = 0;
  if (!online) ui.appendChat('', 'Vuelo libre · sin conexión', '#ffc46b', true);
  ui.showToast(online ? '¡Buen vuelo, piloto!' : 'Despega: SHIFT acelera · W/S morro', 3800);
  updateCamera(1, true);
  input.requestPointerLock();
}

function pauseGame() {
  if (state !== 'flying') return;
  state = 'paused';
  document.body.classList.remove('game-flying');
  input.enabled = false;
  input.exitPointerLock();
  ui.showPause(currentStats());
  audio.update(0, 0, false);
}

function resumeGame() {
  if (state !== 'paused') return;
  state = 'flying';
  document.body.classList.add('game-flying');
  ui.hidePause();
  input.enabled = true;
  input.requestPointerLock();
}

function retryFlight() {
  state = 'flying';
  document.body.classList.add('game-flying');
  cameraMode = 0;
  ui.hideCrash();
  ui.hidePause();
  player.reset(world.getSpawn());
  resetStats();
  input.enabled = true;
  audio.init();
  updateCamera(1, true);
  ui.showToast('Pista despejada. ¡A volar!', 2400);
  input.requestPointerLock();
}

function returnToMenu() {
  state = 'menu';
  document.body.classList.remove('game-flying');
  online = false;
  myId = null;
  net.disconnect(true);
  clearRemotes();
  refreshRoster();
  input.release();
  ui.hidePause();
  ui.hideCrash();
  ui.showMenu();
  ui.setNetBadge(false);
  ui.setOnlineMode(false);
  ui.showOnlinePanel(false);
  audio.update(0, 0, false);
  player.reset(world.getSpawn());
  cameraMode = 0;
  elapsed = 0;
}

document.addEventListener('touch-camera', cycleCamera);

function cycleCamera() {
  cameraMode = (cameraMode + 1) % 3;
  const names = ['Persecución', 'Cabina', 'Exterior amplio'];
  ui.showToast(`Cámara: ${names[cameraMode]}`, 1600);
}

function toggleSound() {
  muted = !muted;
  audio.setMuted(muted);
  ui.showToast(muted ? 'Sonido silenciado' : 'Sonido activado', 1500);
}

function checkBoundary(dt) {
  const distanceFromCenter = Math.hypot(player.position.x, player.position.z);
  if (distanceFromCenter > 3600) {
    player.reset(world.getSpawn());
    updateCamera(1, true);
    boundaryTimer = 0;
    ui.showToast('Has regresado al archipiélago', 2800);
    return;
  }
  boundaryTimer -= dt;
  if (distanceFromCenter > 2850 && boundaryTimer <= 0) {
    ui.showToast('Estás saliendo del área de vuelo', 2600);
    boundaryTimer = 7;
  }
}

player.events.onCrash = (impact) => {
  if (state !== 'flying') return;
  state = 'crash';
  document.body.classList.remove('game-flying');
  input.enabled = false;
  input.exitPointerLock();
  audio.crash();
  ui.flash();
  spawnExplosion(new THREE.Vector3(impact.x, impact.y, impact.z));
  player.group.visible = false;
  player.trailLines.forEach((line) => {
    line.visible = false;
  });
  ui.showCrash(currentStats());
  if (online) {
    ui.appendChat('', 'Has impactado contra el terreno', '#ff6b5e', true);
  }
};

player.events.onLanding = () => {
  ui.showToast('Aterrizaje perfecto. Rueda con SHIFT y despega con S.', 4200);
};

player.events.onTakeoff = () => {
  ui.showToast('¡Despegue!', 1700);
};

// ---------------------------------------------------------------------------
// Partículas y efectos
// ---------------------------------------------------------------------------

function spawnExplosion(position) {
  const count = 320;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 4;
    positions[i * 3 + 1] = Math.random() * 4;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 4;
    const speed = 8 + Math.random() * 42;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.72;
    velocities[i * 3] = Math.cos(theta) * Math.sin(phi) * speed;
    velocities[i * 3 + 1] = Math.cos(phi) * speed * 0.9 + 4;
    velocities[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * speed;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffb45e,
    size: 3.6,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.position.copy(position);
  points.frustumCulled = false;
  scene.add(points);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.35, 36),
    new THREE.MeshBasicMaterial({
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(position);
  ring.position.y += 0.4;
  scene.add(ring);

  explosions.push({
    points,
    ring,
    velocities,
    life: 3.2,
    maxLife: 3.2,
  });
}

function updateExplosions(dt) {
  for (let index = explosions.length - 1; index >= 0; index--) {
    const explosion = explosions[index];
    explosion.life -= dt;
    const attribute = explosion.points.geometry.getAttribute('position');
    for (let i = 0; i < attribute.count; i++) {
      explosion.velocities[i * 3 + 1] -= 15 * dt;
      attribute.array[i * 3] += explosion.velocities[i * 3] * dt;
      attribute.array[i * 3 + 1] += explosion.velocities[i * 3 + 1] * dt;
      attribute.array[i * 3 + 2] += explosion.velocities[i * 3 + 2] * dt;
    }
    attribute.needsUpdate = true;
    const progress = 1 - explosion.life / explosion.maxLife;
    explosion.points.material.opacity = clamp(1 - progress, 0, 1);
    explosion.points.material.size = 3.6 - progress * 2;

    const scale = 1 + progress * 38;
    explosion.ring.scale.setScalar(scale);
    explosion.ring.material.opacity = clamp(0.9 - progress * 1.4, 0, 0.9);

    if (explosion.life <= 0) {
      scene.remove(explosion.points, explosion.ring);
      explosion.points.geometry.dispose();
      explosion.points.material.dispose();
      explosion.ring.geometry.dispose();
      explosion.ring.material.dispose();
      explosions.splice(index, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Cámara
// ---------------------------------------------------------------------------

function updateCamera(dt, instant = false) {
  if (state === 'menu') {
    const radius = 31;
    const angle = elapsed * 0.17;
    camera.position.set(
      player.position.x + Math.cos(angle) * radius,
      player.position.y + 6.4 + Math.sin(elapsed * 0.23) * 1.4,
      player.position.z + Math.sin(angle) * radius
    );
    camera.up.copy(identityUp);
    camera.lookAt(player.position.x, player.position.y + 0.9, player.position.z);
    camera.fov = 55;
    camera.updateProjectionMatrix();
    return;
  }

  const forward = tempForward.copy(LOCAL_FORWARD).applyQuaternion(player.quaternion);

  if (cameraMode === 1) {
    tempOffset.set(0, 1.18, -0.85).applyQuaternion(player.quaternion).add(player.position);
    const factor = instant ? 1 : 1 - Math.exp(-dt * 16);
    camera.position.lerp(tempOffset, factor);
    camera.quaternion.slerp(player.quaternion, instant ? 1 : 1 - Math.exp(-dt * 14));
    camera.fov = 72;
  } else {
    const offset = cameraMode === 0 ? [0, 3.6, 15] : [0, 8.5, 30];
    tempOffset
      .set(offset[0], offset[1], offset[2])
      .applyQuaternion(player.quaternion)
      .add(player.position);
    const factor = instant ? 1 : 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(tempOffset, factor);
    camera.up.lerp(identityUp, 0.2);
    tempLook.copy(forward).multiplyScalar(cameraMode === 0 ? 18 : 30).add(player.position);
    tempLook.y += cameraMode === 0 ? 2.2 : 4;
    camera.lookAt(tempLook);
    camera.fov = damp(camera.fov, 64 + clamp(player.speed - 70, 0, 55) * 0.24, 2.5, dt);
  }

  const ground = world.groundHeightAt(camera.position.x, camera.position.z) + 1.6;
  if (camera.position.y < ground) camera.position.y = ground;
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------------

document.getElementById('btn-free').addEventListener('click', () => {
  requestFullscreenOnMobile();
  audio.init();
  if (online) {
    net.disconnect(true);
    clearRemotes();
  }
  beginFlight(false);
});

document.getElementById('btn-online').addEventListener('click', () => {
  audio.init();
  ui.showOnlinePanel(true);
});

document.getElementById('btn-back').addEventListener('click', () => {
  ui.showOnlinePanel(false);
  ui.setConnecting(false);
});

document.getElementById('btn-connect').addEventListener('click', () => {
  requestFullscreenOnMobile();
  const callsignInput = document.getElementById('callsign');
  const serverInput = document.getElementById('server-url');
  const name = callsignInput.value.trim().slice(0, 16).replace(/[<>&"]/g, '') || 'PILOTO';
  const url = serverInput.value.trim();
  if (!/^wss?:\/\/.+/i.test(url)) {
    ui.setOnlineStatus('Dirección no válida. Ejemplo: ws://localhost:8000/ws', 'error');
    return;
  }
  myName = name;
  try {
    localStorage.setItem('cielos.name', name);
    localStorage.setItem('cielos.server', url);
  } catch {
    // Ignorado.
  }
  audio.init();
  ui.setConnecting(true);
  net.connect(url, name);
});

document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-pause-menu').addEventListener('click', returnToMenu);
document.getElementById('btn-retry').addEventListener('click', retryFlight);
document.getElementById('btn-crash-menu').addEventListener('click', returnToMenu);

document.getElementById('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = ui.chatInput.value.trim();
  if (text) {
    if (online) net.sendChat(text);
    else ui.showToast('El chat solo está disponible en multijugador', 2200);
  }
  ui.closeChat();
  if (state === 'flying') {
    input.enabled = true;
    input.requestPointerLock();
  }
});

window.addEventListener('keydown', (event) => {
  if (ui.isChatOpen()) {
    if (event.code === 'Escape') {
      event.preventDefault();
      ui.closeChat();
      if (state === 'flying') {
        input.enabled = true;
        input.requestPointerLock();
      }
    }
    return;
  }

  if (event.code === 'Enter') {
    if (state === 'flying' && online) {
      event.preventDefault();
      input.enabled = false;
      input.exitPointerLock();
      ui.openChat();
    } else if (state === 'flying' && !online) {
      ui.showToast('Juega en multijugador para usar el chat', 2200);
    }
    return;
  }

  if (event.code === 'Escape') {
    if (state === 'flying') {
      event.preventDefault();
      pauseGame();
    } else if (state === 'paused') {
      event.preventDefault();
      resumeGame();
    }
    return;
  }

  if (state === 'flying') {
    if (event.code === 'KeyC') cycleCamera();
    if (event.code === 'KeyR') retryFlight();
    if (event.code === 'KeyM') toggleSound();
  } else if (state === 'crash' && event.code === 'KeyR') {
    retryFlight();
  }
});

document.addEventListener('pointerlockchange', () => {
  const mobile = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (!mobile && state === 'flying' && !ui.isChatOpen() && !document.pointerLockElement) {
    pauseGame();
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Bucle principal
// ---------------------------------------------------------------------------

function animation() {
  requestAnimationFrame(animation);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  world.update(dt, elapsed, camera);

  // La luz y las sombras acompañan al jugador.
  world.sunLight.position.copy(player.position).add(SUN_OFFSET);
  world.sunLight.target.position.copy(player.position);
  world.sunLight.target.updateMatrixWorld();
  world.fillLight.position.copy(player.position).add(new THREE.Vector3(300, 220, 300));
  world.fillLight.target.position.copy(player.position);
  world.fillLight.target.updateMatrixWorld();

  for (const remote of remotes.values()) remote.update(dt, elapsed);
  updateExplosions(dt);

  const chatting = ui.isChatOpen();

  if (state === 'flying' && !chatting) {
    const axes = input.getAxes(dt);
    player.update(dt, axes, elapsed);
    flightTime += dt;
    distance += player.speed * dt;
    maxAltitude = Math.max(maxAltitude, player.position.y);
    updateCamera(dt);
    checkBoundary(dt);
    audio.update(player.speed, player.throttle, true);

    sendAccumulator += dt;
    if (online && sendAccumulator > 0.085) {
      sendAccumulator = 0;
      net.sendState(player.position, player.quaternion, player.speed, player.throttle);
    }
  } else if (state === 'menu') {
    player._updateVisual(dt, elapsed);
    updateCamera(dt);
    audio.update(0, 0, false);
  } else if (state === 'paused' || state === 'crash' || chatting) {
    audio.update(player.speed, player.throttle, false);
    if (state !== 'menu') {
      sendAccumulator += dt;
      if (online && sendAccumulator > 0.2) {
        sendAccumulator = 0;
        net.sendState(player.position, player.quaternion, player.speed, player.throttle);
      }
    }
  }

  // HUD.
  const forward = tempForward.copy(LOCAL_FORWARD).applyQuaternion(player.quaternion);
  const headingNow = (Math.atan2(forward.x, -forward.z) * 180) / Math.PI;
  const normalizedHeading = (headingNow + 360) % 360;
  const verticalSpeed = player.velocity.y;
  const hudState = player.grounded
    ? 'EN TIERRA'
    : player.stalled
      ? 'PÉRDIDA'
      : online
        ? 'EN LÍNEA'
        : 'EN VUELO';

  if (state !== 'menu') {
    ui.setHUD({
      speed: player.speed,
      altitude: player.position.y,
      agl: player.agl,
      verticalSpeed,
      throttle: player.throttle,
      stalled: player.stalled && !player.grounded && state === 'flying',
      state: hudState,
    });
    ui.drawCompass(normalizedHeading);
    ui.drawMinimap(player.position, normalizedHeading, remotes.values(), world, online);
    if (online) ui.setNetBadge(true, `ONLINE · ${net.latency} ms`);
  }

  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

player.reset(world.getSpawn());
player.throttle = 0.45;
player.speed = 0;
player.syncModel();
camera.position.set(26, 300, 280);
updateCamera(1, true);
refreshRoster();
ui.setOnlineMode(false);
clock.start();
animation();

ui.hideLoading();
ui.showMenu();
if (location.protocol === 'file:') {
  ui.showToast('Abre el juego con iniciar.bat para que funcionen los módulos', 6000);
}

window.addEventListener('beforeunload', () => {
  net.disconnect(true);
});

// Acceso de depuración para pruebas automatizadas y ajustes desde la consola.
window.__CIELOS__ = {
  renderer,
  scene,
  camera,
  world,
  player,
  net,
  ui,
  input,
  remotes,
  get state() {
    return state;
  },
  get online() {
    return online;
  },
  capture() {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/jpeg', 0.82);
  },
  startFreeFlight() {
    beginFlight(false);
  },
};
