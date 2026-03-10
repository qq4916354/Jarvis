import OpenAI from 'openai';
import type {
  ApiConfig,
  ModelPurpose,
  ModelConfig,
  ModelInfo,
  ChatMessage,
  ChatOptions,
  ChatStreamChunk,
  ChatResponse,
  ImageGenerationOptions,
  ImageGenerationResult,
  VideoGenerationOptions,
  VideoGenerationResult,
} from '../types';

/**
 * Default number of retry attempts for transient API failures.
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Base delay in ms for exponential back-off between retries.
 */
const BASE_RETRY_DELAY_MS = 500;

/**
 * HTTP status codes considered transient / retryable.
 */
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * ModelService provides a unified interface for interacting with
 * OpenAI-compatible model APIs.  Each workspace can map different
 * model purposes (chat, image, video, heartbeat, task) to specific
 * model IDs, allowing fine-grained control over which model backs
 * each capability.
 */
export class ModelService {
  private client: OpenAI;
  private config: Required<ApiConfig>;

  /**
   * Per-workspace mapping of purpose -> model ID.
   * Outer key: workspaceId, inner key: ModelPurpose.
   */
  private purposeMap: Map<string, Map<ModelPurpose, string>> = new Map();

  constructor(apiConfig: ApiConfig) {
    this.config = {
      baseUrl: apiConfig.baseUrl,
      apiKey: apiConfig.apiKey,
      timeoutMs: apiConfig.timeoutMs ?? 60_000,
      maxRetries: apiConfig.maxRetries ?? DEFAULT_MAX_RETRIES,
    };

    this.client = new OpenAI({
      baseURL: this.config.baseUrl,
      apiKey: this.config.apiKey,
      timeout: this.config.timeoutMs,
      maxRetries: 0, // we handle retries ourselves for finer control
    });
  }

  // ---------------------------------------------------------------------------
  // Configuration helpers
  // ---------------------------------------------------------------------------

  /**
   * Register one or more model-purpose mappings for a workspace.
   */
  setModelsForWorkspace(workspaceId: string, configs: ModelConfig[]): void {
    let inner = this.purposeMap.get(workspaceId);
    if (!inner) {
      inner = new Map();
      this.purposeMap.set(workspaceId, inner);
    }
    for (const cfg of configs) {
      inner.set(cfg.purpose, cfg.modelId ?? cfg.modelName);
    }
  }

  /**
   * Retrieve the model ID configured for a given purpose in a workspace.
   * Returns `undefined` when no mapping exists.
   */
  getModelForPurpose(workspaceId: string, purpose: ModelPurpose): string | undefined {
    return this.purposeMap.get(workspaceId)?.get(purpose);
  }

  // ---------------------------------------------------------------------------
  // Chat completions
  // ---------------------------------------------------------------------------

  /**
   * Perform a **non-streaming** chat completion and return the full response.
   */
  async chat(messages: ChatMessage[], options: ChatOptions & { stream?: false }): Promise<ChatResponse>;

  /**
   * Perform a **streaming** chat completion, yielding chunks as they arrive.
   */
  async chat(messages: ChatMessage[], options: ChatOptions & { stream: true }): Promise<AsyncGenerator<ChatStreamChunk>>;

  /**
   * Unified chat implementation with overloaded signatures.
   */
  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {},
  ): Promise<ChatResponse | AsyncGenerator<ChatStreamChunk>> {
    const model = options.model ?? 'gpt-4';

    const params: OpenAI.ChatCompletionCreateParams = {
      model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      stop: options.stop,
      stream: options.stream ?? false,
      ...(options.tools && {
        tools: options.tools as OpenAI.ChatCompletionTool[],
      }),
      ...(options.responseFormat && {
        response_format: options.responseFormat,
      }),
    };

    if (options.stream) {
      return this.chatStream(params);
    }

    return this.withRetry(async () => {
      const response = await this.client.chat.completions.create({
        ...params,
        stream: false,
      });
      return this.mapChatResponse(response);
    });
  }

  /**
   * Internal async generator that drives a streaming completion.
   */
  private async *chatStream(
    params: OpenAI.ChatCompletionCreateParams,
  ): AsyncGenerator<ChatStreamChunk> {
    const stream = await this.withRetry(() =>
      this.client.chat.completions.create({ ...params, stream: true }),
    );

    for await (const chunk of stream) {
      yield {
        id: chunk.id,
        choices: chunk.choices.map((c) => ({
          index: c.index,
          delta: {
            role: c.delta.role as ChatMessage['role'] | undefined,
            content: c.delta.content ?? undefined,
            tool_calls: c.delta.tool_calls as ChatMessage['tool_calls'] | undefined,
          },
          finish_reason: c.finish_reason,
        })),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Image generation
  // ---------------------------------------------------------------------------

  /**
   * Generate one or more images from a text prompt.
   */
  async generateImage(
    prompt: string,
    options: ImageGenerationOptions = {},
  ): Promise<ImageGenerationResult> {
    const model = options.model ?? 'dall-e-3';

    return this.withRetry(async () => {
      const response = await this.client.images.generate({
        model,
        prompt,
        n: options.n ?? 1,
        size: options.size ?? '1024x1024',
        quality: options.quality ?? 'standard',
        style: options.style,
        response_format: options.responseFormat ?? 'url',
      });

      return {
        created: response.created,
        data: (response.data ?? []).map((img) => ({
          url: img.url ?? undefined,
          b64_json: img.b64_json ?? undefined,
          revised_prompt: img.revised_prompt ?? undefined,
        })),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Video generation
  // ---------------------------------------------------------------------------

  /**
   * Submit a video generation request.
   *
   * Video generation is not part of the standard OpenAI SDK, so we fall back
   * to a raw POST against the configured base URL.  The exact endpoint shape
   * (`/v1/videos/generations`) follows the emerging convention used by several
   * OpenAI-compatible providers.
   */
  async generateVideo(
    prompt: string,
    options: VideoGenerationOptions = {},
  ): Promise<VideoGenerationResult> {
    const model = options.model ?? 'video-default';

    return this.withRetry(async () => {
      const url = `${this.config.baseUrl.replace(/\/+$/, '')}/videos/generations`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          duration: options.duration,
          size: options.size,
          fps: options.fps,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        const err = new Error(
          `Video generation failed: ${response.status} ${response.statusText} – ${errorBody}`,
        );
        (err as NodeJS.ErrnoException).code = String(response.status);
        throw err;
      }

      return (await response.json()) as VideoGenerationResult;
    });
  }

  // ---------------------------------------------------------------------------
  // Model listing
  // ---------------------------------------------------------------------------

  /**
   * List all models available at the configured API endpoint.
   */
  async listModels(): Promise<ModelInfo[]> {
    return this.withRetry(async () => {
      const list = await this.client.models.list();
      const models: ModelInfo[] = [];
      for await (const m of list) {
        models.push({
          id: m.id,
          object: m.object,
          created: m.created,
          owned_by: m.owned_by,
        });
      }
      return models;
    });
  }

  // ---------------------------------------------------------------------------
  // Retry logic
  // ---------------------------------------------------------------------------

  /**
   * Execute `fn` with automatic retries for transient failures.
   * Uses exponential back-off with jitter.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error;

        if (!this.isRetryable(error) || attempt === this.config.maxRetries) {
          throw error;
        }

        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5);
        await this.sleep(delay);
      }
    }

    // Unreachable in practice, but satisfies the type-checker.
    throw lastError;
  }

  /**
   * Determine whether an error is transient and worth retrying.
   */
  private isRetryable(error: unknown): boolean {
    if (error instanceof OpenAI.APIError) {
      return RETRYABLE_STATUS_CODES.has(error.status);
    }

    // Network-level errors (ECONNRESET, ETIMEDOUT, etc.)
    if (error instanceof TypeError || (error as NodeJS.ErrnoException)?.code === 'ECONNRESET') {
      return true;
    }

    // fetch/AbortSignal timeout
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return true;
    }

    // Raw HTTP status stored on custom errors from generateVideo
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code &&
      RETRYABLE_STATUS_CODES.has(Number((error as NodeJS.ErrnoException).code))
    ) {
      return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private mapChatResponse(raw: OpenAI.ChatCompletion): ChatResponse {
    return {
      id: raw.id,
      choices: raw.choices.map((c) => ({
        index: c.index,
        message: {
          role: c.message.role,
          content: c.message.content,
          tool_calls: c.message.tool_calls as ChatMessage['tool_calls'],
        },
        finish_reason: c.finish_reason,
      })),
      usage: raw.usage
        ? {
            prompt_tokens: raw.usage.prompt_tokens,
            completion_tokens: raw.usage.completion_tokens,
            total_tokens: raw.usage.total_tokens,
          }
        : undefined,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
