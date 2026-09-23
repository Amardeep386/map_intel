import { createHash } from 'node:crypto';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './config.js';

export const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_ENDPOINT || undefined,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials:
    config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
      : undefined,
});

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface StoredObject {
  uri: string; // s3://bucket/key
  key: string;
  sha256: string; // hex
  bytes: number;
}

/**
 * Store a file and return its SHA-256. The hash is sent to S3 as a checksum too, so the
 * storage service rejects the upload if the bytes it received differ from what we hashed.
 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
  const hash = createHash('sha256').update(body);
  const hex = hash.copy().digest('hex');
  const b64 = hash.digest('base64');
  const input: PutObjectCommandInput = {
    Bucket: config.S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    ChecksumSHA256: b64,
    Metadata: { sha256: hex },
  };
  if (config.S3_OBJECT_LOCK_DAYS > 0) {
    input.ObjectLockMode = 'GOVERNANCE';
    input.ObjectLockRetainUntilDate = new Date(Date.now() + config.S3_OBJECT_LOCK_DAYS * 86_400_000);
  }
  await s3.send(new PutObjectCommand(input));
  return { uri: `s3://${config.S3_BUCKET}/${key}`, key, sha256: hex, bytes: body.length };
}

export function keyFromUri(uri: string): string {
  const prefix = `s3://${config.S3_BUCKET}/`;
  return uri.startsWith(prefix) ? uri.slice(prefix.length) : uri.replace(/^s3:\/\/[^/]+\//, '');
}

/** Short-lived download link for an evidence file. */
export async function signedUrl(uri: string, expiresInSeconds = 900): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: keyFromUri(uri) }), {
    expiresIn: expiresInSeconds,
  });
}

export async function ensureBucket(): Promise<'exists' | 'created'> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    return 'exists';
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET, ObjectLockEnabledForBucket: true }));
    return 'created';
  }
}

export async function storageHealthy(): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    return true;
  } catch {
    return false;
  }
}
