// Thin wrapper around @vercel/blob so lib/csv.js and lib/xlsx.js don't have
// to know whether they're running on Vercel (where local disk writes don't
// persist between invocations) or locally / on a classic host with a real
// writable disk.
//
// Mode is decided once, at require-time, from the env vars Vercel injects
// once a Blob store is connected to the project:
//  - BLOB_STORE_ID (newer stores, connected via OIDC — no static token is
//    exposed; @vercel/blob authenticates using the platform's own
//    VERCEL_OIDC_TOKEN together with this store id, both automatic), or
//  - BLOB_READ_WRITE_TOKEN (older/manually-created stores using a static
//    read-write token instead of OIDC)
// -> Blob mode either way.
// Neither set (plain `node server.js` locally, or any host with a real disk
// that survives between requests) -> local-disk mode, unchanged from the
// original implementation.
//
// IMPORTANT — no file locking: a read-modify-write against Blob storage
// (read the whole file, append in memory, re-upload the whole file) is not
// atomic. Two inscriptions submitted at the exact same second could in
// theory overwrite each other. For Fun4Kids' actual volume (a handful of
// submissions per day) this is an acceptable trade-off — it's still a very
// large improvement over local disk on Vercel, where writes wouldn't
// persist at all. If Fun4Kids' volume grows a lot, revisit with a real
// database instead of file storage.

const USE_BLOB = !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);

let blobSdk = null;
function sdk() {
  if (!blobSdk) blobSdk = require('@vercel/blob');
  return blobSdk;
}

/** Reads an existing blob's full content as a Buffer, or null if it doesn't
 * exist yet (first submission for that file). */
async function readBlob(pathname) {
  const { get } = sdk();
  let result;
  try {
    result = await get(pathname, { access: 'private' });
  } catch (err) {
    return null; // not found (or any read error) -> treat as "no file yet"
  }
  if (!result || result.statusCode !== 200) return null;
  const chunks = [];
  const reader = result.stream.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Overwrites (or creates) a blob with the given content. */
async function writeBlob(pathname, content, contentType) {
  const { put } = sdk();
  await put(pathname, content, {
    access: 'private',
    contentType,
    allowOverwrite: true,
  });
}

/** Lists every blob whose pathname starts with `prefix` (paginating through
 * all pages). Used by the admin panel to discover which submission files
 * currently exist without having to hardcode their names. */
async function listBlobs(prefix) {
  const { list } = sdk();
  const out = [];
  let cursor;
  do {
    const result = await list({ prefix, cursor, limit: 1000 });
    out.push(...result.blobs);
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return out;
}

module.exports = { USE_BLOB, readBlob, writeBlob, listBlobs };
