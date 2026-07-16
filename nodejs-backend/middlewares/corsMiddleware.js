// Hand-rolled CORS middleware, registered before every route.
//
// The AI Assistant composer uploads reference images / brand logos to
// POST /adsgpt/adCreative/upload-image with an `Authorization: Bearer <token>`
// header and `multipart/form-data`. Because of the Authorization header this is
// a *non-simple* request, so the browser first sends a CORS preflight
// (OPTIONS). The previous version advertised only
// `Origin, X-Requested-With, Content-Type, Accept` (no `Authorization`), never
// declared the allowed methods, and never answered the OPTIONS request — so the
// preflight failed and the browser blocked the upload with a CORS error.
//
// We now echo the requesting Origin (required when credentials may be present),
// allow the headers/methods the app actually uses, and short-circuit the
// preflight with a 204 so the real request is allowed through.
module.exports = (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  } else {
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization",
  );
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Max-Age", "86400");

  // Answer the preflight directly — no downstream route handles OPTIONS.
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
};
