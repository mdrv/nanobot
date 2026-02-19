/**
 * Shared types for the WhatsApp bridge
 */

export interface InboundMessage {
  id: string;
  sender: string;
  pn: string;
  content: string;
  timestamp: number;
  isGroup: boolean;
}

export interface RawMessage {
  message: any;
  key: {
    id: string;
    remoteJid: string;
    remoteJidAlt?: string;
    fromMe: boolean;
  };
  messageTimestamp: number;
}

export interface WhatsAppClientOptions {
  authDir: string;
  onMessage: (msg: InboundMessage) => void;
  onQR: (qr: string) => void;
  onStatus: (status: string) => void;
  onIgnoredGroupMessage?: (msg: RawMessage) => void;
}

export interface SendCommand {
  type: 'send';
  to: string;
  text: string;
}

export interface BridgeMessage {
  type: 'message' | 'status' | 'qr' | 'error';
  [key: string]: unknown;
}
