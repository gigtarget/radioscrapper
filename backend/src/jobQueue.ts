type Task = () => Promise<void>;

export class InProcessQueue {
  private queue: Task[] = [];
  private running = false;

  enqueue(task: Task): void {
    this.queue.push(task);
    this.kick();
  }

  private async kick(): Promise<void> {
    if (this.running) return;
    const next = this.queue.shift();
    if (!next) return;

    this.running = true;
    try {
      await next();
    } finally {
      this.running = false;
      void this.kick();
    }
  }
}
