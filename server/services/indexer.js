// server/services/indexer.js
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { QdrantClient } from "@qdrant/js-client-rest";
import { QdrantVectorStore } from "@langchain/qdrant";
import { ENV } from "../config/env.js";
import { embedLocally } from "./embeddings.js";

/**
 * Split, embed, and index into Qdrant.
 */
export async function chunkAndIndex(baseDocs, collectionName) {
  const splitter = new CharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });

  const chunks = await splitter.splitDocuments(
    baseDocs.map((c) => ({ pageContent: c.pageContent, metadata: c.metadata }))
  );
  if (!chunks?.length) throw new Error("No chunks created from document text");

  const texts = chunks.map((c) => c.pageContent);
  const vectors = await embedLocally(texts);
  if (!Array.isArray(vectors) || vectors.length !== chunks.length) {
    throw new Error(`Embedding count mismatch (${vectors?.length} != ${chunks.length})`);
  }

  await QdrantVectorStore.fromDocuments(
    chunks,
    {
      embedDocuments: async () => vectors,
      embedQuery: async (q) => (await embedLocally([q]))[0],
    },
    {
      client: new QdrantClient({ url: ENV.QDRANT_URL }),
      collectionName,
    }
  );

  return { chunks: chunks.length };
}
