"""Text of a library file: plain text as UTF-8, .docx from its XML. Errors are ValueError(code)."""

import codecs
import zipfile
from pathlib import Path
from xml.etree import ElementTree

from .parts import MAX_CHARS

EXTS = {".md", ".txt", ".json", ".yaml", ".yml", ".docx"}
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_XML_MAX = 50_000_000  # an unzipped document.xml larger than this is not a real document


def _docx(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as z:
            if z.getinfo("word/document.xml").file_size > _XML_MAX:
                raise ValueError("bad_docx")
            root = ElementTree.fromstring(z.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ElementTree.ParseError, OSError) as e:
        raise ValueError("bad_docx") from e
    return "\n".join("".join(t.text or "" for t in p.iter(f"{_W}t")) for p in root.iter(f"{_W}p"))


def read_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext not in EXTS:
        raise ValueError("unsupported")
    cut = False
    if ext == ".docx":
        text = _docx(path)
    else:
        with path.open("rb") as f:  # no more than MAX_CHARS can be kept: at most 4 bytes each in UTF-8
            raw = f.read(MAX_CHARS * 4 + 1)
            cut = len(raw) > MAX_CHARS * 4
        try:
            # a cut file may end inside a character: only that tail (≤ 3 bytes) is dropped, anything else bad stays bad
            text = codecs.getincrementaldecoder("utf-8")().decode(raw, final=not cut)
        except UnicodeDecodeError as e:
            raise ValueError("not_text") from e
        if "\x00" in text:
            raise ValueError("not_text")
    if cut or len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + f"\n\n(… bị cắt ở {MAX_CHARS} ký tự)"
    return text
