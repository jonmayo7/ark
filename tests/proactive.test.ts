// ============================================================================
// Ark — Proactive Messaging Tests
// ============================================================================

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TaskQueue, type TaskQueueEntry } from '../src/proactive/index.js';

describe('Proactive Messaging', () => {
  let queue: TaskQueue;
  const delivered: TaskQueueEntry[] = [];

  beforeEach(() => {
    queue = new TaskQueue('test-agent');
    delivered.length = 0;

    queue.onDeliver('message', async (task) => {
      delivered.push(task);
      return { success: true };
    });

    queue.onDeliver('scheduled', async (task) => {
      delivered.push(task);
      return { success: true };
    });

    queue.onDeliver('triggered', async (task) => {
      delivered.push(task);
      return { success: true };
    });
  });

  describe('TaskQueue', () => {
    it('enqueues a message', () => {
      const id = queue.sendMessage('Hello world');
      assert.ok(id.startsWith('task_'));

      const task = queue.getTask(id);
      assert.ok(task);
      assert.equal(task.content, 'Hello world');
      assert.equal(task.status, 'pending');
      assert.equal(task.task_type, 'message');
      assert.equal(task.agent_name, 'test-agent');
    });

    it('delivers pending messages', async () => {
      queue.sendMessage('msg1');
      queue.sendMessage('msg2');

      const results = await queue.processPending();
      assert.equal(results.length, 2);
      assert.equal(delivered.length, 2);
      assert.equal(delivered[0].content, 'msg1');
      assert.equal(delivered[1].content, 'msg2');
    });

    it('delivers in priority order', async () => {
      queue.enqueue({
        agent_name: 'test',
        task_type: 'message',
        content: 'low priority',
        priority: 5,
      });
      queue.enqueue({
        agent_name: 'test',
        task_type: 'message',
        content: 'high priority',
        priority: 1,
      });

      await queue.processPending();
      assert.equal(delivered[0].content, 'high priority');
      assert.equal(delivered[1].content, 'low priority');
    });

    it('schedules messages for future delivery', async () => {
      const future = new Date(Date.now() + 60_000); // 1 minute from now
      queue.schedule('future msg', future);

      // Should NOT deliver yet
      const results = await queue.processPending();
      assert.equal(results.length, 0);
      assert.equal(queue.pendingCount, 1);
    });

    it('delivers scheduled messages when time arrives', async () => {
      const past = new Date(Date.now() - 1000); // 1 second ago
      queue.schedule('past msg', past);

      const results = await queue.processPending();
      assert.equal(results.length, 1);
      assert.equal(delivered[0].content, 'past msg');
    });

    it('handles triggered tasks', async () => {
      queue.onTrigger('user_login', 'Welcome back!');
      queue.onTrigger('user_login', 'Check your dashboard');
      queue.onTrigger('other_event', 'Different event');

      // Regular processing should NOT deliver triggered tasks
      const pending = await queue.processPending();
      assert.equal(pending.length, 0);

      // Fire the trigger
      const triggered = await queue.fireTrigger('user_login');
      assert.equal(triggered.length, 2);
      assert.equal(delivered.length, 2);

      // Other trigger unaffected
      assert.equal(queue.pendingCount, 1);
    });

    it('cancels pending tasks', () => {
      const id = queue.sendMessage('will cancel');
      assert.equal(queue.pendingCount, 1);

      const cancelled = queue.cancel(id);
      assert.ok(cancelled);
      assert.equal(queue.pendingCount, 0);

      const task = queue.getTask(id);
      assert.equal(task?.status, 'failed');
      assert.equal(task?.error, 'Cancelled');
    });

    it('cannot cancel delivered tasks', async () => {
      const id = queue.sendMessage('delivered');
      await queue.processPending();

      const cancelled = queue.cancel(id);
      assert.equal(cancelled, false);
    });

    it('handles delivery failures', async () => {
      queue.onDeliver('message', async () => {
        return { success: false, error: 'Network error' };
      });

      const id = queue.sendMessage('will fail');
      await queue.processPending();

      const task = queue.getTask(id);
      assert.equal(task?.status, 'failed');
      assert.equal(task?.error, 'Network error');
    });

    it('handles delivery exceptions', async () => {
      queue.onDeliver('message', async () => {
        throw new Error('Connection refused');
      });

      const id = queue.sendMessage('will throw');
      await queue.processPending();

      const task = queue.getTask(id);
      assert.equal(task?.status, 'failed');
      assert.equal(task?.error, 'Connection refused');
    });

    it('filters tasks by status', async () => {
      queue.sendMessage('msg1');
      queue.sendMessage('msg2');
      const id3 = queue.sendMessage('msg3');
      queue.cancel(id3);

      assert.equal(queue.getTasks('pending').length, 2);
      assert.equal(queue.getTasks('failed').length, 1);

      await queue.processPending();

      assert.equal(queue.getTasks('delivered').length, 2);
      assert.equal(queue.getTasks('pending').length, 0);
    });

    it('sets delivered_at on successful delivery', async () => {
      const id = queue.sendMessage('timestamped');
      await queue.processPending();

      const task = queue.getTask(id);
      assert.ok(task?.delivered_at);
      assert.ok(new Date(task.delivered_at).getTime() > 0);
    });

    it('supports message with recipient and metadata', () => {
      const id = queue.sendMessage('hello', 'user_123', { channel: 'telegram' });

      const task = queue.getTask(id);
      assert.equal(task?.recipient, 'user_123');
      assert.deepEqual(task?.metadata, { channel: 'telegram' });
    });

    it('starts and stops polling', () => {
      queue.startPolling();
      // Calling start again is a no-op
      queue.startPolling();
      queue.stopPolling();
      // Calling stop again is safe
      queue.stopPolling();
    });

    it('reports pending count', () => {
      assert.equal(queue.pendingCount, 0);
      queue.sendMessage('a');
      queue.sendMessage('b');
      assert.equal(queue.pendingCount, 2);
    });

    it('falls back to message handler for unknown types', async () => {
      queue.enqueue({
        agent_name: 'test',
        task_type: 'scheduled',
        content: 'uses scheduled handler',
        priority: 1,
      });

      // Remove the scheduled handler — should fall back to message handler
      const q2 = new TaskQueue('test');
      q2.onDeliver('message', async (task) => {
        delivered.push(task);
        return { success: true };
      });
      q2.enqueue({
        agent_name: 'test',
        task_type: 'scheduled',
        content: 'falls back',
        priority: 1,
      });

      await q2.processPending();
      assert.equal(delivered.length, 1);
      assert.equal(delivered[0].content, 'falls back');
    });
  });
});
