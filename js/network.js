// Cliente WebSocket del modo multijugador. El protocolo es JSON sencillo.
export class Multiplayer {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.socket = null;
    this.id = null;
    this.name = '';
    this.connected = false;
    this.latency = 0;
    this.url = '';
    this.pingTimer = null;
    this.connectTimer = null;
    this.closedByUser = false;
  }

  connect(url, name) {
    this.disconnect();
    this.closedByUser = false;
    this.url = url;
    this.name = name;
    this.handlers.onStatus?.({ state: 'connecting', message: 'Conectando…' });

    let socket;
    try {
      const separator = url.includes('?') ? '&' : '?';
      socket = new WebSocket(`${url}${separator}name=${encodeURIComponent(name)}`);
    } catch {
      this.handlers.onStatus?.({
        state: 'error',
        message: 'La dirección no es válida. Ejemplo: ws://localhost:8000/ws',
      });
      return;
    }
    this.socket = socket;

    this.connectTimer = window.setTimeout(() => {
      if (this.socket !== socket) return;
      if (!this.connected) {
        this.handlers.onStatus?.({
          state: 'error',
          message: 'No hay respuesta del servidor. Ejecuta iniciar.bat o python server/server.py.',
        });
        this.disconnect();
      }
    }, 8000);

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.connected = true;
      this.handlers.onStatus?.({ state: 'connected', message: 'Conectado. Entrando al espacio aéreo…' });
      this.pingTimer = window.setInterval(() => this._ping(), 2500);
      this._ping();
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      this._handle(message);
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      const wasConnected = this.connected;
      this.connected = false;
      this.id = null;
      window.clearInterval(this.pingTimer);
      window.clearTimeout(this.connectTimer);
      this.pingTimer = null;
      if (!this.closedByUser && wasConnected) {
        this.handlers.onStatus?.({
          state: 'disconnected',
          message: 'Conexión perdida. Sigues volando en modo libre.',
        });
      } else if (!this.closedByUser) {
        this.handlers.onStatus?.({
          state: 'error',
          message: 'No se pudo conectar. Comprueba que el servidor esté iniciado.',
        });
      }
    });

    socket.addEventListener('error', () => {
      if (this.socket !== socket || this.connected) return;
      this.handlers.onStatus?.({
        state: 'error',
        message: 'No se pudo abrir la conexión. ¿Está arrancado el servidor?',
      });
    });
  }

  _handle(message) {
    switch (message.type) {
      case 'welcome':
        this.id = message.id;
        window.clearTimeout(this.connectTimer);
        this.handlers.onWelcome?.(message);
        break;
      case 'join':
        this.handlers.onJoin?.(message);
        break;
      case 'state':
        this.handlers.onState?.(message);
        break;
      case 'leave':
        this.handlers.onLeave?.(message);
        break;
      case 'chat':
        this.handlers.onChat?.(message);
        break;
      case 'pong':
        this.latency = Math.max(0, Math.round(performance.now() - message.t));
        this.handlers.onLatency?.(this.latency);
        break;
      case 'error':
        this.handlers.onStatus?.({ state: 'error', message: message.message || 'Error del servidor.' });
        break;
      default:
        break;
    }
  }

  _ping() {
    if (!this.connected) return;
    this._send({ type: 'ping', t: performance.now() });
  }

  _send(payload) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  sendState(position, quaternion, speed, throttle) {
    if (!this.connected) return;
    this._send({
      type: 'state',
      p: [
        Number(position.x.toFixed(2)),
        Number(position.y.toFixed(2)),
        Number(position.z.toFixed(2)),
      ],
      q: [
        Number(quaternion.x.toFixed(4)),
        Number(quaternion.y.toFixed(4)),
        Number(quaternion.z.toFixed(4)),
        Number(quaternion.w.toFixed(4)),
      ],
      s: Math.round(speed),
      t: Number(throttle.toFixed(2)),
    });
  }

  sendChat(text) {
    if (!this.connected) return;
    this._send({ type: 'chat', text: text.slice(0, 140) });
  }

  disconnect(silent = false) {
    this.closedByUser = true;
    window.clearInterval(this.pingTimer);
    window.clearTimeout(this.connectTimer);
    this.pingTimer = null;
    if (this.socket) {
      this.socket.onclose = null;
      try {
        this.socket.close();
      } catch {
        // Ignorado.
      }
      this.socket = null;
    }
    this.connected = false;
    this.id = null;
    if (!silent) {
      this.handlers.onStatus?.({ state: 'offline', message: '' });
    }
  }
}
