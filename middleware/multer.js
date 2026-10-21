import multer from "multer";
import { badRequest } from "../utils/http.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

// Files are kept in memory and streamed straight to ImageKit, so no temp files are left on disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
    cb(badRequest("Only JPEG, PNG, WebP, GIF or AVIF images are allowed"));
  },
});

export default upload;
