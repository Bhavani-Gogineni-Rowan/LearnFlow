import re


# Split a syllabus into overlapping chunks suitable for vector indexing.
def chunk_syllabus_text(text: str, chunk_size: int = 1200, overlap: int = 200) -> list[str]:
    cleaned = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not cleaned:
        return []

    chunks: list[str] = []
    start = 0
    text_len = len(cleaned)

    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunk = cleaned[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end == text_len:
            break
        start = max(end - overlap, start + 1)

    return chunks
