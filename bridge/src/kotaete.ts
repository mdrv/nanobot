/**
 * kotaete.ts - Quiz/Answer system for group messages
 * "Kotaete" (答えて) is Japanese for "answer/respond"
 *
 * MVP Implementation:
 * - Track active quiz state (question + correct answer)
 * - Receive messages from ignored group messages
 * - Respond with reaction (partial match) or text message (exact match)
 */

import type { WebSocket } from 'ws';
import { BridgeServer as BaseBridgeServer } from './server.js';
import type { RawMessage } from './types.js';

export interface QuizState {
  active: boolean;
  question: string;
  correctAnswer: string;
  startTime: number;
  chatId: string;
  messageId?: string;
}

export interface KotaeteOptions {
  onQuizStart?: (quiz: QuizState) => void;
  onQuizEnd?: (reason: 'answered' | 'timeout' | 'cancelled') => void;
}

export interface MessageSender {
  sendMessage(to: string, text: string): Promise<void>;
  sendReact(to: string, emoji: string, messageKey: { id: string; remoteJid: string }): Promise<void>;
}

export class Kotaete {
  private sender: MessageSender;
  private currentQuiz: QuizState | null = null;
  private options: KotaeteOptions;

  constructor(sender: MessageSender, options: KotaeteOptions = {}) {
    this.sender = sender;
    this.options = options;
  }

  /**
   * Start a quiz in a group chat
   * @param chatId Group JID (e.g., "123456789-1234567890@g.us")
   * @param question The quiz question
   * @param correctAnswer The correct answer (case-insensitive, trimmed)
   * @param replyToMessageId Optional: message to reply to (quiz post)
   */
  async startQuiz(
    chatId: string,
    question: string,
    correctAnswer: string,
    replyToMessageId?: string,
  ): Promise<void> {
    if (this.currentQuiz) {
      throw new Error('A quiz is already active');
    }

    // Send the quiz question to the group
    const message = `📝 Quiz: ${question}\n\nReply with your answer!`;
    await this.sender.sendMessage(chatId, message);

    this.currentQuiz = {
      active: true,
      question,
      correctAnswer: correctAnswer.toLowerCase().trim(),
      startTime: Date.now(),
      chatId,
      messageId: replyToMessageId,
    };

    this.options.onQuizStart?.(this.currentQuiz);
  }

  /**
   * End current quiz
   */
  async endQuiz(reason: 'answered' | 'timeout' | 'cancelled'): Promise<void> {
    if (!this.currentQuiz) return;

    const quiz = this.currentQuiz;
    this.currentQuiz = null;
    this.options.onQuizEnd?.(reason);
  }

  /**
   * Check if a message matches the quiz answer
   * @param chatId Chat JID where message was sent
   * @param messageContent The message text
   * @param messageKey Message key for reactions
   */
  async checkAnswer(
    chatId: string,
    messageContent: string,
    messageKey: { id: string; remoteJid: string },
  ): Promise<void> {
    // Ignore if no active quiz or wrong chat
    if (!this.currentQuiz || this.currentQuiz.chatId !== chatId) {
      return;
    }

    const userAnswer = messageContent.toLowerCase().trim();
    const correctAnswer = this.currentQuiz.correctAnswer;

    // Exact match: send "Correct!" message and end quiz
    if (userAnswer === correctAnswer) {
      await this.sender.sendReact(chatId, '✅', messageKey);
      await this.sender.sendMessage(chatId, '✅ Correct!');
      await this.endQuiz('answered');
      return;
    }

    // Partial match (contains answer): react with ✨
    if (userAnswer.includes(correctAnswer) || correctAnswer.includes(userAnswer)) {
      await this.sender.sendReact(chatId, '✨', messageKey);
      return;
    }

    // Close match (Levenshtein distance <= 2 or similar): react with 🔍
    if (this.isCloseMatch(userAnswer, correctAnswer)) {
      await this.sender.sendReact(chatId, '🔍', messageKey);
    }
  }

  /**
   * Get current quiz state (read-only)
   */
  getQuiz(): QuizState | null {
    return this.currentQuiz
      ? { ...this.currentQuiz }
      : null;
  }

  /**
   * Check if a quiz is currently active
   */
  isQuizActive(): boolean {
    return this.currentQuiz !== null;
  }

  /**
   * Extract message content from Baileys message object
   */
  static extractMessageContent(message: any): string | null {
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
      return message.imageMessage.caption;
    }

    // Video with caption
    if (message.videoMessage?.caption) {
      return message.videoMessage.caption;
    }

    // Document with caption
    if (message.documentMessage?.caption) {
      return message.documentMessage.caption;
    }

    return null;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(
            dp[i - 1][j],      // deletion
            dp[i][j - 1],      // insertion
            dp[i - 1][j - 1],  // substitution
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Check if two answers are "close" (Levenshtein distance <= 2 or length diff <= 1)
   */
  private isCloseMatch(answer1: string, answer2: string): boolean {
    const distance = this.levenshteinDistance(answer1, answer2);

    // Very close: distance <= 2 for short answers
    if (answer1.length <= 10 && distance <= 2) return true;

    // For longer answers, be more lenient (distance <= 3 or 10% of length)
    if (answer1.length > 10) {
      const maxDistance = Math.max(3, Math.floor(answer1.length * 0.1));
      return distance <= maxDistance;
    }

    return false;
  }
}

/**
 * BridgeServer with Kotaete quiz system integrated.
 * Extends base BridgeServer to add quiz functionality.
 */
export class BridgeServer extends BaseBridgeServer {
  private kotaete: Kotaete | null = null;

  constructor(port: number, authDir: string, token?: string) {
    super(port, authDir, token);
  }

  async start(): Promise<void> {
    // Call parent start() first
    await super.start();

    // Initialize kotaete after WhatsApp is connected
    this.kotaete = this.createKotaete();
  }

  /** Create Kotaete instance with WhatsApp client as sender */
  private createKotaete(): Kotaete {
    const options: KotaeteOptions = {
      onQuizStart: (quiz: QuizState) => {
        console.log(`📝 Quiz started in ${quiz.chatId}: ${quiz.question}`);
        this.broadcast({ type: 'quiz_started', quiz } as any);
      },
      onQuizEnd: (reason) => {
        console.log(`✅ Quiz ended: ${reason}`);
        this.broadcast({ type: 'quiz_ended', reason } as any);
      },
    };

    return new Kotaete(
      {
        sendMessage: (to: string, text: string) => this.wa!.sendMessage(to, text),
        sendReact: (to: string, emoji: string, messageKey) =>
          this.wa!.sendReact(to, emoji, messageKey),
      },
      options,
    );
  }

  /** Override to handle quiz commands */
  protected async handleCommand(cmd: any, ws: WebSocket): Promise<void> {
    // Handle quiz commands
    if (this.kotaete) {
      switch (cmd.type) {
        case 'quiz_start':
          try {
            await this.kotaete.startQuiz(
              cmd.chatId,
              cmd.question,
              cmd.answer,
              cmd.replyToMessageId,
            );
            ws.send(JSON.stringify({ type: 'quiz_started', success: true }));
          } catch (error) {
            ws.send(JSON.stringify({ type: 'error', error: String(error) }));
          }
          return;

        case 'quiz_end':
          await this.kotaete.endQuiz('cancelled');
          ws.send(JSON.stringify({ type: 'quiz_ended', reason: 'cancelled' }));
          return;

        case 'quiz_status':
          const quiz = this.kotaete.getQuiz();
          ws.send(JSON.stringify({
            type: 'quiz_status',
            active: this.kotaete.isQuizActive(),
            quiz,
          }));
          return;
      }
    }

    // Fall back to parent implementation for other commands
    await super.handleCommand(cmd, ws);
  }

  /** Override to check quiz answers */
  protected async handleIgnoredGroupMessage(msg: RawMessage): Promise<void> {
    if (!this.kotaete) return;

    // Extract message content using Kotaete helper
    const content = Kotaete.extractMessageContent(msg.message);
    if (!content) return;

    // Check if it matches the quiz answer
    await this.kotaete.checkAnswer(
      msg.key.remoteJid,
      content,
      msg.key,
    );
  }
}
