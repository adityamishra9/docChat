// server/db/mongo.js
import { MongoClient, GridFSBucket } from "mongodb";
import { ENV } from "../config/env.js";

const client = new MongoClient(ENV.MONGODB_URI, {});
const dbName = ENV.MONGODB_DB;

export async function db() {
  if (!client.topology || !client.topology.isConnected()) {
    await client.connect();
  }
  return client.db(dbName);
}

export async function bucket() {
  return new GridFSBucket(await db(), { bucketName: "pdfs" });
}
