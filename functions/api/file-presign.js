/**
 * Cloudflare Pages Function — /api/file-presign
 *
 * POST { filename, size } → presigned PUT URL for R2 direct upload
 *
 * Environment secrets required:
 *   - R2_ACCESS_KEY_ID
 *   - R2_SECRET_ACCESS_KEY
 *   - R2_ACCOUNT_ID
 */

import { AwsClient } from "aws4fetch";
import { jsonResponse, errorResponse } from '../lib/response.js';

const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.gif', '.png', '.jpg', '.jpeg', '.webp', '.pdf', '.zip', '.txt', '.csv', '.json'];
const MAX_SIZE = 500 * 1024 * 1024;
const BUCKET_NAME = "jarin-blog-images";
const PRESIGN_EXPIRY = 3600;

const MIME_MAP = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json',
};

function sanitizeFilename(name) {
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return null;
  const ext = name.slice(lastDot).toLowerCase();
  const base = name.slice(0, lastDot)
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!base) return null;
  return base + ext;
}

export async function onRequestPost(context) {
  try {
    const { filename: rawFilename, size } = await context.request.json();

    if (!rawFilename || typeof rawFilename !== 'string') return errorResponse("Missing filename.", 400);
    if (!size || typeof size !== 'number' || size <= 0) return errorResponse("Missing or invalid size.", 400);

    const filename = sanitizeFilename(rawFilename);
    if (!filename) return errorResponse("Invalid filename.", 400);

    const ext = filename.slice(filename.lastIndexOf('.'));
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return errorResponse("File type not allowed. Accepted: " + ALLOWED_EXTENSIONS.join(', '), 400);
    }
    if (size > MAX_SIZE) return errorResponse("File exceeds 500 MB limit.", 400);

    const { R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID } = context.env;
    if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ACCOUNT_ID) {
      return errorResponse("R2 credentials not configured.", 500);
    }

    const key = `files/${filename}`;
    const contentType = MIME_MAP[ext] || "application/octet-stream";

    const r2 = new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    });

    const s3Url = new URL(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET_NAME}/${key}`);
    s3Url.searchParams.set('X-Amz-Expires', String(PRESIGN_EXPIRY));

    const signed = await r2.sign(
      new Request(s3Url, {
        method: "PUT",
        headers: { "Content-Type": contentType },
      }),
      { aws: { signQuery: true } }
    );

    return jsonResponse({
      url: signed.url,
      key,
      filename,
      contentType,
      serveUrl: `/api/blog-image/${key}`,
    });
  } catch (err) {
    return errorResponse("Presign failed: " + (err.message || "unknown"), 500);
  }
}
