import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";

const bucket = process.env.S3_BUCKET ?? "outreach-resources";

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "outreach",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "outreach-secret",
  },
});

let bucketReady: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })().catch((e: unknown) => {
    // Don't cache a failed bootstrap forever — a transient MinIO outage
    // would otherwise permanently break every future call. Reset so the
    // next ensureBucket() retries from scratch.
    bucketReady = null;
    throw e;
  });
  return bucketReady;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<{ key: string }> {
  await ensureBucket();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  return { key };
}

export async function getObject(key: string): Promise<{ body: Uint8Array; contentType: string } | null> {
  await ensureBucket();
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await res.Body!.transformToByteArray();
    return { body, contentType: res.ContentType ?? "application/octet-stream" };
  } catch (e: unknown) {
    const name = (e as { name?: string })?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw e;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await ensureBucket();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
