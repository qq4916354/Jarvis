import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelService } from './model-service';

describe('ModelService', () => {
  let service: ModelService;

  beforeEach(() => {
    service = new ModelService({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-api-key',
      timeoutMs: 5000,
      maxRetries: 2,
    });
  });

  describe('constructor', () => {
    it('should create with required config', () => {
      const svc = new ModelService({
        baseUrl: 'https://api.test.com/v1',
        apiKey: 'key',
      });
      expect(svc).toBeDefined();
    });
  });

  describe('setModelsForWorkspace / getModelForPurpose', () => {
    it('should set and retrieve model for purpose', () => {
      service.setModelsForWorkspace('w1', [
        { provider: 'openai', modelName: 'gpt-4', apiKey: 'k', purpose: 'chat' },
        { provider: 'openai', modelName: 'dall-e-3', apiKey: 'k', purpose: 'image' },
      ]);

      expect(service.getModelForPurpose('w1', 'chat')).toBe('gpt-4');
      expect(service.getModelForPurpose('w1', 'image')).toBe('dall-e-3');
    });

    it('should prefer modelId over modelName', () => {
      service.setModelsForWorkspace('w1', [
        { provider: 'openai', modelName: 'gpt-4', modelId: 'gpt-4-turbo', apiKey: 'k', purpose: 'chat' },
      ]);

      expect(service.getModelForPurpose('w1', 'chat')).toBe('gpt-4-turbo');
    });

    it('should return undefined for unknown workspace', () => {
      expect(service.getModelForPurpose('unknown', 'chat')).toBeUndefined();
    });

    it('should return undefined for unmapped purpose', () => {
      service.setModelsForWorkspace('w1', [
        { provider: 'openai', modelName: 'gpt-4', apiKey: 'k', purpose: 'chat' },
      ]);

      expect(service.getModelForPurpose('w1', 'video')).toBeUndefined();
    });

    it('should support multiple workspaces', () => {
      service.setModelsForWorkspace('w1', [
        { provider: 'openai', modelName: 'gpt-4', apiKey: 'k', purpose: 'chat' },
      ]);
      service.setModelsForWorkspace('w2', [
        { provider: 'anthropic', modelName: 'claude-3', apiKey: 'k', purpose: 'chat' },
      ]);

      expect(service.getModelForPurpose('w1', 'chat')).toBe('gpt-4');
      expect(service.getModelForPurpose('w2', 'chat')).toBe('claude-3');
    });

    it('should overwrite existing mappings', () => {
      service.setModelsForWorkspace('w1', [
        { provider: 'openai', modelName: 'gpt-4', apiKey: 'k', purpose: 'chat' },
      ]);
      service.setModelsForWorkspace('w1', [
        { provider: 'openai', modelName: 'gpt-4o', apiKey: 'k', purpose: 'chat' },
      ]);

      expect(service.getModelForPurpose('w1', 'chat')).toBe('gpt-4o');
    });
  });

  // Note: chat(), generateImage(), generateVideo(), listModels() require
  // API calls. They're tested at integration level or with mocked OpenAI client.
  // Here we verify the service handles config correctly.

  describe('chat - error handling', () => {
    it('should throw when API call fails and retries exhausted', async () => {
      // The actual OpenAI client will fail with bad URL, testing retry exhaustion
      const svc = new ModelService({
        baseUrl: 'http://localhost:1', // non-existent
        apiKey: 'test',
        maxRetries: 0,
      });

      await expect(
        svc.chat([{ role: 'user', content: 'test' }], { model: 'gpt-4' }),
      ).rejects.toThrow();
    });
  });
});
