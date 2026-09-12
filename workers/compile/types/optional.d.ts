declare module "bullmq" {
  export class Worker<T = unknown, R = unknown> {
    constructor(
      name: string,
      processor: (job: { id?: string; data: T }) => Promise<R>,
      opts?: { connection?: unknown; concurrency?: number },
    );
    on(event: string, cb: (...args: unknown[]) => void): void;
  }
}

declare module "ioredis" {
  const IORedis: new (url: string, opts?: Record<string, unknown>) => unknown;
  export default IORedis;
}
