// Compatibilidade mínima com a API usada pela mesa (on/emit/id/connected),
// transportada por WebSocket nativo para Cloudflare Durable Objects.
(() => {
  class FreeSocket {
    constructor() {
      this.handlers = new Map();
      this.connected = false;
      this.id = '';
      this.manualClose = false;
      this.retry = 0;
      this.ws = null;
      this.connect();
    }
    on(event, fn) {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event).add(fn);
      return this;
    }
    off(event, fn) {
      if (!event) { this.handlers.clear(); return this; }
      if (!fn) this.handlers.delete(event);
      else this.handlers.get(event)?.delete(fn);
      return this;
    }
    fire(event, data) {
      for (const fn of this.handlers.get(event) || []) {
        try { fn(data); } catch (err) { console.error('[Lunaria WS]', event, err); }
      }
    }
    roomConfig() {
      try { return JSON.parse(localStorage.getItem('rpgRoomData') || '{}') || {}; }
      catch (_) { return {}; }
    }
    connect() {
      if (this.manualClose) return;
      const cfg = this.roomConfig();
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.id = (globalThis.crypto?.randomUUID?.() || ('ws-'+Date.now()+'-'+Math.random().toString(36).slice(2)));
      const url = new URL('/ws', location.href);
      url.protocol = proto;
      url.searchParams.set('campaign', cfg.campaignName || cfg.roomName || cfg.room || '');
      url.searchParams.set('system', cfg.system || 'lobisomem');
      url.searchParams.set('clientId', this.id);
      const ws = this.ws = new WebSocket(url.toString());
      ws.onopen = () => {
        if (ws !== this.ws) return;
        this.connected = true;
        this.retry = 0;
        this.fire('connect');
      };
      ws.onmessage = (ev) => {
        if (ws !== this.ws) return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg && typeof msg.event === 'string') this.fire(msg.event, msg.data);
        } catch (err) { console.warn('[Lunaria WS] mensagem inválida', err); }
      };
      ws.onerror = () => {
        if (!this.connected) this.fire('connect_error');
      };
      ws.onclose = () => {
        if (ws !== this.ws) return;
        const wasConnected = this.connected;
        this.connected = false;
        if (wasConnected) this.fire('disconnect');
        if (!this.manualClose) {
          const wait = Math.min(8000, 500 * Math.pow(1.7, this.retry++));
          setTimeout(() => this.connect(), wait);
        }
      };
    }
    emit(event, data) {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return this;
      try { this.ws.send(JSON.stringify({ event, data })); }
      catch (err) { console.warn('[Lunaria WS] falha ao enviar', event, err); }
      return this;
    }
    disconnect() {
      this.manualClose = true;
      this.connected = false;
      try { this.ws?.close(1000, 'client disconnect'); } catch (_) {}
    }
  }
  // Mantém o restante do mesa.html sem reescrita: ele continua chamando io(...).
  globalThis.io = () => new FreeSocket();
  globalThis.FreeSocket = FreeSocket;
})();
