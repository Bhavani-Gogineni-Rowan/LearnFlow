import hashlib
import os

from app.config import CHROMA_PERSIST_PATH, MAX_CHUNKS_IN_PROMPT
from services.chunking import chunk_syllabus_text

try:
    import chromadb
except Exception:
    chromadb = None


# Index the syllabus in Chroma and return the top-k chunks most relevant to `query`.
def build_vector_store_and_retrieve_context(syllabus_text: str, query: str, top_k: int = MAX_CHUNKS_IN_PROMPT) -> str:
    chunks = chunk_syllabus_text(syllabus_text)
    if not chunks:
        return ""

    if chromadb is None:
        # Graceful degradation when ChromaDB isn't installed.
        return "\n\n".join(chunks[:top_k])

    os.makedirs(CHROMA_PERSIST_PATH, exist_ok=True)
    client = chromadb.PersistentClient(path=CHROMA_PERSIST_PATH)
    syllabus_hash = hashlib.sha256(syllabus_text.encode("utf-8")).hexdigest()[:16]
    collection_name = f"syllabus_{syllabus_hash}"
    collection = client.get_or_create_collection(name=collection_name)

    existing = collection.count()
    if existing == 0:
        ids = [f"{collection_name}_chunk_{idx}" for idx in range(len(chunks))]
        metadatas = [{"chunk_index": idx} for idx in range(len(chunks))]
        collection.add(documents=chunks, ids=ids, metadatas=metadatas)

    results = collection.query(
        query_texts=[query],
        n_results=min(top_k, max(collection.count(), 1)),
    )
    top_docs = results.get("documents", [[]])[0]
    context_blocks = [doc.strip() for doc in top_docs if doc and doc.strip()]
    return "\n\n".join(context_blocks)
