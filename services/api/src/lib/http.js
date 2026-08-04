import { randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function addRequestContext(request, response, next) {
  const suppliedId = request.get('x-request-id');
  request.requestId = suppliedId && /^[A-Za-z0-9_-]{8,100}$/.test(suppliedId) ? suppliedId : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}

export function sendSuccess(response, data, status = 200) {
  response.status(status).json({
    data,
    meta: { requestId: response.req.requestId },
  });
}

export function notFoundHandler(_request, _response, next) {
  next(new HttpError(404, 'not_found', 'Route inconnue.'));
}

export function errorHandler(error, request, response, _next) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'internal_error';
  const message = error instanceof HttpError ? error.message : 'Une erreur interne est survenue.';
  const details = error instanceof HttpError ? error.details : undefined;

  if (status >= 500 && !(error instanceof HttpError)) {
    console.error({ requestId: request.requestId, error: error?.message });
  }

  response.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId: request.requestId,
    },
  });
}
