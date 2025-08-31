// server/services/vector.js
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";
import { ENV } from "../config/env.js";
import { embedLocally } from "./embeddings.js";

export async function vectorStoreForCollection(collectionName) {
  const shim = {
    embedQuery: async (t) => (await embedLocally([t]))[0],
    embedDocuments: async (ds) => embedLocally(ds),
  };
  return QdrantVectorStore.fromExistingCollection(shim, {
    client: new QdrantClient({ url: ENV.QDRANT_URL }),
    collectionName,
  });
}
