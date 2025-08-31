// server/lib/request-id.js
export function requestId() {
  return (req, _res, next) => {
    req.reqId = (Date.now() + Math.random()).toString(36);
    next();
  };
}
