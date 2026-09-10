from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import leai_formmode as formmode  # noqa: E402


def winter_schema_fixture() -> dict:
    return {
        "schema_id": "collab-ai-metacognition",
        "version": 1,
        "title": "Collaborative AI Metacognition",
        "course": "CMPM 80H",
        "instructor": "Mimi Rapoport",
        "week": "Winter 2027",
        "shallow_word_threshold": 8,
        "sections": [
            {
                "id": "understanding",
                "title": "Understanding the AI",
                "topic": "your understanding of the AI",
                "opening_prompt": "Explain your mental model, confidence, surprises, and remaining uncertainty all together.",
                "depth_probe": "What specific moment shaped that answer?",
                "fields": [
                    {"id": "mental-model", "kind": "shortform", "label": "How do you think the AI produced its response?"},
                    {"id": "confidence", "kind": "rating_with_justification", "label": "How confident are you in that explanation, and why?"},
                    {"id": "uncertainty", "kind": "longform", "label": "What are you still uncertain about?"},
                ],
            },
            {
                "id": "collaboration",
                "title": "Collaboration Choices",
                "topic": "how you collaborated with AI",
                "opening_prompt": "Describe every collaboration choice in one response.",
                "fields": [
                    {"id": "choice", "kind": "shortform", "label": "What choice did you keep for yourself?"},
                    {"id": "division", "kind": "table", "label": "How did you divide work between yourself and the AI?"},
                ],
            },
        ],
        "closing": {"feedback_prompt": "How was this reflection experience?"},
    }


def substantial_answer() -> str:
    return (
        "I compared its output with my notes, checked the examples it selected, "
        "and traced where its explanation stopped matching the evidence I had collected."
    )


class FieldByFieldFormModeTests(unittest.TestCase):
    def test_opening_targets_only_first_field(self) -> None:
        state = formmode.init_engine(winter_schema_fixture())

        self.assertEqual(state.field_cursor, 0)
        self.assertEqual(formmode.current_field(state)["id"], "mental-model")
        self.assertEqual(
            formmode.progress_label(state),
            "Area 1 of 2 — Understanding the AI · Question 1 of 3",
        )

        turn = formmode.before_turn(state, "")
        self.assertEqual(turn.directive["kind"], "field_opening")
        self.assertEqual(turn.directive["field_id"], "mental-model")
        self.assertIn("How do you think the AI produced its response?", turn.directive["text"])
        self.assertNotIn("How confident are you", turn.directive["text"])
        self.assertNotIn("What are you still uncertain about", turn.directive["text"])
        self.assertNotIn("Explain your mental model, confidence", turn.directive["text"])

    def test_substantive_answer_advances_one_field_with_attribution(self) -> None:
        state = formmode.init_engine(winter_schema_fixture())
        formmode.before_turn(state, "")

        turn = formmode.before_turn(state, substantial_answer())

        self.assertEqual(
            turn.response_attribution,
            {
                "form_schema_id": "collab-ai-metacognition",
                "form_schema_version": 1,
                "form_section_id": "understanding",
                "form_field_id": "mental-model",
                "form_field_label": "How do you think the AI produced its response?",
                "form_response_phase": "primary",
            },
        )
        self.assertEqual(state.field_cursor, 1)
        self.assertEqual(turn.directive["field_id"], "confidence")
        self.assertRegex(turn.directive["text"], r"rating and.*reason|rating.*justification")

    def test_thin_answer_gets_one_probe_then_advances(self) -> None:
        state = formmode.init_engine(winter_schema_fixture())
        formmode.before_turn(state, "")

        probe_turn = formmode.before_turn(state, "Not sure.")
        self.assertEqual(state.field_cursor, 0)
        self.assertEqual(probe_turn.directive["kind"], "field_probe")
        self.assertEqual(probe_turn.directive["field_id"], "mental-model")

        next_turn = formmode.before_turn(state, "Still not sure.")
        self.assertEqual(next_turn.response_attribution["form_response_phase"], "probe")
        self.assertEqual(state.field_cursor, 1)
        self.assertEqual(next_turn.directive["field_id"], "confidence")
        self.assertTrue(state.field_coverage["mental-model"]["probe_used"])

    def test_ordinary_concise_answer_advances_without_custom_threshold(self) -> None:
        schema = winter_schema_fixture()
        schema.pop("shallow_word_threshold")
        state = formmode.init_engine(schema)
        formmode.before_turn(state, "")

        turn = formmode.before_turn(
            state,
            "It predicted a likely answer from patterns in similar examples.",
        )

        self.assertEqual(state.field_cursor, 1)
        self.assertEqual(turn.directive["kind"], "field_question")
        self.assertEqual(turn.directive["field_id"], "confidence")

    def test_legacy_section_threshold_does_not_force_field_probe(self) -> None:
        schema = winter_schema_fixture()
        schema["shallow_word_threshold"] = 25
        state = formmode.init_engine(schema)
        formmode.before_turn(state, "")

        turn = formmode.before_turn(
            state,
            "It predicted a likely answer from patterns in similar examples.",
        )

        self.assertEqual(state.field_cursor, 1)
        self.assertEqual(turn.directive["field_id"], "confidence")

    def test_explicit_confusion_gets_one_same_field_rephrase(self) -> None:
        state = formmode.init_engine(winter_schema_fixture())
        formmode.before_turn(state, "")

        turn = formmode.before_turn(
            state,
            "I am not sure what this question means, so I cannot tell what kind of explanation you want from me.",
        )

        self.assertEqual(state.field_cursor, 0)
        self.assertEqual(turn.directive["kind"], "field_probe")
        self.assertEqual(turn.directive["field_id"], "mental-model")

    def test_field_directive_has_no_legacy_wrap_up_instruction(self) -> None:
        state = formmode.init_engine(winter_schema_fixture())
        turn = formmode.before_turn(state, "")

        self.assertNotIn("anything else", turn.directive["text"].lower())
        self.assertNotIn("sub-field", turn.directive["text"].lower())

    def test_displayed_primary_question_is_anchored_to_label(self) -> None:
        state = formmode.init_engine(winter_schema_fixture())
        pre = formmode.before_turn(state, "")

        self.assertEqual(
            pre.directive["student_question"],
            "How do you think the AI produced its response?",
        )
        post = formmode.after_turn(
            state,
            "Hi, I will guide you one item at a time. What made the AI useful?",
        )

        self.assertIn(
            "How do you think the AI produced its response?",
            post.displayed_message,
        )
        self.assertNotIn("What made the AI useful?", post.displayed_message)

    def test_first_person_label_becomes_grammatical_second_person_question(self) -> None:
        self.assertEqual(
            formmode.canonical_student_question(
                "How I make sure I’m giving the AI’s recommendation proper consideration before accepting it myself"
            ),
            "How do you make sure you’re giving the AI’s recommendation proper consideration before accepting it yourself?",
        )
        self.assertEqual(
            formmode.canonical_student_question(
                "How I divide the work between me and the AI based on my goals"
            ),
            "How do you divide the work between you and the AI based on your goals?",
        )

    def test_close_waits_for_feedback_then_final_ack_ends(self) -> None:
        state = formmode.init_engine(winter_schema_fixture())
        formmode.before_turn(state, "")
        for _ in range(5):
            pre = formmode.before_turn(state, substantial_answer())
        self.assertEqual(pre.directive["kind"], "close")

        close_post = formmode.after_turn(
            state,
            "How did this reflection compare with writing on your own?",
        )
        self.assertFalse(close_post.ended)

        final_pre = formmode.before_turn(state, "It was easier one question at a time.")
        self.assertEqual(final_pre.directive["kind"], "final_ack")
        final_post = formmode.after_turn(state, "Thanks, noted.")
        self.assertTrue(final_post.ended)

    def test_table_and_rating_kinds_generate_one_shaped_question_each(self) -> None:
        schema = {
            "schema_id": "team-kind-shapes",
            "version": "1.0.0",
            "sections": [{
                "id": "team",
                "title": "Team",
                "fields": [
                    {
                        "id": "roster",
                        "kind": "table",
                        "columns": ["Team Member", "Primary Role / Contribution This Week"],
                    },
                    {
                        "id": "shared-goal",
                        "kind": "rating_with_justification",
                        "dimension": "We had a clear, shared goal for the week.",
                    },
                ],
            }],
            "closing": {"feedback_prompt": "How was this reflection?"},
        }
        state = formmode.init_engine(schema)

        table_turn = formmode.before_turn(state, "")
        self.assertRegex(
            table_turn.directive["student_question"],
            r"(?i)What rows.*Team Member.*Primary Role / Contribution This Week",
        )
        self.assertEqual(table_turn.directive["student_question"].count("?"), 1)

        rating_turn = formmode.before_turn(state, substantial_answer())
        self.assertRegex(rating_turn.directive["student_question"], r"(?i)1.?5 rating")
        self.assertIn(
            "We had a clear, shared goal for the week",
            rating_turn.directive["student_question"],
        )
        self.assertTrue(rating_turn.directive["student_question"].lower().endswith("why?"))

    def test_final_field_probe_advances_directly_to_next_section(self) -> None:
        state = formmode.init_engine(winter_schema_fixture())
        formmode.before_turn(state, "")
        formmode.before_turn(state, substantial_answer())
        formmode.before_turn(state, substantial_answer())

        probe_turn = formmode.before_turn(state, "Nothing.")
        self.assertEqual(probe_turn.directive["kind"], "field_probe")
        self.assertEqual(probe_turn.directive["field_id"], "uncertainty")

        next_turn = formmode.before_turn(state, "I cannot name anything else yet.")
        self.assertEqual(state.current_area_index, 2)
        self.assertEqual(state.field_cursor, 0)
        self.assertEqual(next_turn.directive["field_id"], "choice")
        directive_body = next_turn.directive["text"].split("\n\n[HARD RULES")[0]
        self.assertNotIn("Anything else", directive_body)

    def test_schema_validation_rejects_ambiguous_identity_and_kind(self) -> None:
        duplicate = winter_schema_fixture()
        duplicate["sections"][1]["fields"][0]["id"] = "mental-model"
        with self.assertRaisesRegex(ValueError, r"(?i)duplicate field id.*mental-model"):
            formmode.init_engine(duplicate)

        missing_id = winter_schema_fixture()
        del missing_id["sections"][0]["fields"][0]["id"]
        with self.assertRaisesRegex(ValueError, r"(?i)field id is required"):
            formmode.init_engine(missing_id)

        unsupported = winter_schema_fixture()
        unsupported["sections"][0]["fields"][0]["kind"] = "essay_blob"
        with self.assertRaisesRegex(ValueError, r"(?i)unsupported field kind.*essay_blob"):
            formmode.init_engine(unsupported)

    def test_schema_validation_preserves_legacy_longform_fallback_only(self) -> None:
        legacy = {
            "schema_id": "legacy-longform",
            "version": "1.0.0",
            "sections": [{
                "id": "reflection",
                "title": "Reflection",
                "opening_prompt": "What happened this week?",
                "fields": [{"id": "reflection", "kind": "longform"}],
            }],
            "closing": {"feedback_prompt": "How was this reflection?"},
        }
        formmode.init_engine(legacy)

        unlabeled_shortform = winter_schema_fixture()
        del unlabeled_shortform["sections"][0]["fields"][0]["label"]
        with self.assertRaisesRegex(ValueError, r"(?i)shortform field.*label"):
            formmode.init_engine(unlabeled_shortform)


if __name__ == "__main__":
    unittest.main()
