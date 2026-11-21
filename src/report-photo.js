export const PHOTO_MAX_BYTES = 250_000;
export const PHOTO_MAX_EDGE = 1280;
export const PHOTO_MAX_BASE64_LENGTH = Math.ceil(PHOTO_MAX_BYTES / 3) * 4;

function fitsJpeg(bytes) {
  const end = bytes.length - 2;
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[end] !== 255 || bytes[end + 1] !== 217) return false;
  for (let offset = 2; offset + 4 <= end;) {
    if (bytes[offset] !== 255) return false;
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > end || marker === 218) return false;
    if (marker === 192 || marker === 193 || marker === 194) {
      if (length < 8) return false;
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 && Math.max(width, height) <= PHOTO_MAX_EDGE;
    }
    offset += length + 2;
  }
  return false;
}

export function decodeIssuePhoto(encoded) {
  if (typeof encoded !== "string" || encoded.length > PHOTO_MAX_BASE64_LENGTH) return null;
  try {
    const binary = atob(encoded);
    if (binary.length > PHOTO_MAX_BYTES) return null;
    const image = Uint8Array.from(binary, (byte) => byte.charCodeAt(0));
    return fitsJpeg(image) ? image.buffer : null;
  } catch {
    return null;
  }
}

export async function readReportPhoto(request) {
  if (request.headers.get("Content-Type") !== "image/jpeg" || !request.body) {
    return { error: "Choose a photo to upload.", status: 415 };
  }
  const reader = request.body.getReader();
  const buffer = new Uint8Array(PHOTO_MAX_BYTES);
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (bytes + value.length > buffer.length) {
        await reader.cancel();
        return { error: "The photo must be 250 KB or smaller.", status: 413 };
      }
      buffer.set(value, bytes);
      bytes += value.length;
    }
  } catch {
    return { error: "The upload did not finish. Try again.", status: 400 };
  } finally {
    reader.releaseLock();
  }
  const image = buffer.slice(0, bytes);
  if (!fitsJpeg(image)) return { error: "Choose a readable JPEG up to 1,280 pixels per side.", status: 400 };
  return { image: image.buffer };
}

const photoFields = "share_token, revision, length(jpeg) AS bytes";
const photoInfo = (row) => row ? { path: "/photo/" + row.share_token, revision: row.revision, bytes: row.bytes } : null;

export async function staffReportPhoto(request, db, id, fallbackToken) {
  if (request.method === "GET") {
    const row = await db.prepare(`SELECT ${photoFields} FROM report_photos WHERE report_id = ?`).bind(id).first();
    return { photo: photoInfo(row) };
  }
  if (request.method === "DELETE") {
    await db.prepare("DELETE FROM report_photos WHERE report_id = ?").bind(id).run();
    return { photo: null };
  }
  const { image, error, status } = await readReportPhoto(request);
  if (error) return { error, status };
  const row = await db.prepare(`
    INSERT INTO report_photos (report_id, share_token, jpeg, shared_at)
    SELECT id, COALESCE(tracking_token, ?), ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    FROM reports WHERE id = ? AND dismissed_at IS NULL
    ON CONFLICT(report_id) DO UPDATE SET jpeg = excluded.jpeg, revision = revision + 1, shared_at = excluded.shared_at
    RETURNING ${photoFields}
  `).bind(fallbackToken, image, id).first();
  if (!row) return { error: "This report is unavailable for photo sharing.", status: 404 };
  return { photo: photoInfo(row) };
}

export function sharedReportPhoto(db, token, image = false) {
  const field = image ? "photos.jpeg" : "1 AS available";
  return db.prepare(`
    SELECT ${field}
    FROM report_photos AS photos JOIN reports ON reports.id = photos.report_id
    WHERE photos.share_token = ? AND reports.dismissed_at IS NULL
  `).bind(token).first();
}
