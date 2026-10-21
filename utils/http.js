// Error type carrying an HTTP status; thrown from controllers/services and
// turned into a JSON response by the error handler in index.js.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message = 'Bad request') => new HttpError(400, message);
export const unauthorized = (message = 'Please sign in to continue') => new HttpError(401, message);
export const forbidden = (message = 'You are not allowed to do that') => new HttpError(403, message);
export const notFound = (message = 'Not found') => new HttpError(404, message);
export const conflict = (message = 'Already exists') => new HttpError(409, message);
