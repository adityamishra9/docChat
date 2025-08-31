// server/routes/health.js
import { Router } from "express";
const r = Router();

r.get("/", (_req, res) => res.send("HEALTHY"));

export default r;
