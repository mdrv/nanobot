/**
 * WhatsApp client wrapper using Baileys.
 * Based on OpenClaw's working implementation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from '@whiskeysockets/baileys';

import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

import { InboundMessage, RawMessage, WhatsAppClientOptions } from './types.js';

const VERSION = '0.1.0';

export class WhatsAppClient {
  private sock: WASocket | null = null;
  private options: WhatsAppClientOptions;
  private reconnecting = false;

  constructor(options: WhatsAppClientOptions) {
    this.options = options;
  }

  async connect(): Promise<void> {
    const logger = pino({ level: 'silent' });
    const { state, saveCreds } = await useMultiFileAuthState(this.options.authDir);
    const { version } = await fetchLatestBaileysVersion();

    console.log(`Using Baileys version: ${version.join('.')}`);

    // Create socket following OpenClaw's pattern
    this.sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      version,
      logger,
      printQRInTerminal: false,
      browser: ['nanobot', 'cli', VERSION],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    // Handle WebSocket errors
    if (this.sock.ws && typeof this.sock.ws.on === 'function') {
      this.sock.ws.on('error', (err: Error) => {
        console.error('WebSocket error:', err.message);
      });
    }

    // Handle connection updates
    this.sock.ev.on('connection.update', async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Display QR code in terminal
        console.log('\n📱 Scan this QR code with WhatsApp (Linked Devices):\n');
        qrcode.generate(qr, { small: true });
        this.options.onQR(qr);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`Connection closed. Status: ${statusCode}, Will reconnect: ${shouldReconnect}`);
        this.options.onStatus('disconnected');

        if (shouldReconnect && !this.reconnecting) {
          this.reconnecting = true;
          console.log('Reconnecting in 5 seconds...');
          setTimeout(() => {
            this.reconnecting = false;
            this.connect();
          }, 5000);
        }
      } else if (connection === 'open') {
        console.log('✅ Connected to WhatsApp');
        this.options.onStatus('connected');
      }
    });

    // Save credentials on update
    this.sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    this.sock.ev.on('messages.upsert', async ({ messages, type }: { messages: any[]; type: string }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        // Skip own messages
        if (msg.key.fromMe) continue;

        // Skip status updates
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const content = this.extractMessageContent(msg);
        if (!content) continue;

        const isGroup = msg.key.remoteJid?.endsWith('@g.us') || false;

        // Group messages: only proceed if user is mentioned
        if (isGroup) {
          const userJid = this.sock?.user?.id;
          const mentions: string[] = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

          if (await this.isUserMentioned(mentions, userJid || '')) {
            // Mentioned: forward to main handler
            this.options.onMessage(this.createInboundMessage(msg, content, isGroup));
          } else if (this.options.onIgnoredGroupMessage) {
            // Not mentioned: forward to kotaete if handler exists
            this.options.onIgnoredGroupMessage({
              message: msg.message,
              key: msg.key,
              messageTimestamp: msg.messageTimestamp as number,
            });
          }
        } else {
          // Private messages: always forward
          this.options.onMessage(this.createInboundMessage(msg, content, isGroup));
        }
      }
    });
  }

  /** Create InboundMessage object from raw message */
  private createInboundMessage(msg: any, content: string, isGroup: boolean): InboundMessage {
    return {
      id: msg.key.id || '',
      sender: msg.key.remoteJid || '',
      pn: msg.key.remoteJidAlt || '',
      content,
      timestamp: msg.messageTimestamp as number,
      isGroup,
    };
  }

  private extractMessageContent(msg: any): string | null {
    const message = msg.message;
    if (!message) return null;

    // Text message
    if (message.conversation) {
      return message.conversation;
    }

    // Extended text (reply, link preview)
    if (message.extendedTextMessage?.text) {
      return message.extendedTextMessage.text;
    }

    // Image with caption
    if (message.imageMessage?.caption) {
      return `[Image] ${message.imageMessage.caption}`;
    }

    // Video with caption
    if (message.videoMessage?.caption) {
      return `[Video] ${message.videoMessage.caption}`;
    }

    // Document with caption
    if (message.documentMessage?.caption) {
      return `[Document] ${message.documentMessage.caption}`;
    }

    // Voice/Audio message
    if (message.audioMessage) {
      return `[Voice Message]`;
    }

    return null;
  }

  /** Convert LID/JID to sanitized phone number (digits only) */
  private async resolveAndSanitizePhoneNumber(jid: string): Promise<string> {
    let resolved = jid;
    if (jid.endsWith('@lid') && this.sock?.signalRepository?.lidMapping) {
      const pn = await this.sock.signalRepository.lidMapping.getPNForLID(jid);
      if (pn) resolved = pn;
    }
    return resolved.replace(/:\d+@s\.whatsapp\.net$/, '').replace('@s.whatsapp.net', '');
  }

  /** Check if user is mentioned (handles LID conversion) */
  private async isUserMentioned(mentions: string[], userJid: string): Promise<boolean> {
    const userPn = await this.resolveAndSanitizePhoneNumber(userJid);
    for (const mention of mentions) {
      const mentionPn = await this.resolveAndSanitizePhoneNumber(mention);
      if (mentionPn === userPn) return true;
    }
    return false;
  }

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.sock) {
      throw new Error('Not connected');
    }

    await this.sock.sendMessage(to, { text });
  }

  async sendReact(to: string, emoji: string, messageKey: { id: string; remoteJid: string }): Promise<void> {
    if (!this.sock) {
      throw new Error('Not connected');
    }

    await this.sock.sendMessage(to, { react: { text: emoji, key: messageKey } });
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
  }
}
