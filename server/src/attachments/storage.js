// The bytes of attachments, in MongoDB GridFS (CD-18,
// docs/decisions/CD-18-attachment-storage.md). Nothing is ever written to the server's disk
// or to a static path: files go from memory straight to the database and back out through
// the authenticated download route. Each GridFS file gets a random filename (a UUID); the
// client's name is only stored, sanitised, on the Attachment document.
const crypto = require('node:crypto');
const mongoose = require('mongoose');

const BUCKET_NAME = 'attachments';

function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET_NAME });
}

// Stores one file and resolves with its GridFS id.
function saveFile(buffer) {
  return new Promise((resolve, reject) => {
    const upload = bucket().openUploadStream(crypto.randomUUID());
    upload.once('error', reject);
    upload.once('finish', () => resolve(upload.id));
    upload.end(buffer);
  });
}

// A readable stream of the file's bytes.
function openFile(id) {
  return bucket().openDownloadStream(id);
}

// Removes the file (its files and chunks documents). A file that is already gone is fine.
async function deleteFile(id) {
  try {
    await bucket().delete(id);
  } catch (error) {
    if (!/file not found/i.test(error?.message ?? '')) throw error;
  }
}

module.exports = { BUCKET_NAME, deleteFile, openFile, saveFile };
