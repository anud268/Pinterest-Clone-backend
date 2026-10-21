import { HttpError } from '../utils/http.js';

const DEFAULT_UPLOAD_URL = 'https://upload.imagekit.io/api/v1/files/upload';

export const FOLDERS = {
  posts: '/Pinterest/Posts',
  profile: '/Home/Pinterest/ProfilePicture',
  explore: '/Pinterest/ExploreManage',
};

// Uploads a multer in-memory file to ImageKit and returns { url, width, height }.
export const uploadImage = async (file, folder) => {
  if (!process.env.IMAGEKIT_PRIVATE_KEY) {
    throw new HttpError(503, 'Image uploads are not configured on the server');
  }

  const formData = new FormData();
  formData.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  formData.append('fileName', file.originalname);
  formData.append('folder', folder);

  const auth = 'Basic ' + Buffer.from(process.env.IMAGEKIT_PRIVATE_KEY + ':').toString('base64');

  let response;
  try {
    response = await fetch(process.env.IMAGEKIT_UPLOAD_URL || DEFAULT_UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: auth },
      body: formData,
    });
  } catch (error) {
    console.error('[ImageKit] Network error:', error.message);
    throw new HttpError(502, 'Could not reach the image service. Please try again.');
  }

  if (!response.ok) {
    console.error('[ImageKit] Upload failed:', response.status, await response.text());
    throw new HttpError(502, 'Image upload failed. Please try again.');
  }

  const result = await response.json();
  if (!result.url) throw new HttpError(502, 'Image upload returned no URL');
  return { url: result.url, width: result.width, height: result.height };
};
