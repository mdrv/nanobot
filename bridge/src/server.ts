/**
 * WebSocket server for Python-Node.js bridge communication.
 * Security: binds to 127.0.0.1 only; optional BRIDGE_TOKEN auth.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { WhatsAppClient } from './whatsapp.js';
import { InboundMessage, RawMessage, SendCommand, BridgeMessage } from './types.js';

/**
 * Base bridge server - minimal WebSocket server with WhatsApp client.
 * Can be extended for additional features (e.g., Kotaete quiz system).
 */
export class BridgeServer {
  protected wss: WebSocketServer | null = null;
  protected wa: WhatsAppClient | null = null;
  protected clients: Set<WebSocket> = new Set();

  constructor(protected port: number, protected authDir: string, protected token?: string) {}

  async start(): Promise<void> {
    // Bind to localhost only — never expose to external network
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port });
    console.log(`🌉 Bridge server listening on ws://127.0.0.1:${this.port}`);
    if (this.token) console.log('🔒 Token authentication enabled');

    // Initialize WhatsApp client
    this.wa = new WhatsAppClient({
      authDir: this.authDir,
      onMessage: (msg) => this.broadcast({ type: 'message', ...msg }),
      onQR: (qr) => this.broadcast({ type: 'qr', qr }),
      onStatus: (status) => this.broadcast({ type: 'status', status }),
      onIgnoredGroupMessage: (msg) => this.handleIgnoredGroupMessage(msg),
    });

    // Handle WebSocket connections
    this.wss.on('connection', (ws) => this.handleConnection(ws));

    // Connect to WhatsApp
    await this.wa.connect();
  }

  /** Handle new WebSocket connection - can be overridden in subclasses */
  protected handleConnection(ws: WebSocket): void {
    if (this.token) {
      // Require auth handshake as first message
      const timeout = setTimeout(() => ws.close(4001, 'Auth timeout'), 5000);
      ws.once('message', (data) => {
        clearTimeout(timeout);
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth' && msg.token === this.token) {
            console.log('🔗 Python client authenticated');
            this.setupClient(ws);
          } else {
            ws.close(4003, 'Invalid token');
          }
        } catch {
          ws.close(4003, 'Invalid auth message');
        }
      });
    } else {
      console.log('🔗 Python client connected');
      this.setupClient(ws);
    }
  }

  /** Setup client message handlers - can be overridden in subclasses */
  protected setupClient(ws: WebSocket): void {
    this.clients.add(ws);

    ws.on('message', async (data) => {
      try {
        const cmd = JSON.parse(data.toString());
        await this.handleCommand(cmd, ws);
      } catch (error) {
        console.error('Error handling command:', error);
        ws.send(JSON.stringify({ type: 'error', error: String(error) }));
      }
    });

    ws.on('close', () => {
      console.log('🔌 Python client disconnected');
      this.clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.clients.delete(ws);
    });
  }

  /** Handle incoming commands - can be overridden in subclasses */
  protected async handleCommand(cmd: any, ws: WebSocket): Promise<void> {
    if (!this.wa) return;

    if (cmd.type === 'send') {
      await this.wa.sendMessage(cmd.to, cmd.text);
      ws.send(JSON.stringify({ type: 'sent', to: cmd.to }));
    }
  }

  /** Handle ignored group messages - override in subclasses */
  protected async handleIgnoredGroupMessage(msg: RawMessage): Promise<void> {
    // Base implementation does nothing
  }

  /** Broadcast message to all connected clients */
  protected broadcast(msg: BridgeMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  async stop(): Promise<void> {
    // Close all client connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Disconnect WhatsApp
    if (this.wa) {
      await this.wa.disconnect();
      this.wa = null;
    }
  }
}
