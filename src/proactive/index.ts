// ============================================================================
// Ark — Proactive Messaging
// Agent-initiated outbound communication via task queue
// ============================================================================

import type { Store } from '../persistence/types.js';

// --- Types ---

export interface TaskQueueEntry {
  id: string;
  agent_name: string;
  task_type: 'message' | 'scheduled' | 'triggered';
  recipient?: string;           // Target user/channel
  content: string;              // Message content
  priority: number;             // 1 = highest
  status: 'pending' | 'claimed' | 'delivered' | 'failed';
  scheduled_for?: string;       // ISO timestamp for scheduled sends
  trigger_event?: string;       // Event name that triggers this task
  metadata?: Record<string, unknown>;
  created_at: string;
  delivered_at?: string;
  error?: string;
}

export type NewTask = Omit<TaskQueueEntry, 'id' | 'status' | 'created_at' | 'delivered_at' | 'error'>;

export interface TaskQueueOptions {
  pollIntervalMs?: number;      // How often to check for pending tasks (default: 30000)
  maxRetries?: number;          // Max delivery attempts (default: 3)
}

/** Delivery handler — called when a task is ready to send */
export type DeliveryHandler = (task: TaskQueueEntry) => Promise<{ success: boolean; error?: string }>;

// --- Task Queue ---

export class TaskQueue {
  private agentName: string;
  private tasks: TaskQueueEntry[] = [];
  private handlers = new Map<string, DeliveryHandler>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private options: Required<TaskQueueOptions>;
  private nextId = 1;

  constructor(agentName: string, options?: TaskQueueOptions) {
    this.agentName = agentName;
    this.options = {
      pollIntervalMs: options?.pollIntervalMs ?? 30000,
      maxRetries: options?.maxRetries ?? 3,
    };
  }

  /** Register a delivery handler for a task type */
  onDeliver(taskType: TaskQueueEntry['task_type'], handler: DeliveryHandler): void {
    this.handlers.set(taskType, handler);
  }

  /** Enqueue a message for delivery */
  enqueue(task: NewTask): string {
    const id = `task_${this.nextId++}`;
    const entry: TaskQueueEntry = {
      ...task,
      id,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    this.tasks.push(entry);
    return id;
  }

  /** Send a message immediately (convenience method) */
  sendMessage(content: string, recipient?: string, metadata?: Record<string, unknown>): string {
    return this.enqueue({
      agent_name: this.agentName,
      task_type: 'message',
      content,
      recipient,
      priority: 2,
      metadata,
    });
  }

  /** Schedule a message for future delivery */
  schedule(content: string, scheduledFor: Date, recipient?: string): string {
    return this.enqueue({
      agent_name: this.agentName,
      task_type: 'scheduled',
      content,
      recipient,
      priority: 3,
      scheduled_for: scheduledFor.toISOString(),
    });
  }

  /** Enqueue a task that fires on a specific event */
  onTrigger(triggerEvent: string, content: string, recipient?: string): string {
    return this.enqueue({
      agent_name: this.agentName,
      task_type: 'triggered',
      content,
      recipient,
      priority: 2,
      trigger_event: triggerEvent,
    });
  }

  /** Fire a trigger event — delivers all matching triggered tasks */
  async fireTrigger(eventName: string): Promise<TaskQueueEntry[]> {
    const triggered = this.tasks.filter(
      t => t.status === 'pending' && t.task_type === 'triggered' && t.trigger_event === eventName,
    );

    const delivered: TaskQueueEntry[] = [];
    for (const task of triggered) {
      const result = await this.deliver(task);
      if (result) delivered.push(task);
    }

    return delivered;
  }

  /** Process all pending tasks that are ready for delivery */
  async processPending(): Promise<TaskQueueEntry[]> {
    const now = new Date();
    const ready = this.tasks.filter(t => {
      if (t.status !== 'pending') return false;
      if (t.task_type === 'triggered') return false; // Triggered tasks wait for events
      if (t.scheduled_for && new Date(t.scheduled_for) > now) return false;
      return true;
    });

    // Sort by priority (lower = higher priority)
    ready.sort((a, b) => a.priority - b.priority);

    const delivered: TaskQueueEntry[] = [];
    for (const task of ready) {
      const result = await this.deliver(task);
      if (result) delivered.push(task);
    }

    return delivered;
  }

  /** Start polling for pending tasks */
  startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.processPending().catch(() => {});
    }, this.options.pollIntervalMs);
  }

  /** Stop polling */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Get all tasks, optionally filtered by status */
  getTasks(status?: TaskQueueEntry['status']): TaskQueueEntry[] {
    if (status) return this.tasks.filter(t => t.status === status);
    return [...this.tasks];
  }

  /** Get a specific task by ID */
  getTask(id: string): TaskQueueEntry | undefined {
    return this.tasks.find(t => t.id === id);
  }

  /** Cancel a pending task */
  cancel(id: string): boolean {
    const task = this.tasks.find(t => t.id === id);
    if (!task || task.status !== 'pending') return false;
    task.status = 'failed';
    task.error = 'Cancelled';
    return true;
  }

  /** Get count of pending tasks */
  get pendingCount(): number {
    return this.tasks.filter(t => t.status === 'pending').length;
  }

  // --- Private ---

  private async deliver(task: TaskQueueEntry): Promise<boolean> {
    const handler = this.handlers.get(task.task_type) || this.handlers.get('message');
    if (!handler) {
      task.status = 'failed';
      task.error = `No delivery handler for task type: ${task.task_type}`;
      return false;
    }

    task.status = 'claimed';

    try {
      const result = await handler(task);
      if (result.success) {
        task.status = 'delivered';
        task.delivered_at = new Date().toISOString();
        return true;
      } else {
        task.status = 'failed';
        task.error = result.error || 'Delivery failed';
        return false;
      }
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
      return false;
    }
  }
}
