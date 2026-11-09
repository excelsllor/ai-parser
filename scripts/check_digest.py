#!/usr/bin/env python3
"""Форматная проверка артефактов дайджеста (аналог check_digest.py организаторов)."""
from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

URL_RE = re.compile(r"https?://\S+")
REQUIRED_FIELDS = ("Суть:", "Последствия:", "Источники:", "Обоснование:")


def chars_without_urls(text: str) -> int:
    return len(URL_RE.sub("", text))


def check_dir(path: Path) -> list[str]:
    path = path.resolve()
    if not path.is_dir():
        return ["путь не является каталогом"]
    errors: list[str] = []
    digest_path = path / "digest.md"
    post_path = path / "post.md"
    journal_path = path / "journal.csv"
    email_path = path / "email.html"
    email_md_path = path / "email.md"

    if not digest_path.exists():
        return ["digest.md отсутствует"]
    digest = digest_path.read_text(encoding="utf-8")
    if chars_without_urls(digest) > 4000:
        errors.append(f"digest.md превышает 4000 знаков: {chars_without_urls(digest)}")
    events = re.findall(r"^## (\d+)\.", digest, flags=re.MULTILINE)
    if len(events) > 5:
        errors.append(f"в digest.md больше пяти событий: {len(events)}")
    if events:
        for field in REQUIRED_FIELDS:
            if field not in digest:
                errors.append(f"в digest.md нет поля {field}")
        if len(events) < 5 and "меньше пяти" not in digest:
            errors.append("в digest.md нет пояснения, почему событий меньше пяти")
    elif "Подходящих событий за период нет" not in digest:
        errors.append("в пустом digest.md нет сообщения об отсутствии событий")
    if "—" in digest:
        errors.append("digest.md содержит длинное тире")

    if not post_path.exists():
        errors.append("post.md отсутствует")
    else:
        post = post_path.read_text(encoding="utf-8")
        if chars_without_urls(post) > 2000:
            errors.append(f"post.md превышает 2000 знаков: {chars_without_urls(post)}")
        if "—" in post:
            errors.append("post.md содержит длинное тире")

    if not journal_path.exists():
        errors.append("journal.csv отсутствует")
    else:
        with journal_path.open(encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            expected = ["id", "status", "group", "reason", "error"]
            if reader.fieldnames != expected:
                errors.append(f"journal.csv: заголовки {reader.fieldnames}, ожидались {expected}")
            for row in reader:
                if row.get("status") not in {"включён", "объединён", "исключён"}:
                    errors.append(f"journal.csv: недопустимый status={row.get('status')!r}")
                    break

    if not email_path.exists() and not email_md_path.exists():
        errors.append("email.html/email.md отсутствует")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check_digest.py <run-artifacts-dir>", file=sys.stderr)
        return 2
    errors = check_dir(Path(sys.argv[1]))
    if errors:
        print("FAIL")
        for error in errors:
            print(f"- {error}")
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
