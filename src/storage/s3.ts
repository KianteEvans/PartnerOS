import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/env";

/**
 * S3-compatible object storage. The real adapter (Rule 5) targets any
 * S3-compatible endpoint (AWS S3, MinIO). The local FS adapter is a runnable
 * stub used under PARTNEROS_LOCAL_DEV so the full upload/scan/download path works
 * with no external service. Scan status itself is NOT stored here — it lives in
 * Postgres (see storage/malware-scan.ts), keeping a single datastore (Rule 1).
 */

export interface ObjectStorage {
  /** Presigned PUT URL the client uses to upload directly. */
  presignUpload(input: {
    key: string;
    contentType: string;
    expiresSeconds?: number;
  }): Promise<string>;
  /** Presigned GET URL for download (only ever handed out after a clean scan). */
  presignDownload(input: {
    key: string;
    expiresSeconds?: number;
  }): Promise<string>;
  /** Server-side put (used by stubs/tests). */
  put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

class RealS3Storage implements ObjectStorage {
  private readonly client: S3Client;
  constructor() {
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    expiresSeconds?: number;
  }): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: input.key,
      ContentType: input.contentType,
    });
    return getSignedUrl(this.client, cmd, {
      expiresIn: input.expiresSeconds ?? 900,
    });
  }

  async presignDownload(input: {
    key: string;
    expiresSeconds?: number;
  }): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: input.key });
    return getSignedUrl(this.client, cmd, {
      expiresIn: input.expiresSeconds ?? 900,
    });
  }

  async put(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
      }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Empty object: ${key}`);
    return bytes;
  }
}

/** Filesystem-backed stub. Presigned URLs point at a local dev route. */
class LocalFsStorage implements ObjectStorage {
  private readonly root = join(process.cwd(), ".stub-storage", env.S3_BUCKET);

  private path(key: string): string {
    return join(this.root, key);
  }

  async presignUpload(input: { key: string }): Promise<string> {
    return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${input.key}?stub=put`;
  }
  async presignDownload(input: { key: string }): Promise<string> {
    return `${env.S3_ENDPOINT}/${env.S3_BUCKET}/${input.key}?stub=get`;
  }
  async put(input: { key: string; body: Uint8Array }): Promise<void> {
    const p = this.path(input.key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, input.body);
  }
  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(key)));
  }
}

let _storage: ObjectStorage | null = null;

export function getObjectStorage(): ObjectStorage {
  if (_storage) return _storage;
  _storage = env.IS_LOCAL_DEV ? new LocalFsStorage() : new RealS3Storage();
  return _storage;
}
