"""
darth-bot/kb/embed.py
=====================
Chunks the scraped Markdown docs in data/scrape/ and embeds each chunk
into chromadb at data/chroma/.

Run after scraping:
    python3 -m darth-bot.kb.embed

Re-running is idempotent — chunks already in the DB are skipped (matched
by their stable hash).
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Iterable

from config import CHROMA_DIR, CHUNK_SIZE, CHUNK_OVERLAP, EMBED_MODEL, SCRAPE_DIR


def chunk_text(text: str, *, size: int = CHUNK_SIZE,
               overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Word-based chunker. Keeps paragraph breaks where possible."""
    paras = re.split(r"\n\s*\n", text)
    chunks, cur = [], []
    cur_len = 0
    for p in paras:
        words = p.split()
        if cur_len + len(words) > size and cur:
            chunks.append(" ".join(cur))
            # overlap by keeping last `overlap` words
            if overlap > 0:
                cur = cur[-overlap:]
                cur_len = len(cur)
            else:
                cur, cur_len = [], 0
        cur.extend(words)
        cur_len += len(words)
    if cur:
        chunks.append(" ".join(cur))
    return [c for c in chunks if len(c.split()) >= 30]


def stable_id(source: str, title: str, path_key: str, idx: int) -> str:
    # path_key disambiguates entries that share source+title (the
    # manifest scraper produces many same-titled .md files for distinct
    # item hashes — relying on title alone collided in-batch).
    h = hashlib.sha1(f"{source}|{title}|{path_key}|{idx}".encode()).hexdigest()[:16]
    return f"{source}-{h}-{idx:03d}"


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Strip the YAML-ish frontmatter our scraper writes."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 4)
    if end < 0:
        return {}, text
    fm_lines = text[4:end].splitlines()
    body = text[end + 4 :].lstrip("\n")
    meta = {}
    for line in fm_lines:
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"')
    return meta, body


# Patterns that produce noise in retrieved chunks. destinypedia's
# extracted markdown has lots of empty pipe-table cells like
# "| Game: | | | Player(s): | 1-6 |" which dominate the first chunk
# and starve the model of useful content. Reddit chunks have HTML
# entities. MediaWiki has [edit] markers. Strip all of it.
_NOISE_RES = [
    (re.compile(r"\|\s*[A-Z][^|\n]{0,40}:\s*\|(?:\s*\|)+"), " "),   # "| Field: | | |"
    (re.compile(r"\|(?:\s*\|){2,}"),                          " "),  # "| | | |" runs
    (re.compile(r"\|---+\|(?:---+\|)*"),                       " "),  # table separator rows
    (re.compile(r"\[edit\]"),                                  ""),
    (re.compile(r"\[\d+\]"),                                   ""),   # citation markers
    (re.compile(r"&gt;"),                                      ">"),
    (re.compile(r"&lt;"),                                      "<"),
    (re.compile(r"&amp;"),                                     "&"),
    (re.compile(r"&#x200B;"),                                  ""),
    (re.compile(r"&nbsp;"),                                    " "),
    (re.compile(r"[ \t]+"),                                    " "),
    (re.compile(r"\n{3,}"),                                    "\n\n"),
]


def clean_body(body: str) -> str:
    for pat, repl in _NOISE_RES:
        body = pat.sub(repl, body)
    return body.strip()


def main():
    import chromadb
    from chromadb.utils import embedding_functions

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=EMBED_MODEL,
    )
    coll = client.get_or_create_collection(
        name="destiny",
        embedding_function=embed_fn,
        metadata={"hnsw:space": "cosine"},
    )

    existing_ids = set()
    try:
        for batch in coll.get(include=[])["ids"]:
            existing_ids.add(batch) if isinstance(batch, str) else existing_ids.update(batch)
    except Exception:
        pass

    new_ids, new_docs, new_meta = [], [], []
    batch_seen: set[str] = set()
    md_files = list(SCRAPE_DIR.rglob("*.md"))
    print(f"Found {len(md_files)} markdown files under {SCRAPE_DIR}")
    for f in md_files:
        text = f.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(text)
        body = clean_body(body)
        source = meta.get("source", f.parent.name)
        title = meta.get("title", f.stem)
        url = meta.get("url", "")
        # Use the file's relative path as the disambiguator — guaranteed
        # unique under SCRAPE_DIR.
        try:
            path_key = str(f.relative_to(SCRAPE_DIR))
        except ValueError:
            path_key = f.as_posix()
        for i, chunk in enumerate(chunk_text(body)):
            cid = stable_id(source, title, path_key, i)
            if cid in existing_ids or cid in batch_seen:
                continue
            batch_seen.add(cid)
            new_ids.append(cid)
            new_docs.append(chunk)
            new_meta.append({"source": source, "title": title, "url": url})
        # batch insert every N
        if len(new_ids) >= 200:
            coll.add(ids=new_ids, documents=new_docs, metadatas=new_meta)
            print(f"  ↳ inserted {len(new_ids)} chunks")
            existing_ids.update(new_ids)
            new_ids, new_docs, new_meta = [], [], []
            batch_seen.clear()

    if new_ids:
        coll.add(ids=new_ids, documents=new_docs, metadatas=new_meta)
        print(f"  ↳ inserted {len(new_ids)} chunks (final batch)")

    print(f"Done. Collection size: {coll.count()}")


if __name__ == "__main__":
    main()
