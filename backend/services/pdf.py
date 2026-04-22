import io

from fastapi import HTTPException
from PyPDF2 import PdfReader

try:
    from unstructured.partition.pdf import partition_pdf
except Exception:
    partition_pdf = None


# Plain page-by-page text extraction via PyPDF2; used when layout-aware parsing fails.
def extract_text_from_pdf_fallback(file_bytes: bytes) -> str:
    try:
        pdf_reader = PdfReader(io.BytesIO(file_bytes))
        pages_text: list[str] = []
        for page in pdf_reader.pages:
            page_text = page.extract_text() or ""
            if page_text.strip():
                pages_text.append(page_text)
        return "\n".join(pages_text)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to read PDF file: {exc}") from exc


# Layout-aware PDF extraction (preserves headers/tables/lists) using unstructured.
def extract_text_from_pdf_layout_aware(file_bytes: bytes) -> str:
    if partition_pdf is None:
        raise RuntimeError("unstructured is not installed")

    elements = partition_pdf(file=io.BytesIO(file_bytes))
    lines: list[str] = []

    for element in elements:
        raw_text = str(element).strip()
        if not raw_text:
            continue

        category = getattr(element, "category", None) or element.__class__.__name__
        tag = category.upper()
        lines.append(f"[{tag}] {raw_text}")

    return "\n".join(lines).strip()


# Public entry: try layout-aware extraction, fall back to plain extraction on failure.
def extract_syllabus_text_from_pdf(file_bytes: bytes) -> str:
    try:
        extracted = extract_text_from_pdf_layout_aware(file_bytes)
        if extracted:
            return extracted
    except Exception:
        pass

    return extract_text_from_pdf_fallback(file_bytes)

