import Anthropic from '@anthropic-ai/sdk';

export interface LLMServiceOptions {
  model: string;
  maxResponseTokens: number;
}

export interface StructuredPrompt {
  system: string;
  user: string;
}

export class LLMService {
  private client: Anthropic;
  private options: LLMServiceOptions;
  private currentController: AbortController | undefined;

  constructor(apiKey: string, options: LLMServiceOptions) {
    this.client = new Anthropic({ apiKey });
    this.options = options;
  }

  /** Cancel any in-flight request */
  cancelInFlight() {
    this.currentController?.abort();
    this.currentController = undefined;
  }

  /**
   * Stream a completion. Calls `onChunk` for each text delta.
   * Cancels any previous in-flight request automatically.
   */
  async streamCompletion(
    prompt: StructuredPrompt,
    onChunk: (text: string) => void
  ): Promise<void> {
    // Cancel any previous request
    this.cancelInFlight();

    const controller = new AbortController();
    this.currentController = controller;

    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      const stream = await this.client.messages.stream(
        {
          model: this.options.model,
          max_tokens: this.options.maxResponseTokens,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        },
        { signal: controller.signal }
      );

      for await (const event of stream) {
        if (controller.signal.aborted) {
          break;
        }
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          onChunk(event.delta.text);
        }
      }
    } catch (err: unknown) {
      if (isAbortError(err)) {
        // Cancelled — swallow silently
        return;
      }
      if (isAnthropicError(err)) {
        const status = (err as { status?: number }).status;
        if (status === 429) {
          throw new Error(
            'Rate limit reached. Please wait a moment and try again.'
          );
        }
        if (status === 401) {
          throw new Error(
            'Invalid API key. Use "CodeLens: Set Anthropic API Key" to update it.'
          );
        }
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (this.currentController === controller) {
        this.currentController = undefined;
      }
    }
  }
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.message.includes('aborted'))
  );
}

function isAnthropicError(err: unknown): boolean {
  return err instanceof Error && 'status' in err;
}
