import { clamp } from './utils.js';

function requestMobileFullscreen() {
  const target = document.documentElement;
  if (!document.fullscreenElement && target.requestFullscreen) {
    target.requestFullscreen().then(() => {
      if (screen.orientation?.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  }
}

const FLIGHT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyQ',
  'KeyE',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
]);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0 };
    this.pointerLocked = false;
    this.enabled = false;
    this.touchAxes = { pitch: 0, roll: 0 };
    this.touchControls = document.getElementById('touch-controls');
    this.stick = document.getElementById('flight-stick');
    this.stickKnob = document.getElementById('stick-knob');
    this.stickPointerId = null;
    this.setupTouchControls();
    this.pointerLockSupported = 'requestPointerLock' in canvas;

    window.addEventListener('keydown', (event) => {
      if (FLIGHT_KEYS.has(event.code) && this.enabled) event.preventDefault();
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.pointerLocked || !this.enabled) return;
      const sensitivity = 0.0021;
      this.mouse.x = clamp(this.mouse.x + event.movementX * sensitivity, -1, 1);
      this.mouse.y = clamp(this.mouse.y + event.movementY * sensitivity, -1, 1);
    });

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked) {
        this.mouse.x = 0;
        this.mouse.y = 0;
      }
    });

    canvas.addEventListener('mousedown', () => {
      if (this.enabled && !this.pointerLocked) this.requestPointerLock();
    });
  }

  requestPointerLock() {
    if (!this.pointerLockSupported) return;
    try {
      const promise = this.canvas.requestPointerLock();
      if (promise && promise.catch) promise.catch(() => {});
    } catch {
      // La captura del ratón es opcional: el teclado sigue funcionando.
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  setupTouchControls() {
    const mobile = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    if (!mobile || !this.touchControls || !this.stick) return;

    const updateStick = (event) => {
      const rect = this.stick.getBoundingClientRect();
      const radius = Math.min(rect.width, rect.height) * 0.34;
      const dx = event.clientX - (rect.left + rect.width / 2);
      const dy = event.clientY - (rect.top + rect.height / 2);
      const length = Math.hypot(dx, dy) || 1;
      const scale = Math.min(1, radius / length);
      const x = dx * scale;
      const y = dy * scale;
      this.touchAxes.roll = clamp(x / radius, -1, 1);
      this.touchAxes.pitch = clamp(y / radius, -1, 1);
      this.stickKnob.style.transform = `translate(${x}px, ${y}px)`;
    };
    this.stick.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      this.stickPointerId = event.pointerId;
      this.stick.setPointerCapture(event.pointerId);
      updateStick(event);
      event.preventDefault();
    });
    this.stick.addEventListener('pointermove', (event) => {
      if (event.pointerId === this.stickPointerId) {
        updateStick(event);
        event.preventDefault();
      }
    });
    const releaseStick = (event) => {
      if (event.pointerId !== this.stickPointerId) return;
      this.stickPointerId = null;
      this.touchAxes.pitch = 0;
      this.touchAxes.roll = 0;
      this.stickKnob.style.transform = 'translate(0, 0)';
    };
    this.stick.addEventListener('pointerup', releaseStick);
    this.stick.addEventListener('pointercancel', releaseStick);
    this.touchControls.querySelectorAll('[data-key]').forEach((button) => {
      const code = button.dataset.key;
      const down = (event) => {
        if (!this.enabled) return;
        this.keys.add(code);
        button.classList.add('pressed');
        event.preventDefault();
      };
      const up = (event) => {
        this.keys.delete(code);
        button.classList.remove('pressed');
        event.preventDefault();
      };
      button.addEventListener('pointerdown', down);
      button.addEventListener('pointerup', up);
      button.addEventListener('pointercancel', up);
      button.addEventListener('lostpointercapture', up);
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });
    document.getElementById('touch-fullscreen')?.addEventListener('click', requestMobileFullscreen);
    document.getElementById('touch-camera')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('touch-camera'));
    });
  }

  getAxes(dt) {
    const down = (code) => this.keys.has(code);
    let pitch =
      (down('KeyS') || down('ArrowDown') ? 1 : 0) -
      (down('KeyW') || down('ArrowUp') ? 1 : 0) + this.touchAxes.pitch;
    let roll =
      (down('KeyD') || down('ArrowRight') ? 1 : 0) -
      (down('KeyA') || down('ArrowLeft') ? 1 : 0) + this.touchAxes.roll;
    let yaw = (down('KeyE') ? 1 : 0) - (down('KeyQ') ? 1 : 0);

    if (this.pointerLocked) {
      pitch += this.mouse.y;
      roll += this.mouse.x;
      const decay = Math.exp(-dt * 1.35);
      this.mouse.x *= decay;
      this.mouse.y *= decay;
    }

    return {
      pitch: clamp(pitch, -1, 1),
      roll: clamp(roll, -1, 1),
      yaw: clamp(yaw, -1, 1),
      throttleDelta:
        (down('ShiftLeft') || down('ShiftRight') ? 1 : 0) -
        (down('ControlLeft') || down('ControlRight') ? 1 : 0),
      brake: down('Space'),
    };
  }

  clearMouse() {
    this.mouse.x = 0;
    this.mouse.y = 0;
  }

  release() {
    this.enabled = false;
    this.keys.clear();
    this.touchAxes.pitch = 0;
    this.touchAxes.roll = 0;
    this.clearMouse();
    this.exitPointerLock();
  }
}
