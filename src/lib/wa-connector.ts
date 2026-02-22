import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { EventEmitter } from "events";
import pino from "pino";
import path from "path";
import fs from "fs";
import { queries } from "./db";

const AUTH_DIR = path.join(process.cwd(), "data", "wa-sessions");
const MEDIA_DIR = path.join(process.cwd(), "data", "media");
fs.mkdirSync(AUTH_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

interface ParsedMessage {
  msgId: string;
  chatJid: string;
  chatName: string;
  senderJid: string;
  senderName: string;
  fromChild: boolean;
  body: string;
  timestamp: number;
  mediaType: string | null;
  mediaPath: string | null;
  rawMsg: any; // keep raw for media download
}

export class WAConnector extends EventEmitter {
  private socket: WASocket | null = null;
  private accountId: string;
  private syncDone = false;
  private messageBuffer: ParsedMessage[] = [];

  constructor(accountId: string) {
    super();
    this.accountId = accountId;
  }

  async connect(): Promise<void> {
    const authDir = path.join(AUTH_DIR, this.accountId);
    fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const logger = pino({ level: "silent" });

    this.socket = makeWASocket({
      auth: state,
      logger,
      printQRInTerminal: false,
      browser: ["Kids Monitor", "Chrome", "1.0.0"],
      syncFullHistory: true,
    });

    this.socket.ev.on("creds.update", saveCreds);

    this.socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        queries.updateAccountStatus.run("qr", this.accountId);
        this.emit("qr", qr);
      }

      if (connection === "open") {
        queries.updateAccountStatus.run("syncing", this.accountId);
        this.emit("connected");

        // Timeout — if no history in 60s, mark ready
        setTimeout(() => {
          if (!this.syncDone) {
            this.syncDone = true;
            this.flushBuffer();
            queries.updateAccountStatus.run("ready", this.accountId);
            this.emit("ready");
          }
        }, 60000);
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        if (statusCode === DisconnectReason.loggedOut) {
          queries.updateAccountStatus.run("disconnected", this.accountId);
          this.emit("logged_out");
        } else {
          queries.updateAccountStatus.run("connecting", this.accountId);
          this.connect(); // reconnect
        }
      }
    });

    // History sync
    this.socket.ev.on("messaging-history.set", (data) => {
      const { chats, messages, progress, isLatest } = data;

      if (chats) {
        for (const chat of chats) {
          if (!chat.id || chat.id === "status@broadcast") continue;
          const isGroup = chat.id.endsWith("@g.us");
          queries.upsertContact.run(
            this.accountId,
            chat.id,
            chat.name || chat.id.split("@")[0],
            isGroup ? 1 : 0,
            0, // member count updated later
          );
        }
      }

      if (messages) {
        for (const msg of messages) {
          const parsed = this.parseMessage(msg);
          if (parsed) this.messageBuffer.push(parsed);
        }
      }

      this.emit("sync_progress", {
        progress: progress || 0,
        messages: this.messageBuffer.length,
      });

      if (progress === 100 || isLatest) {
        this.syncDone = true;
        this.flushBuffer();
        this.fetchGroupMembers().catch(() => {});
        queries.updateAccountStatus.run("ready", this.accountId);
        this.emit("ready");
      }
    });

    // Real-time messages after sync
    this.socket.ev.on("messages.upsert", (data) => {
      for (const msg of data.messages) {
        const parsed = this.parseMessage(msg);
        if (parsed) {
          if (this.syncDone) {
            this.persistMessage(parsed);
          } else {
            this.messageBuffer.push(parsed);
          }
        }
      }
    });

    queries.updateAccountStatus.run("connecting", this.accountId);
  }

  /**
   * Flush buffered messages to DB (after sync)
   */
  private flushBuffer(): void {
    console.log(`[${this.accountId}] Flushing ${this.messageBuffer.length} messages to DB...`);
    let inserted = 0;
    for (const msg of this.messageBuffer) {
      const result = this.persistMessage(msg);
      if (result) inserted++;
    }
    console.log(`[${this.accountId}] Persisted ${inserted} new messages (${this.messageBuffer.length - inserted} duplicates skipped)`);
    this.messageBuffer = [];
  }

  private persistMessage(msg: ParsedMessage): boolean {
    try {
      const result = queries.insertMessage.run(
        this.accountId,
        msg.msgId,
        msg.chatJid,
        msg.chatName,
        msg.senderJid,
        msg.senderName,
        msg.fromChild ? 1 : 0,
        msg.body,
        msg.timestamp,
        msg.mediaType,
        msg.mediaPath,
      );
      if (result.changes > 0) {
        // Update contact
        queries.upsertContact.run(
          this.accountId,
          msg.chatJid,
          msg.chatName,
          msg.chatJid.endsWith("@g.us") ? 1 : 0,
          0,
        );
        // Download media in background
        if (msg.mediaType && msg.rawMsg) {
          this.downloadMedia(msg).catch(() => {});
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Download media from WhatsApp and save to disk
   */
  private async downloadMedia(msg: ParsedMessage): Promise<void> {
    if (!this.socket || !msg.rawMsg || !msg.mediaType) return;

    try {
      const buffer = await downloadMediaMessage(
        msg.rawMsg,
        "buffer",
        {},
      );

      if (!buffer || (buffer as Buffer).length === 0) return;

      const ext = {
        image: "jpg",
        video: "mp4",
        audio: "ogg",
        document: "bin",
        sticker: "webp",
      }[msg.mediaType] || "bin";

      const accountMediaDir = path.join(MEDIA_DIR, this.accountId);
      fs.mkdirSync(accountMediaDir, { recursive: true });

      const filename = `${msg.timestamp}_${msg.msgId.slice(0, 8)}.${ext}`;
      const filePath = path.join(accountMediaDir, filename);
      fs.writeFileSync(filePath, buffer as Buffer);

      // Update DB with media path
      queries.updateMediaPath.run(filePath, this.accountId, msg.msgId);
    } catch (err) {
      // Media download can fail (expired, deleted, etc.) — non-critical
    }
  }

  private parseMessage(msg: any): ParsedMessage | null {
    const content = msg.message;
    if (!content) return null;

    let body = "";
    let mediaType: string | null = null;

    if (content.conversation) {
      body = content.conversation;
    } else if (content.extendedTextMessage?.text) {
      body = content.extendedTextMessage.text;
    } else if (content.imageMessage) {
      body = content.imageMessage.caption
        ? `[תמונה] ${content.imageMessage.caption}`
        : "[תמונה]";
      mediaType = "image";
    } else if (content.videoMessage) {
      body = content.videoMessage.caption
        ? `[סרטון] ${content.videoMessage.caption}`
        : "[סרטון]";
      mediaType = "video";
    } else if (content.audioMessage) {
      const duration = content.audioMessage.seconds || 0;
      body = content.audioMessage.ptt
        ? `[הודעה קולית ${duration}s]`
        : `[קובץ שמע ${duration}s]`;
      mediaType = "audio";
    } else if (content.stickerMessage) {
      body = "[סטיקר]";
      mediaType = "sticker";
    } else if (content.documentMessage) {
      body = `[קובץ] ${content.documentMessage.title || content.documentMessage.fileName || ""}`;
      mediaType = "document";
    } else {
      return null;
    }

    if (!body.trim()) return null;

    const chatJid = msg.key.remoteJid || "";
    if (!chatJid || chatJid === "status@broadcast") return null;

    return {
      msgId: msg.key.id || `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      chatJid,
      chatName: msg.pushName || chatJid.split("@")[0],
      senderJid: msg.key.participant || msg.key.remoteJid || chatJid,
      senderName: msg.pushName || "",
      fromChild: msg.key.fromMe || false,
      body,
      timestamp: (msg.messageTimestamp as number) || Math.floor(Date.now() / 1000),
      mediaType,
      mediaPath: null,
      rawMsg: mediaType ? msg : null, // keep raw only for media messages
    };
  }

  /**
   * Fetch group metadata and store members for all known groups.
   * Used to filter out groups containing safe (blocked) contacts.
   */
  private async fetchGroupMembers(): Promise<void> {
    if (!this.socket) return;
    const groups = queries.getGroups.all(this.accountId) as any[];
    console.log(`[${this.accountId}] Fetching members for ${groups.length} groups...`);
    for (const group of groups) {
      try {
        const metadata = await this.socket.groupMetadata(group.jid);
        if (metadata?.participants) {
          queries.clearGroupMembers.run(this.accountId, group.jid);
          for (const p of metadata.participants) {
            queries.upsertGroupMember.run(this.accountId, group.jid, p.id);
          }
        }
      } catch {
        // Group metadata fetch can fail — non-critical
      }
    }
    console.log(`[${this.accountId}] Group members sync done`);
  }

  isReady(): boolean {
    return this.syncDone;
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
    queries.updateAccountStatus.run("disconnected", this.accountId);
  }

  /**
   * Full logout: disconnect + delete session files.
   * The WhatsApp link is completely removed — requires new QR pairing to reconnect.
   */
  async logout(): Promise<void> {
    if (this.socket) {
      try { await this.socket.logout(); } catch {}
      this.socket.end(undefined);
      this.socket = null;
    }

    // Delete session files from disk
    const authDir = path.join(AUTH_DIR, this.accountId);
    try { fs.rmSync(authDir, { recursive: true, force: true }); } catch {}

    queries.updateAccountStatus.run("disconnected", this.accountId);
  }
}
