from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
from sentence_transformers import SentenceTransformer

app = FastAPI()
model = SentenceTransformer("all-MiniLM-L6-v2")

class EmbeddingRequest(BaseModel):
    texts: List[str]

@app.post("/embeddings")
async def get_embeddings(req: EmbeddingRequest):
    embs = model.encode(req.texts, show_progress_bar=False)
    return {"embeddings": embs.tolist()}
