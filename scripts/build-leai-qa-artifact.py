#!/usr/bin/env python3
"""Build a path-preserving static LEAI artifact for the fixed QA site."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import tempfile
from collections.abc import Mapping
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


QA_API_BASE = "https://guiidata-leai-qa.herokuapp.com/datapipeline/api"
QA_PUBLIC_BASE = "https://guii-lab.github.io/LEAI-QA/LEAI/"
BUILD_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}\Z")
ENVIRONMENT_SCRIPTS = (
    "leai-deployment-config.js",
    "leai-environment.js",
    "leai-shared.js",
)
FORBIDDEN_PRODUCTION_API_HOSTNAMES = (
    "guiidata-b6c968e6ed85.herokuapp.com",
)
PROVEN_QA_INERT_PRODUCTION_FILES = {
    "LEAI/leai-environment.js": (
        "f7af30036b2393b7ffde7756ebcb74aacbef962326f99d61413ac89f37163919"
    ),
}
BROWSER_EXECUTABLE_SUFFIXES = frozenset({".css", ".htm", ".html", ".js", ".json", ".mjs"})
NODE_TEST_REQUIRE_PATTERN = re.compile(r"\brequire\(\s*(['\"])node:test\1\s*\)")
LOCAL_BROWSER_REFERENCE_PATTERN = re.compile(
    r"(?P<quote>['\"])(?P<reference>[^'\"<>]*\.(?:css|html?|js|json|mjs)"
    r"(?:[?#][^'\"<>]*)?)(?P=quote)",
    re.IGNORECASE,
)
INDEX_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url=LEAI/InstructorHome.html">
  <title>LEAI QA</title>
</head>
<body>
  <main>
    <p><a href="LEAI/InstructorHome.html">Open LEAI QA</a></p>
  </main>
</body>
</html>
"""


class _ArtifactReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: list[str] = []

    def handle_starttag(
        self,
        tag: str,
        attributes: list[tuple[str, str | None]],
    ) -> None:
        del tag
        for name, value in attributes:
            if name.lower() in {"action", "data", "formaction", "href", "src"} and value:
                self.references.append(value)

    handle_startendtag = handle_starttag


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _paths_overlap(first: Path, second: Path) -> bool:
    return _is_relative_to(first, second) or _is_relative_to(second, first)


def _require_regular_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Required source file is missing or unsafe: {path}")


def _validate_inputs(
    source: str | os.PathLike[str],
    output: str | os.PathLike[str],
    api_base: str,
    build_id: str,
) -> tuple[Path, Path, Path]:
    source_input = Path(source).expanduser()
    output_input = Path(output).expanduser()

    try:
        source_root = source_input.resolve(strict=True)
    except (FileNotFoundError, RuntimeError) as exc:
        raise ValueError(f"Source root does not exist: {source_input}") from exc
    output_root = output_input.resolve(strict=False)

    if source_root == Path("/"):
        raise ValueError("Filesystem root cannot be used as the source")
    if not source_root.is_dir():
        raise ValueError(f"Source root is not a directory: {source_root}")
    if output_root == Path("/"):
        raise ValueError("Filesystem root cannot be used as the output")
    if output_input.is_symlink():
        raise ValueError("Output cannot be a symlink")
    if _paths_overlap(source_root, output_root):
        raise ValueError("Source and output paths must not overlap")
    if api_base != QA_API_BASE:
        raise ValueError(f"API base must be the fixed HTTPS QA API: {QA_API_BASE}")
    if not isinstance(build_id, str) or BUILD_ID_PATTERN.fullmatch(build_id) is None:
        raise ValueError("Build ID must contain 1-128 safe URL-cache characters")

    source_leai = source_root / "LEAI"
    if source_leai.is_symlink() or not source_leai.is_dir():
        raise ValueError(f"Source must contain a real LEAI directory: {source_leai}")
    if output_root == source_leai or _is_relative_to(output_root, source_leai):
        raise ValueError("Output cannot be the source LEAI directory or a child of it")
    if not output_root.parent.is_dir():
        raise ValueError(f"Output parent does not exist: {output_root.parent}")

    if output_root.exists():
        if not output_root.is_dir():
            raise ValueError("Existing output must be a directory")
        if any(output_root.iterdir()):
            raise ValueError("Existing output directory must be empty")

    for name in ("InstructorHome.html", *ENVIRONMENT_SCRIPTS):
        _require_regular_file(source_leai / name)

    return source_root, source_leai, output_root


def tree_manifest(root: Path) -> dict[str, tuple[str, str]]:
    """Hash every file and record every path without following symlinks."""
    resolved_root = root.resolve(strict=True)
    manifest: dict[str, tuple[str, str]] = {".": ("directory", "")}

    def visit(directory: Path) -> None:
        with os.scandir(directory) as entries:
            for entry in sorted(entries, key=lambda item: item.name):
                path = Path(entry.path)
                relative = path.relative_to(resolved_root).as_posix()
                if entry.is_symlink():
                    link_target = os.readlink(path)
                    if Path(link_target).is_absolute():
                        raise ValueError(f"Absolute source symlink is unsafe to copy: {path}")
                    try:
                        target = path.resolve(strict=True)
                    except (FileNotFoundError, RuntimeError) as exc:
                        raise ValueError(f"Broken or cyclic source symlink: {path}") from exc
                    if not _is_relative_to(target, resolved_root):
                        raise ValueError(f"Source symlink escapes LEAI: {path}")
                    manifest[relative] = ("symlink", link_target)
                elif entry.is_dir(follow_symlinks=False):
                    manifest[relative] = ("directory", "")
                    visit(path)
                elif entry.is_file(follow_symlinks=False):
                    manifest[relative] = (
                        "file",
                        hashlib.sha256(path.read_bytes()).hexdigest(),
                    )
                else:
                    raise ValueError(f"Unsupported source entry: {path}")

    visit(resolved_root)
    return manifest


def manifest_hash(manifest: Mapping[str, tuple[str, str]]) -> str:
    digest = hashlib.sha256()
    for relative_path in sorted(manifest):
        record = [relative_path, *manifest[relative_path]]
        digest.update(
            json.dumps(record, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        )
        digest.update(b"\n")
    return digest.hexdigest()


def _environment_script_pattern(script_name: str) -> re.Pattern[str]:
    return re.compile(
        r"(?P<prefix>\bsrc\s*=\s*)(?P<quote>[\"'])(?P<path>(?:\.\.?/)*"
        + re.escape(script_name)
        + r")(?:\?[^\"']*)?(?P=quote)",
        re.IGNORECASE,
    )


def _rewrite_environment_cache_keys(leai_output: Path, build_id: str) -> None:
    html_paths: list[Path] = []
    for relative, (entry_type, _) in tree_manifest(leai_output).items():
        relative_path = Path(relative)
        if (
            entry_type in {"file", "symlink"}
            and relative_path.suffix.lower() in {".htm", ".html"}
        ):
            html_paths.append(leai_output / relative_path)

    rewrites: list[tuple[Path, str]] = []
    for html_path in sorted(html_paths):
        html = html_path.read_text(encoding="utf-8")
        patterns = {
            script_name: _environment_script_pattern(script_name)
            for script_name in ENVIRONMENT_SCRIPTS
        }
        if not any(pattern.search(html) for pattern in patterns.values()):
            continue

        for script_name in ENVIRONMENT_SCRIPTS:
            pattern = patterns[script_name]

            def replacement(match: re.Match[str]) -> str:
                quote = match.group("quote")
                return (
                    f'{match.group("prefix")}{quote}{match.group("path")}'
                    f"?v={build_id}{quote}"
                )

            html, replacement_count = pattern.subn(replacement, html)
            if replacement_count != 1:
                raise ValueError(
                    f"Expected exactly one {script_name} reference in {html_path}; "
                    f"found {replacement_count}"
                )
        rewrites.append((html_path, html))

    if not rewrites:
        raise ValueError("No copied HTML page loads the LEAI environment script stack")
    for html_path, html in rewrites:
        html_path.write_text(html, encoding="utf-8")


def _write_qa_config(leai_output: Path, api_base: str, build_id: str) -> None:
    config = {
        "environment": "qa",
        "apiBase": api_base,
        "publicBaseUrl": QA_PUBLIC_BASE,
        "buildId": build_id,
        "emailEnabled": False,
    }
    serialized = json.dumps(config, ensure_ascii=True, separators=(",", ":"))
    (leai_output / "leai-deployment-config.js").write_text(
        f"window.LEAI_DEPLOYMENT_CONFIG = {serialized};\n",
        encoding="utf-8",
    )


def _is_proven_inert_node_test(relative_path: Path, path: Path) -> bool:
    if (
        len(relative_path.parts) < 3
        or relative_path.parts[:2] != ("LEAI", "tests")
        or not relative_path.name.endswith(".test.js")
    ):
        return False
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False
    require_match = NODE_TEST_REQUIRE_PATTERN.search(text)
    hostname_offsets = [
        text.casefold().find(hostname.casefold())
        for hostname in FORBIDDEN_PRODUCTION_API_HOSTNAMES
    ]
    present_offsets = [offset for offset in hostname_offsets if offset >= 0]
    return (
        require_match is not None
        and (not present_offsets or require_match.start() < min(present_offsets))
    )


def _resolve_artifact_reference(
    artifact_root: Path,
    referring_path: Path,
    reference: str,
) -> Path | None:
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return None

    reference_path = unquote(parsed.path)
    if reference_path.startswith("/LEAI-QA/LEAI/"):
        candidate = artifact_root / "LEAI" / reference_path.removeprefix("/LEAI-QA/LEAI/")
    elif reference_path.startswith("/LEAI/"):
        candidate = artifact_root / "LEAI" / reference_path.removeprefix("/LEAI/")
    elif reference_path.startswith("/"):
        candidate = artifact_root / reference_path.removeprefix("/")
    else:
        candidate = referring_path.parent / reference_path

    resolved_candidate = candidate.resolve(strict=False)
    resolved_root = artifact_root.resolve(strict=True)
    if not _is_relative_to(resolved_candidate, resolved_root):
        return None
    return resolved_candidate


def _assert_no_production_api_literals(artifact_root: Path) -> None:
    manifest = tree_manifest(artifact_root)
    executable_paths: set[Path] = set()
    for relative, (entry_type, _) in manifest.items():
        relative_path = Path(relative)
        if (
            relative != "."
            and entry_type in {"file", "symlink"}
            and relative_path.suffix.lower() in BROWSER_EXECUTABLE_SUFFIXES
            and not _is_proven_inert_node_test(
                relative_path,
                artifact_root / relative_path,
            )
        ):
            executable_paths.add(artifact_root / relative_path)

    pending = list(executable_paths)
    inspected: set[Path] = set()
    while pending:
        path = pending.pop()
        resolved_path = path.resolve(strict=True)
        if resolved_path in inspected or not resolved_path.is_file():
            continue
        inspected.add(resolved_path)
        try:
            text = resolved_path.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError(f"Browser-executable artifact file is not UTF-8: {path}") from exc

        folded_text = text.casefold()
        for hostname in FORBIDDEN_PRODUCTION_API_HOSTNAMES:
            if hostname.casefold() in folded_text:
                relative = path.relative_to(artifact_root).as_posix()
                approved_hash = PROVEN_QA_INERT_PRODUCTION_FILES.get(relative)
                if (
                    approved_hash is not None
                    and hashlib.sha256(resolved_path.read_bytes()).hexdigest()
                    == approved_hash
                ):
                    continue
                raise ValueError(
                    f"Forbidden production API hostname in finished artifact: {relative}"
                )

        references = [
            match.group("reference")
            for match in LOCAL_BROWSER_REFERENCE_PATTERN.finditer(text)
        ]
        if path.suffix.lower() in {".htm", ".html"}:
            parser = _ArtifactReferenceParser()
            parser.feed(text)
            references.extend(parser.references)
        for reference in references:
            target = _resolve_artifact_reference(artifact_root, path, reference)
            if (
                target is not None
                and target.suffix.lower() in BROWSER_EXECUTABLE_SUFFIXES
                and target.exists()
            ):
                pending.append(target)


def _promote_staging(staging_root: Path, output_root: Path) -> None:
    if output_root.exists():
        if not output_root.is_dir() or output_root.is_symlink():
            raise ValueError("Output changed during the build and is no longer a safe directory")
        if any(output_root.iterdir()):
            raise ValueError("Output changed during the build and is no longer empty")
        output_root.rmdir()
    os.replace(staging_root, output_root)


def build_artifact(
    source: str | os.PathLike[str],
    output: str | os.PathLike[str],
    api_base: str,
    build_id: str,
) -> dict[str, str | int]:
    _, source_leai, output_root = _validate_inputs(
        source,
        output,
        api_base,
        build_id,
    )
    before_manifest = tree_manifest(source_leai)
    before_hash = manifest_hash(before_manifest)

    staging_root = Path(
        tempfile.mkdtemp(
            prefix=f".{output_root.name}.staging-",
            dir=output_root.parent,
        )
    )
    try:
        leai_output = staging_root / "LEAI"
        shutil.copytree(source_leai, leai_output, symlinks=True, copy_function=shutil.copy2)
        copied_manifest = tree_manifest(leai_output)
        if before_manifest != copied_manifest:
            raise RuntimeError("Copied LEAI tree does not match source manifest")
        _write_qa_config(leai_output, api_base, build_id)
        _rewrite_environment_cache_keys(leai_output, build_id)
        (staging_root / "index.html").write_text(INDEX_HTML, encoding="utf-8")
        _assert_no_production_api_literals(staging_root)

        after_manifest = tree_manifest(source_leai)
        if before_manifest != after_manifest:
            raise RuntimeError("Source LEAI tree changed while building the artifact")

        _promote_staging(staging_root, output_root)
    finally:
        if staging_root.exists():
            shutil.rmtree(staging_root)

    return {
        "output": str(output_root),
        "source_manifest_sha256": before_hash,
        "source_entry_count": len(before_manifest),
    }


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build the fixed, path-preserving LEAI QA Pages artifact."
    )
    parser.add_argument("--source", required=True, help="Frontend repository root")
    parser.add_argument("--output", required=True, help="Empty or absent artifact directory")
    parser.add_argument("--api-base", required=True, help="Fixed QA backend API base")
    parser.add_argument("--build-id", required=True, help="Safe deployed source identifier")
    return parser


def main() -> int:
    parser = _argument_parser()
    arguments = parser.parse_args()
    try:
        result = build_artifact(
            arguments.source,
            arguments.output,
            arguments.api_base,
            arguments.build_id,
        )
    except (OSError, RuntimeError, ValueError) as exc:
        parser.exit(2, f"error: {exc}\n")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
