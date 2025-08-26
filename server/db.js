// server/db.js
import { MongoClient, GridFSBucket } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DB || "docchat";

export const client = new MongoClient(uri, {});

export async function db() {
  if (!client.topology || !client.topology.isConnected()) {
    await client.connect();
  }
  return client.db(dbName);
}

export async function bucket() {
  return new GridFSBucket(await db(), { bucketName: "pdfs" });
}
