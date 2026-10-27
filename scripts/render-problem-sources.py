#!/usr/bin/env python3
"""Render each exercise's original PDF excerpt for the problem page.

The course PDF contains mathematical notation that cannot be recovered
faithfully from plain text extraction (fractions, superscripts, subscripts,
and symbols are often reordered).  Keeping a high-resolution image of the
original question gives the site an exact, readable source while the existing
text remains available for search and copying.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pdfplumber
import pypdfium2 as pdfium
from PIL import Image, ImageChops


HEAD_RE = re.compile(r"Exercise\s+(\d+\.\d+)\b")
RENDER_SCALE = 2.0  # 144 dpi
CONTENT_TOP = 122.0
CONTENT_BOTTOM = 754.0
CROP_LEFT = 52.0
CROP_RIGHT = 560.0
PAGE_GAP = 16


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path, help="Source course PDF")
    parser.add_argument(
        "--course",
        type=Path,
        default=Path("data/course.json"),
        help="Course JSON to update",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("assets/problems"),
        help="Output directory for problem images",
    )
    parser.add_argument(
        "--web-path",
        default="assets/problems",
        help="Site-relative directory written to problemImage",
    )
    parser.add_argument(
        "--only",
        nargs="*",
        help="Optional exercise ids to render, e.g. 4.5 4.6",
    )
    return parser.parse_args()


def exercise_records(course: dict) -> list[dict]:
    return [exercise for chapter in course["chapters"] for exercise in chapter["exercises"]]


def find_document_markers(
    pdf_path: Path, exercise_ids: set[str]
) -> tuple[dict[str, tuple[int, float]], set[int], dict[int, int]]:
    candidates: dict[str, list[tuple[int, float, str]]] = {}
    section_starts: set[int] = set()
    content_char_counts: dict[int, int] = {}
    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            content_char_counts[page_number] = sum(
                1
                for char in page.chars
                if char["text"].strip() and CONTENT_TOP <= char["top"] < CONTENT_BOTTOM
            )
            for line in page.extract_text_lines():
                match = HEAD_RE.match(line["text"])
                if match and match.group(1) in exercise_ids:
                    exercise_id = match.group(1)
                    candidates.setdefault(exercise_id, []).append(
                        (page_number, float(line["top"]), line["text"])
                    )
                if re.match(r"^(?:Part\s+[IVX]+|Chapter\s+\d+)$", line["text"]):
                    section_starts.add(page_number)

    positions: dict[str, tuple[int, float]] = {}
    for exercise_id in exercise_ids:
        choices = candidates.get(exercise_id, [])
        titled = [choice for choice in choices if re.match(rf"^{HEAD_RE.pattern}\s*\(", choice[2])]
        if len(choices) > 1:
            # The body sometimes mentions a previous exercise by number. Real
            # headings with a title contain the title in parentheses.
            choices = titled or choices
        if len(choices) != 1:
            raise RuntimeError(f"Ambiguous heading for exercise {exercise_id}: {choices}")
        positions[exercise_id] = (choices[0][0], choices[0][1])

    missing = sorted(exercise_ids - positions.keys())
    if missing:
        raise RuntimeError(f"No PDF heading found for: {', '.join(missing)}")
    return positions, section_starts, content_char_counts


def crop_pixels(image: Image.Image, top: float, bottom: float) -> Image.Image:
    left = round(CROP_LEFT * RENDER_SCALE)
    right = round(CROP_RIGHT * RENDER_SCALE)
    upper = round(top * RENDER_SCALE)
    lower = round(bottom * RENDER_SCALE)
    return image.crop((left, upper, right, lower))


def trim_page_margin(image: Image.Image, padding: int = 16) -> Image.Image:
    white = Image.new("RGB", image.size, "white")
    bounds = ImageChops.difference(image, white).getbbox()
    if bounds is None:
        return image
    left = max(0, bounds[0] - padding)
    top = max(0, bounds[1] - padding)
    right = min(image.width, bounds[2] + padding)
    bottom = min(image.height, bounds[3] + padding)
    return image.crop((left, top, right, bottom))


def compose_exercise(
    source: pdfium.PdfDocument,
    start_page: int,
    start_top: float,
    end_page: int,
    end_bottom: float | None,
) -> Image.Image:
    pieces: list[Image.Image] = []
    for page_number in range(start_page, end_page + 1):
        page = source[page_number - 1]
        bitmap = page.render(scale=RENDER_SCALE, draw_annots=False)
        page_image = bitmap.to_pil().convert("RGB")

        top = start_top - 3.0 if page_number == start_page else CONTENT_TOP
        bottom = CONTENT_BOTTOM
        if page_number == end_page and end_bottom is not None:
            bottom = end_bottom - 4.0
        bottom = min(max(bottom, top + 8.0), CONTENT_BOTTOM)
        pieces.append(trim_page_margin(crop_pixels(page_image, top, bottom)))

    width = max(piece.width for piece in pieces)
    height = sum(piece.height for piece in pieces) + PAGE_GAP * (len(pieces) - 1)
    canvas = Image.new("RGB", (width, height), "white")
    y = 0
    for index, piece in enumerate(pieces):
        canvas.paste(piece, ((width - piece.width) // 2, y))
        y += piece.height
        if index + 1 < len(pieces):
            y += PAGE_GAP
    return canvas


def safe_relative_join(base: str, *parts: str) -> str:
    return Path(base).joinpath(*parts).as_posix()


def main() -> None:
    args = parse_args()
    pdf_path = args.pdf.resolve()
    course_path = args.course.resolve()
    output_dir = args.out.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    course = json.loads(course_path.read_text(encoding="utf-8"))
    records = exercise_records(course)
    by_id = {record["id"]: record for record in records}
    selected_ids = set(args.only) if args.only else set(by_id)
    unknown = sorted(selected_ids - by_id.keys())
    if unknown:
        raise SystemExit(f"Unknown exercise ids: {', '.join(unknown)}")

    positions, section_starts, content_char_counts = find_document_markers(
        pdf_path, set(by_id)
    )
    document_order = sorted(by_id, key=lambda exercise_id: positions[exercise_id])
    source = pdfium.PdfDocument(str(pdf_path))

    for index, exercise_id in enumerate(document_order):
        if exercise_id not in selected_ids:
            continue
        start_page, start_top = positions[exercise_id]
        next_id = document_order[index + 1] if index + 1 < len(document_order) else None
        if next_id and exercise_id.split(".")[0] == next_id.split(".")[0]:
            end_page, next_top = positions[next_id]
            end_bottom = next_top
        else:
            next_section = min(
                (page for page in section_starts if page > start_page),
                default=len(source) + 1,
            )
            question_pages = [
                page
                for page in range(start_page, next_section)
                if content_char_counts.get(page, 0) > 20
            ]
            end_page = max(question_pages, default=start_page)
            end_bottom = None

        image = compose_exercise(source, start_page, start_top, end_page, end_bottom)
        chapter_id = exercise_id.split(".")[0]
        chapter_folder = f"ch{int(chapter_id):02d}"
        filename = f"{by_id[exercise_id]['slug']}.webp"
        destination = output_dir / chapter_folder / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, "WEBP", lossless=True, method=6)
        by_id[exercise_id]["problemImage"] = safe_relative_join(
            args.web_path, chapter_folder, filename
        )
        print(
            f"{exercise_id}: page {start_page}"
            + (f"-{end_page}" if end_page != start_page else "")
            + f" -> {destination.relative_to(Path.cwd())}"
        )

    course_path.write_text(
        json.dumps(course, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Rendered {len(selected_ids)} exercise images")


if __name__ == "__main__":
    main()
