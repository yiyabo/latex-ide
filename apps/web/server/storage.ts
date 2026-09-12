import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const LOCAL_ROOT =
  process.env.LOCAL_STORAGE_ROOT || path.join(process.cwd(), "data", "storage");

export interface StorageAdapter {
  put(key: string, data: Buffer | string): Promise<void>;
  get(key: string): Promise<Buffer>;
  getText(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Return a URL the client can fetch (local: /api/storage/... or data URL path) */
  publicUrl(key: string): string;
}

function safeKeyToPath(key: string): string {
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (!resolved.startsWith(path.resolve(LOCAL_ROOT))) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  return resolved;
}

class LocalStorage implements StorageAdapter {
  async put(key: string, data: Buffer | string): Promise<void> {
    const file = safeKeyToPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }
  async get(key: string): Promise<Buffer> {
    return readFile(safeKeyToPath(key));
  }
  async getText(key: string): Promise<string> {
    return readFile(safeKeyToPath(key), "utf8");
  }
  async exists(key: string): Promise<boolean> {
    try {
      await stat(safeKeyToPath(key));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string): Promise<void> {
    await rm(safeKeyToPath(key), { force: true, recursive: true });
  }
  publicUrl(key: string): string {
    return `/api/storage/${key}`;
  }
}

// S3 adapter loaded only when configured
class S3Storage implements StorageAdapter {
  private client: import("@aws-sdk/client-s3").S3Client | null = null;
  private bucket = process.env.S3_BUCKET || "latex-ide";

  private async getClient() {
    if (this.client) return this.client;
    const { S3Client } = await import("@aws-sdk/client-s3");
    this.client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
        secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
      },
    });
    return this.client;
  }

  async put(key: string, data: Buffer | string): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
      }),
    );
  }
  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    const res = await client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const chunks: Uint8Array[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const c of stream) chunks.push(c);
    return Buffer.concat(chunks);
  }
  async getText(key: string): Promise<string> {
    return (await this.get(key)).toString("utf8");
  }
  async exists(key: string): Promise<boolean> {
    try {
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await this.getClient();
      await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  publicUrl(key: string): string {
    return `/api/storage/${key}`;
  }
}

export function getStorage(): StorageAdapter {
  if (process.env.STORAGE_DRIVER === "s3") {
    return new S3Storage();
  }
  return new LocalStorage();
}

export function newVersionId(): string {
  return randomUUID();
}
