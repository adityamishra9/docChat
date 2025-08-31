// server/middleware/cors.js
import cors from "cors";
import { ENV } from "../config/env.js";

export const corsMiddleware = cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ENV.CORS_ORIGIN.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
});
