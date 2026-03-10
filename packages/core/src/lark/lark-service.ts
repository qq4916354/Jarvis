// ============================================================================
// LarkService - Feishu/Lark Integration for Jarvis
// ============================================================================
//
// Provides workspace <-> Lark group chat binding with real-time message sync,
// streaming message updates, and event subscription via Lark Open API v2.
// ============================================================================

import type { LarkConfig } from '../types';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LARK_BASE_URL = 'https://open.feishu.cn/open-apis';

/** Tenant access tokens expire after 2 hours; refresh a bit early. */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** Default timeout for HTTP requests (15 s). */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Max retry attempts for transient failures. */
const MAX_RETRIES = 3;

/** Base delay for exponential back-off (ms). */
const BASE_RETRY_DELAY_MS = 500;

/** HTTP status codes that are safe to retry. */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/** Lark-specific error codes that indicate a token has expired. */
const TOKEN_EXPIRED_CODES = new Set([99991663, 99991661]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LarkMessageType = 'text' | 'rich_text' | 'image' | 'interactive';

export interface LarkMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  content: string;
  msgType: LarkMessageType;
  createTime: string;
}

export interface LarkEvent {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: Record<string, unknown>;
}

interface TokenInfo {
  token: string;
  expiresAt: number;
}

interface LarkApiResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
}

type EventHandler = (event: LarkEvent) => void | Promise<void>;

// ---------------------------------------------------------------------------
// LarkService
// ---------------------------------------------------------------------------

export class LarkService {
  private appId = '';
  private appSecret = '';
  private verificationToken = '';

  /** workspace-id -> chat-id binding. */
  private bindings: Map<string, string> = new Map();

  /** Cached tenant access token. */
  private tokenInfo: TokenInfo | null = null;

  /** Whether event subscription is active. */
  private subscriptionActive = false;
  private eventPollTimer: ReturnType<typeof setTimeout> | null = null;
  private eventHandlers: EventHandler[] = [];

  /** Abort controller for the long-poll / event loop. */
  private abortController: AbortController | null = null;

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  /**
   * Initialise the service with Lark application credentials.
   *
   * @param config - LarkConfig containing appId, appSecret, and optional
   *   groupId / webhookUrl.
   */
  init(config: LarkConfig): void {
    if (!config.appId || !config.appSecret) {
      throw new Error('LarkService.init: appId and appSecret are required');
    }

    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.verificationToken = '';

    // If a default group is provided, we do not bind it to any workspace yet
    // (the caller should use bindGroup explicitly).
    logger.info('LarkService initialised', { appId: this.appId });
  }

  // -------------------------------------------------------------------------
  // Workspace ↔ Group Binding
  // -------------------------------------------------------------------------

  /**
   * Bind a workspace to a Lark group (chat) so that subsequent message
   * operations for that workspace target the correct chat.
   */
  bindGroup(workspaceId: string, chatId: string): void {
    if (!workspaceId || !chatId) {
      throw new Error('LarkService.bindGroup: workspaceId and chatId are required');
    }
    this.bindings.set(workspaceId, chatId);
    logger.info('Lark group bound', { workspaceId, chatId });
  }

  /**
   * Remove the binding for a workspace.
   */
  unbindGroup(workspaceId: string): void {
    const existed = this.bindings.delete(workspaceId);
    if (existed) {
      logger.info('Lark group unbound', { workspaceId });
    }
  }

  /**
   * Get the chat ID bound to a workspace, or `undefined` if none is bound.
   */
  getChatId(workspaceId: string): string | undefined {
    return this.bindings.get(workspaceId);
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  /**
   * Send a message to the Lark group bound to `workspaceId`.
   *
   * @returns The Lark message ID of the sent message.
   */
  async sendMessage(
    workspaceId: string,
    content: string,
    msgType: LarkMessageType = 'text',
  ): Promise<string> {
    const chatId = this.requireChatId(workspaceId);
    const body = this.buildMessageBody(content, msgType);

    const res = await this.request<{ message_id: string }>(
      'POST',
      `/im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: chatId,
        msg_type: msgType,
        content: body,
      },
    );

    logger.debug('Message sent to Lark', {
      workspaceId,
      chatId,
      messageId: res.message_id,
    });

    return res.message_id;
  }

  /**
   * Send a streaming message: create an initial message then progressively
   * update (PATCH) its content as more data arrives from the provided
   * async iterable / readable stream.
   *
   * @param workspaceId - Workspace whose bound chat will receive the message.
   * @param stream      - An async iterable that yields string chunks.
   * @returns The Lark message ID.
   */
  async sendStreamMessage(
    workspaceId: string,
    stream: AsyncIterable<string>,
  ): Promise<string> {
    const chatId = this.requireChatId(workspaceId);

    let accumulated = '';
    let messageId: string | null = null;
    let chunkIndex = 0;

    // Minimum interval between PATCH calls to avoid rate-limiting (ms).
    const UPDATE_INTERVAL_MS = 300;
    let lastUpdateTime = 0;
    // Buffer for content accumulated between patches.
    let pendingContent = '';

    for await (const chunk of stream) {
      accumulated += chunk;
      pendingContent += chunk;
      chunkIndex++;

      if (messageId === null) {
        // First chunk – create the message.
        const body = this.buildMessageBody(accumulated, 'text');
        const res = await this.request<{ message_id: string }>(
          'POST',
          '/im/v1/messages?receive_id_type=chat_id',
          {
            receive_id: chatId,
            msg_type: 'text',
            content: body,
          },
        );
        messageId = res.message_id;
        lastUpdateTime = Date.now();
        pendingContent = '';

        logger.debug('Stream message created', { workspaceId, messageId });
      } else {
        // Subsequent chunks – throttle updates.
        const now = Date.now();
        if (now - lastUpdateTime >= UPDATE_INTERVAL_MS && pendingContent.length > 0) {
          await this.patchMessage(messageId, accumulated);
          lastUpdateTime = Date.now();
          pendingContent = '';
        }
      }
    }

    // Final update to ensure the complete content is reflected.
    if (messageId && pendingContent.length > 0) {
      await this.patchMessage(messageId, accumulated);
    }

    if (!messageId) {
      throw new Error('LarkService.sendStreamMessage: stream yielded no data');
    }

    logger.debug('Stream message completed', {
      workspaceId,
      messageId,
      totalChunks: chunkIndex,
      totalLength: accumulated.length,
    });

    return messageId;
  }

  /**
   * Retrieve messages from the group chat bound to `workspaceId`.
   *
   * @param workspaceId - Workspace whose bound chat to read from.
   * @param since       - Optional Unix-timestamp (seconds string) to fetch
   *   messages after.  Defaults to the last 50 messages.
   */
  async getMessages(workspaceId: string, since?: string): Promise<LarkMessage[]> {
    const chatId = this.requireChatId(workspaceId);

    const params = new URLSearchParams({
      container_id_type: 'chat',
      container_id: chatId,
      page_size: '50',
      sort_type: 'ByCreateTimeAsc',
    });
    if (since) {
      params.set('start_time', since);
    }

    const res = await this.request<{
      items: Array<{
        message_id: string;
        chat_id: string;
        sender: { sender_id: { user_id: string } };
        body: { content: string };
        msg_type: string;
        create_time: string;
      }>;
      has_more: boolean;
      page_token: string;
    }>('GET', `/im/v1/messages?${params.toString()}`);

    const items = res.items ?? [];

    return items.map((item) => ({
      messageId: item.message_id,
      chatId: item.chat_id,
      senderId: item.sender?.sender_id?.user_id ?? '',
      content: item.body?.content ?? '',
      msgType: (item.msg_type ?? 'text') as LarkMessageType,
      createTime: item.create_time,
    }));
  }

  // -------------------------------------------------------------------------
  // Event Subscription
  // -------------------------------------------------------------------------

  /**
   * Register a handler that will be called for every incoming Lark event.
   */
  onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Start polling for real-time events from Lark.
   *
   * This implementation uses a long-poll loop against the Lark event
   * outbox endpoint.  For production use, switch to the WebSocket-based
   * subscription once the SDK is available.
   */
  startEventSubscription(intervalMs = 5_000): void {
    if (this.subscriptionActive) {
      logger.warn('Event subscription already active');
      return;
    }

    this.subscriptionActive = true;
    this.abortController = new AbortController();

    logger.info('Lark event subscription started', { intervalMs });

    const poll = async (): Promise<void> => {
      while (this.subscriptionActive) {
        try {
          // The Lark Open API does not expose a generic long-poll endpoint
          // for custom apps; in practice events arrive via callback URL or
          // WebSocket SDK.  This poll loop is a fallback that checks for new
          // messages in all bound chats.
          for (const [workspaceId, chatId] of this.bindings.entries()) {
            const messages = await this.getMessages(workspaceId);
            // Convert to synthetic events and dispatch.
            for (const msg of messages) {
              const syntheticEvent: LarkEvent = {
                schema: '2.0',
                header: {
                  event_id: `poll_${msg.messageId}`,
                  event_type: 'im.message.receive_v1',
                  create_time: msg.createTime,
                  token: this.verificationToken,
                  app_id: this.appId,
                  tenant_key: '',
                },
                event: {
                  message: {
                    message_id: msg.messageId,
                    chat_id: chatId,
                    content: msg.content,
                    msg_type: msg.msgType,
                    sender_id: msg.senderId,
                  },
                },
              };
              await this.dispatchEvent(syntheticEvent);
            }
          }
        } catch (err) {
          if (this.isAbortError(err)) break;
          logger.error('Lark event poll error', { error: err });
        }

        // Wait before next poll cycle.
        if (this.subscriptionActive) {
          await this.sleep(intervalMs);
        }
      }
    };

    // Fire and forget – errors are caught inside.
    poll().catch((err) => {
      if (!this.isAbortError(err)) {
        logger.error('Lark event poll loop exited unexpectedly', { error: err });
      }
    });
  }

  /**
   * Stop the event subscription loop.
   */
  stopEventSubscription(): void {
    this.subscriptionActive = false;
    this.abortController?.abort();
    this.abortController = null;
    if (this.eventPollTimer) {
      clearTimeout(this.eventPollTimer);
      this.eventPollTimer = null;
    }
    logger.info('Lark event subscription stopped');
  }

  /**
   * Process an incoming Lark event (e.g. from a webhook callback).
   * Verifies the event then dispatches to registered handlers.
   */
  async handleEvent(event: LarkEvent): Promise<void> {
    if (!this.verifyEvent(event)) {
      logger.warn('Lark event verification failed', {
        eventId: event.header?.event_id,
      });
      return;
    }

    await this.dispatchEvent(event);
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  /**
   * Obtain a valid tenant_access_token, refreshing if expired.
   */
  private async getTenantToken(): Promise<string> {
    if (this.tokenInfo && Date.now() < this.tokenInfo.expiresAt) {
      return this.tokenInfo.token;
    }

    logger.debug('Refreshing Lark tenant access token');

    const url = `${LARK_BASE_URL}/auth/v3/tenant_access_token/internal`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Failed to obtain Lark tenant token: HTTP ${res.status} – ${text}`,
      );
    }

    const json = (await res.json()) as {
      code: number;
      msg: string;
      tenant_access_token: string;
      expire: number;
    };

    if (json.code !== 0) {
      throw new Error(
        `Lark token error (code ${json.code}): ${json.msg}`,
      );
    }

    this.tokenInfo = {
      token: json.tenant_access_token,
      // `expire` is in seconds; subtract a buffer so we refresh early.
      expiresAt: Date.now() + json.expire * 1000 - TOKEN_EXPIRY_BUFFER_MS,
    };

    logger.debug('Lark tenant access token refreshed', {
      expiresIn: json.expire,
    });

    return this.tokenInfo.token;
  }

  /**
   * Invalidate the cached token so the next request forces a refresh.
   */
  private invalidateToken(): void {
    this.tokenInfo = null;
  }

  // -------------------------------------------------------------------------
  // HTTP Helpers
  // -------------------------------------------------------------------------

  /**
   * Make an authenticated request to the Lark Open API with automatic
   * retry, token refresh, and rate-limit handling.
   */
  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    attempt = 1,
  ): Promise<T> {
    const token = await this.getTenantToken();
    const url = `${LARK_BASE_URL}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    };

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: this.abortController?.signal ?? undefined,
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, fetchOptions);
    } catch (err) {
      if (this.isAbortError(err)) throw err;
      if (attempt <= MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn('Lark request network error, retrying', {
          attempt,
          delay,
          error: String(err),
        });
        await this.sleep(delay);
        return this.request<T>(method, path, body, attempt + 1);
      }
      throw new Error(`Lark API network error after ${MAX_RETRIES} retries: ${err}`);
    }

    // Handle retryable HTTP statuses.
    if (RETRYABLE_STATUS_CODES.has(res.status) && attempt <= MAX_RETRIES) {
      const retryAfter = res.headers.get('retry-after');
      const delay = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);

      logger.warn('Lark API retryable status, retrying', {
        status: res.status,
        attempt,
        delay,
      });
      await this.sleep(delay);
      return this.request<T>(method, path, body, attempt + 1);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lark API error: HTTP ${res.status} – ${text}`);
    }

    const json = (await res.json()) as LarkApiResponse<T>;

    // Handle Lark-level token expiry errors by refreshing and retrying once.
    if (TOKEN_EXPIRED_CODES.has(json.code)) {
      logger.warn('Lark token expired, refreshing and retrying');
      this.invalidateToken();
      if (attempt <= MAX_RETRIES) {
        return this.request<T>(method, path, body, attempt + 1);
      }
      throw new Error('Lark token expired and retry limit reached');
    }

    if (json.code !== 0) {
      throw new Error(`Lark API error (code ${json.code}): ${json.msg}`);
    }

    return json.data as T;
  }

  // -------------------------------------------------------------------------
  // Message Helpers
  // -------------------------------------------------------------------------

  /**
   * Build the JSON content string expected by Lark for a given message type.
   */
  private buildMessageBody(content: string, msgType: LarkMessageType): string {
    switch (msgType) {
      case 'text':
        return JSON.stringify({ text: content });

      case 'rich_text':
        // Expect `content` to already be a serialised rich-text JSON structure.
        // If it's plain text, wrap it in a minimal rich-text envelope.
        try {
          JSON.parse(content);
          return content;
        } catch {
          return JSON.stringify({
            zh_cn: {
              title: '',
              content: [[{ tag: 'text', text: content }]],
            },
          });
        }

      case 'image':
        return JSON.stringify({ image_key: content });

      case 'interactive':
        // Expect `content` to already be a serialised card JSON.
        try {
          JSON.parse(content);
          return content;
        } catch {
          throw new Error(
            'LarkService: interactive message content must be valid JSON',
          );
        }

      default:
        return JSON.stringify({ text: content });
    }
  }

  /**
   * PATCH an existing message with new text content (used for streaming).
   */
  private async patchMessage(messageId: string, content: string): Promise<void> {
    await this.request<void>(
      'PATCH',
      `/im/v1/messages/${messageId}`,
      {
        msg_type: 'text',
        content: JSON.stringify({ text: content }),
      },
    );
  }

  // -------------------------------------------------------------------------
  // Event Helpers
  // -------------------------------------------------------------------------

  /**
   * Basic event signature / token verification.
   *
   * If a verificationToken was set during init, check that the event's
   * header token matches.  Without a verification token configured this
   * is a no-op (returns true).
   */
  private verifyEvent(event: LarkEvent): boolean {
    if (!this.verificationToken) {
      return true;
    }
    return event.header?.token === this.verificationToken;
  }

  /**
   * Dispatch an event to all registered handlers.
   */
  private async dispatchEvent(event: LarkEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (err) {
        logger.error('Lark event handler threw', {
          eventId: event.header?.event_id,
          error: err,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  /**
   * Require that a chat ID is bound to the given workspace, throwing a
   * descriptive error if not.
   */
  private requireChatId(workspaceId: string): string {
    const chatId = this.bindings.get(workspaceId);
    if (!chatId) {
      throw new Error(
        `LarkService: no Lark group bound for workspace "${workspaceId}". ` +
          'Call bindGroup(workspaceId, chatId) first.',
      );
    }
    return chatId;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isAbortError(err: unknown): boolean {
    return err instanceof DOMException && err.name === 'AbortError';
  }
}
