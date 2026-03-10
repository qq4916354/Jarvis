import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LarkService } from './lark-service';

describe('LarkService', () => {
  let service: LarkService;

  beforeEach(() => {
    service = new LarkService();
  });

  describe('init', () => {
    it('should initialize with valid config', () => {
      expect(() => {
        service.init({ appId: 'app123', appSecret: 'secret456' });
      }).not.toThrow();
    });

    it('should throw when appId is missing', () => {
      expect(() => {
        service.init({ appId: '', appSecret: 'secret' });
      }).toThrow('appId and appSecret are required');
    });

    it('should throw when appSecret is missing', () => {
      expect(() => {
        service.init({ appId: 'app', appSecret: '' });
      }).toThrow('appId and appSecret are required');
    });
  });

  describe('bindGroup / unbindGroup / getChatId', () => {
    it('should bind workspace to chat', () => {
      service.bindGroup('w1', 'chat123');
      expect(service.getChatId('w1')).toBe('chat123');
    });

    it('should throw when workspaceId is empty', () => {
      expect(() => service.bindGroup('', 'chat123')).toThrow('workspaceId and chatId are required');
    });

    it('should throw when chatId is empty', () => {
      expect(() => service.bindGroup('w1', '')).toThrow('workspaceId and chatId are required');
    });

    it('should unbind workspace', () => {
      service.bindGroup('w1', 'chat123');
      service.unbindGroup('w1');
      expect(service.getChatId('w1')).toBeUndefined();
    });

    it('should return undefined for unbound workspace', () => {
      expect(service.getChatId('unknown')).toBeUndefined();
    });

    it('should support multiple workspace bindings', () => {
      service.bindGroup('w1', 'chat1');
      service.bindGroup('w2', 'chat2');
      expect(service.getChatId('w1')).toBe('chat1');
      expect(service.getChatId('w2')).toBe('chat2');
    });

    it('should overwrite existing binding', () => {
      service.bindGroup('w1', 'chat1');
      service.bindGroup('w1', 'chat2');
      expect(service.getChatId('w1')).toBe('chat2');
    });
  });

  describe('sendMessage - validation', () => {
    it('should throw when workspace has no chat binding', async () => {
      service.init({ appId: 'app', appSecret: 'secret' });
      await expect(
        service.sendMessage('unbound-ws', 'hello'),
      ).rejects.toThrow('no Lark group bound');
    });
  });

  describe('sendStreamMessage - validation', () => {
    it('should throw when stream yields no data', async () => {
      service.init({ appId: 'app', appSecret: 'secret' });
      service.bindGroup('w1', 'chat1');

      // Mock fetch to prevent actual HTTP calls
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      async function* emptyStream() {
        // yields nothing
      }

      await expect(
        service.sendStreamMessage('w1', emptyStream()),
      ).rejects.toThrow('stream yielded no data');
    });
  });

  describe('getMessages - validation', () => {
    it('should throw when workspace has no chat binding', async () => {
      service.init({ appId: 'app', appSecret: 'secret' });
      await expect(
        service.getMessages('unbound-ws'),
      ).rejects.toThrow('no Lark group bound');
    });
  });

  describe('event handling', () => {
    it('should register event handlers', () => {
      const handler = vi.fn();
      service.onEvent(handler);
      // Verify handler was registered (handleEvent will dispatch to it)
      expect(() => service.onEvent(vi.fn())).not.toThrow();
    });

    it('should dispatch events to handlers via handleEvent', async () => {
      const handler = vi.fn();
      service.onEvent(handler);

      const event = {
        schema: '2.0',
        header: {
          event_id: 'evt1',
          event_type: 'im.message.receive_v1',
          create_time: '1234567890',
          token: '',
          app_id: 'app',
          tenant_key: 'tenant',
        },
        event: { message: { content: 'hello' } },
      };

      // Without verification token, all events pass verification
      await service.handleEvent(event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should handle errors in event handlers gracefully', async () => {
      service.onEvent(() => { throw new Error('handler error'); });

      const event = {
        schema: '2.0',
        header: {
          event_id: 'evt1',
          event_type: 'test',
          create_time: '123',
          token: '',
          app_id: 'app',
          tenant_key: 'tenant',
        },
        event: {},
      };

      // Should not throw
      await expect(service.handleEvent(event)).resolves.toBeUndefined();
    });
  });

  describe('event subscription', () => {
    it('should start and stop event subscription', () => {
      service.init({ appId: 'app', appSecret: 'secret' });

      // Mock fetch to prevent actual HTTP calls
      global.fetch = vi.fn().mockRejectedValue(new Error('mocked'));

      service.startEventSubscription(1000);
      // Starting again should warn but not throw
      service.startEventSubscription(1000);
      service.stopEventSubscription();
    });
  });
});
