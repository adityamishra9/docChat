// server/services/storage.js
import fs from "fs";
import mime from "mime";
import { bucket } from "../db/mongo.js";

export async function streamFileToGridFS(tempPath, filename, contentType, id) {
  const gfs = await bucket();
  await new Promise((resolve, reject) => {
    fs.createReadStream(tempPath)
      .pipe(
        gfs.openUploadStreamWithId(id, filename, {
          contentType,
        })
      )
      .on("finish", resolve)
      .on("error", reject);
  });
}

export async function streamGridFSToHttp(gridId, name, res) {
  const gfs = await bucket();
  res.setHeader("Content-Type", mime.getType(name) || "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${encodeURIComponent(name)}"`
  );
  res.setHeader("Cache-Control", "no-store");

  gfs.openDownloadStream(gridId).on("error", () => res.status(500).end()).pipe(res);
}
