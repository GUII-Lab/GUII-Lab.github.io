from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPOSITORY_ROOT / "scripts" / "build-leai-qa-artifact.py"
QA_API_BASE = "https://guiidata-leai-qa.herokuapp.com/datapipeline/api"
QA_PUBLIC_BASE = "https://guii-lab.github.io/LEAI-QA/LEAI/"
PAGES = (
    "CourseBanner.html",
    "Customizations.html",
    "FeedbackAnalyzer.html",
    "FeedbackChat.html",
    "InstructorHome.html",
    "PromptDesigner.html",
    "feedback.html",
)
ENVIRONMENT_SCRIPTS = (
    "leai-deployment-config.js",
    "leai-environment.js",
    "leai-shared.js",
)


spec = importlib.util.spec_from_file_location("build_leai_qa_artifact", SCRIPT_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load artifact builder from {SCRIPT_PATH}")
artifact_builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact_builder)


def source_manifest(root: Path) -> dict[str, tuple[str, str]]:
    """Independent test manifest that does not use production helpers."""
    manifest: dict[str, tuple[str, str]] = {".": ("directory", "")}
    for current, directory_names, file_names in os.walk(root, followlinks=False):
        current_path = Path(current)
        for name in sorted(directory_names + file_names):
            path = current_path / name
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                manifest[relative] = ("symlink", os.readlink(path))
            elif path.is_dir():
                manifest[relative] = ("directory", "")
            else:
                manifest[relative] = (
                    "file",
                    hashlib.sha256(path.read_bytes()).hexdigest(),
                )
    return manifest


class BuildLeaiQaArtifactTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.workspace = Path(self.temporary_directory.name)
        self.source = self.workspace / "source"
        self.leai = self.source / "LEAI"
        self.leai.mkdir(parents=True)

        script_tags = "\n".join(
            f'<script src="{name}?v=leai-env-r1"></script>'
            for name in ENVIRONMENT_SCRIPTS
        )
        for page in PAGES:
            (self.leai / page).write_text(
                f"<!doctype html><html><body>{page}{script_tags}</body></html>\n",
                encoding="utf-8",
            )

        (self.leai / "leai-deployment-config.js").write_text(
            "window.LEAI_DEPLOYMENT_CONFIG = null;\n",
            encoding="utf-8",
        )
        (self.leai / "leai-environment.js").write_text(
            "window.LEAI_ENVIRONMENT_SOURCE = true;\n",
            encoding="utf-8",
        )
        (self.leai / "leai-shared.js").write_text(
            "window.LEAI_SHARED_SOURCE = true;\n",
            encoding="utf-8",
        )
        nested = self.leai / "assets" / "nested"
        nested.mkdir(parents=True)
        (nested / "fixture.bin").write_bytes(b"\x00LEAI source bytes\xff")
        (nested / "empty-directory").mkdir()

        (self.source / "SCAI").mkdir()
        (self.source / "SCAI" / "index.html").write_text("not QA", encoding="utf-8")
        (self.source / ".git").mkdir()
        (self.source / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
        (self.source / "README.md").write_text("repository metadata\n", encoding="utf-8")

    def build(self, output: Path, build_id: str = "qa-build_2026.09-12") -> dict:
        return artifact_builder.build_artifact(
            self.source,
            output,
            QA_API_BASE,
            build_id,
        )

    def test_artifact_preserves_paths_rewrites_cache_keys_and_does_not_mutate_source(self) -> None:
        before = source_manifest(self.leai)
        output = self.workspace / "artifact"

        result = self.build(output)

        self.assertEqual(before, source_manifest(self.leai))
        self.assertEqual(set(path.name for path in output.iterdir()), {"LEAI", "index.html"})
        self.assertTrue((output / "LEAI" / "InstructorHome.html").is_file())
        self.assertEqual(
            (output / "LEAI" / "assets" / "nested" / "fixture.bin").read_bytes(),
            b"\x00LEAI source bytes\xff",
        )
        self.assertTrue((output / "LEAI" / "assets" / "nested" / "empty-directory").is_dir())
        self.assertFalse((output / "SCAI").exists())
        self.assertFalse((output / ".git").exists())
        self.assertFalse((output / "README.md").exists())

        for page in PAGES:
            copied_html = (output / "LEAI" / page).read_text(encoding="utf-8")
            source_html = (self.leai / page).read_text(encoding="utf-8")
            for script_name in ENVIRONMENT_SCRIPTS:
                self.assertIn(
                    f'{script_name}?v=qa-build_2026.09-12',
                    copied_html,
                    page,
                )
                self.assertIn(f'{script_name}?v=leai-env-r1', source_html, page)
            self.assertNotIn("leai-env-r1", copied_html, page)

        self.assertEqual(result["output"], str(output.resolve()))
        self.assertEqual(result["source_manifest_sha256"], artifact_builder.manifest_hash(before))
        self.assertEqual(result["source_entry_count"], len(before))

    def test_artifact_writes_exact_json_qa_configuration(self) -> None:
        output = self.workspace / "artifact"

        self.build(output, "safe-build-id")

        config_text = (output / "LEAI" / "leai-deployment-config.js").read_text(
            encoding="utf-8"
        )
        self.assertTrue(config_text.startswith("window.LEAI_DEPLOYMENT_CONFIG = "))
        self.assertTrue(config_text.endswith(";\n"))
        payload = config_text.removeprefix(
            "window.LEAI_DEPLOYMENT_CONFIG = "
        ).removesuffix(";\n")
        self.assertEqual(
            json.loads(payload),
            {
                "environment": "qa",
                "apiBase": QA_API_BASE,
                "publicBaseUrl": QA_PUBLIC_BASE,
                "buildId": "safe-build-id",
                "emailEnabled": False,
            },
        )

    def test_root_index_has_accessible_link_and_immediate_same_origin_redirect(self) -> None:
        output = self.workspace / "artifact"

        self.build(output)

        index = (output / "index.html").read_text(encoding="utf-8")
        self.assertIn('<html lang="en">', index)
        self.assertIn('<meta http-equiv="refresh" content="0; url=LEAI/InstructorHome.html">', index)
        self.assertIn('<main>', index)
        self.assertIn('<a href="LEAI/InstructorHome.html">Open LEAI QA</a>', index)
        self.assertNotIn("http://", index)
        self.assertNotIn("https://", index)

    def test_existing_empty_output_directory_is_allowed(self) -> None:
        output = self.workspace / "artifact"
        output.mkdir()

        self.build(output)

        self.assertTrue((output / "index.html").is_file())
        self.assertTrue((output / "LEAI" / "InstructorHome.html").is_file())

    def test_rejects_dangerous_or_overlapping_paths_before_writing(self) -> None:
        dangerous_outputs = {
            "filesystem root": Path("/"),
            "source root": self.source,
            "source LEAI": self.leai,
            "inside source root": self.source / "artifact",
            "inside source LEAI": self.leai / "artifact",
            "ancestor of source": self.workspace,
        }
        for label, output in dangerous_outputs.items():
            with self.subTest(label=label), self.assertRaises(ValueError):
                self.build(output)

        with self.assertRaises(ValueError):
            artifact_builder.build_artifact(
                Path("/"),
                self.workspace / "root-source-output",
                QA_API_BASE,
                "safe-build",
            )

    def test_rejects_nonempty_output_without_deleting_its_contents(self) -> None:
        output = self.workspace / "artifact"
        output.mkdir()
        sentinel = output / "keep-me.txt"
        sentinel.write_text("unknown content", encoding="utf-8")

        with self.assertRaises(ValueError):
            self.build(output)

        self.assertEqual(sentinel.read_text(encoding="utf-8"), "unknown content")
        self.assertEqual(list(output.iterdir()), [sentinel])

    def test_rejects_any_api_base_except_the_exact_https_qa_base(self) -> None:
        invalid_api_bases = (
            "http://guiidata-leai-qa.herokuapp.com/datapipeline/api",
            "https://guiidata-leai-qa.herokuapp.com/datapipeline/api/",
            "https://guiidata-b6c968e6ed85.herokuapp.com/datapipeline/api",
            "https://example.test/datapipeline/api",
            "",
        )
        for index, api_base in enumerate(invalid_api_bases):
            output = self.workspace / f"invalid-api-{index}"
            with self.subTest(api_base=api_base), self.assertRaises(ValueError):
                artifact_builder.build_artifact(
                    self.source,
                    output,
                    api_base,
                    "safe-build",
                )
            self.assertFalse(output.exists())

    def test_rejects_empty_or_unsafe_build_ids_without_writing(self) -> None:
        invalid_build_ids = (
            "",
            "   ",
            "../escape",
            "bad/query",
            "bad?query",
            "bad#fragment",
            "<script>alert(1)</script>",
            "a" * 129,
        )
        for index, build_id in enumerate(invalid_build_ids):
            output = self.workspace / f"invalid-build-{index}"
            with self.subTest(build_id=build_id), self.assertRaises(ValueError):
                self.build(output, build_id)
            self.assertFalse(output.exists())

    def test_failed_rewrite_leaves_no_partial_artifact(self) -> None:
        broken_page = self.leai / "FeedbackChat.html"
        broken_page.write_text(
            '<!doctype html><html><body><script src="leai-shared.js?v=old"></script></body></html>\n',
            encoding="utf-8",
        )
        output = self.workspace / "artifact"
        output.mkdir()

        with self.assertRaises(ValueError):
            self.build(output)

        self.assertTrue(output.is_dir())
        self.assertEqual(list(output.iterdir()), [])
        self.assertEqual(
            broken_page.read_text(encoding="utf-8"),
            '<!doctype html><html><body><script src="leai-shared.js?v=old"></script></body></html>\n',
        )
        self.assertEqual(list(self.workspace.glob(".artifact.staging-*")), [])

    def test_rejects_source_symlinks_that_escape_leai_without_copying_them(self) -> None:
        outside = self.workspace / "outside-secret.txt"
        outside.write_text("must not be copied", encoding="utf-8")
        (self.leai / "unsafe-link.txt").symlink_to(outside)
        output = self.workspace / "artifact"

        with self.assertRaises(ValueError):
            self.build(output)

        self.assertFalse(output.exists())

    def test_rejects_absolute_symlinks_that_would_escape_the_copied_artifact(self) -> None:
        target = self.leai / "assets" / "nested" / "fixture.bin"
        (self.leai / "absolute-link.bin").symlink_to(target.resolve())
        output = self.workspace / "artifact"

        with self.assertRaises(ValueError):
            self.build(output)

        self.assertFalse(output.exists())

    def test_preserves_safe_internal_symlinks_without_following_them(self) -> None:
        target = self.leai / "assets" / "nested" / "fixture.bin"
        link = self.leai / "assets" / "fixture-link.bin"
        link.symlink_to(Path("nested") / target.name)
        output = self.workspace / "artifact"

        self.build(output)

        copied_link = output / "LEAI" / "assets" / "fixture-link.bin"
        self.assertTrue(copied_link.is_symlink())
        self.assertEqual(os.readlink(copied_link), "nested/fixture.bin")


if __name__ == "__main__":
    unittest.main()
