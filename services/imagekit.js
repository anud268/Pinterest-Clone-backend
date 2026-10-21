import crypto from 'crypto';
import { HttpError } from '../utils/http.js';

const DEFAULT_UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';
const DEFAULT_API_URL = 'https://api.imagekit.io/v1';

export const FOLDERS = {
  posts: '/Pinterest/Posts',
  profile: '/Home/Pinterest/ProfilePicture',
  explore: '/Pinterest/ExploreManage',
  chat: '/Pinterest/ChatMedia',
};

const authHeader = () => {
  if (!process.env.IMAGEKIT_PRIVATE_KEY) {
    throw new HttpError(503, 'Image uploads are not configured on the server');
  }
  return 'Basic ' + Buffer.from(process.env.IMAGEKIT_PRIVATE_KEY + ':').toString('base64');
};

// Uploads bytes to ImageKit and returns the parsed upload response.
const upload = async ({ buffer, fileName, mimetype, folder, isPrivateFile = false }) => {
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: mimetype }), fileName);
  formData.append('fileName', fileName);
  formData.append('folder', folder);
  if (isPrivateFile) {
    formData.append('isPrivateFile', 'true');
    formData.append('useUniqueFileName', 'false');
  }

  let response;
  try {
    response = await fetch(process.env.IMAGEKIT_UPLOAD_URL || DEFAULT_UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: authHeader() },
      body: formData,
    });
  } catch (error) {
    console.error('[ImageKit] Network error:', error.message);
    throw new HttpError(502, 'Could not reach the image service. Please try again.');
  }

  if (!response.ok) {
    console.error('[ImageKit] Upload failed:', response.status, await response.text());
    throw new HttpError(502, 'Upload failed. Please try again.');
  }

  const result = await response.json();
  if (!result.url) throw new HttpError(502, 'Upload returned no URL');
  return result;
};

// Uploads a multer in-memory image to ImageKit and returns { url, width, height }.
export const uploadImage = async (file, folder) => {
  const result = await upload({ buffer: file.buffer, fileName: file.originalname, mimetype: file.mimetype, folder });
  return { url: result.url, width: result.width, height: result.height };
};

// Stores an opaque (already encrypted) blob as a private raw file under a random name.
export const uploadPrivateBlob = async (buffer, folder) => {
  const fileName = `${crypto.randomBytes(16).toString('hex')}.bin`;
  const result = await upload({ buffer, fileName, mimetype: 'application/octet-stream', folder, isPrivateFile: true });
  return { fileId: result.fileId, filePath: result.filePath };
};

// Short-lived signed URL for a private file (ImageKit URL signing: HMAC-SHA1 of path + expiry).
export const signedUrl = (filePath, expiresInSeconds = 120) => {
  const endpoint = (process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/+$/, '');
  if (!endpoint) throw new HttpError(503, 'IMAGEKIT_URL_ENDPOINT is not configured');
  const url = `${endpoint}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
  const expiry = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const signature = crypto
    .createHmac('sha1', process.env.IMAGEKIT_PRIVATE_KEY)
    .update(url.slice(endpoint.length + 1) + expiry)
    .digest('hex');
  return `${url}?ik-t=${expiry}&ik-s=${signature}`;
};

export const downloadPrivateBlob = async (filePath) => {
  const url = signedUrl(filePath);
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    console.error('[ImageKit] Download network error:', error.message);
    throw new HttpError(502, 'Could not reach the media service');
  }
  if (!response.ok) {
    console.error('[ImageKit] Download failed with status', response.status);
    throw new HttpError(502, 'Could not download this file');
  }
  return Buffer.from(await response.arrayBuffer());
};

export const deleteFile = async (fileId) => {
  try {
    const response = await fetch(`${process.env.IMAGEKIT_API_URL || DEFAULT_API_URL}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader() },
    });
    if (!response.ok && response.status !== 404) console.error('[ImageKit] Delete failed with status', response.status);
  } catch (error) {
    console.error('[ImageKit] Delete network error:', error.message);
  }
};
