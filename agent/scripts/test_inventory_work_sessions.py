#!/usr/bin/env python3
"""Focused stdlib unittest for agent/scripts/inventory_work_sessions.py.

Every fixture lives in a temporary directory; no real Pi session files are touched.
Run from the repo root:
  python3 -m unittest discover -s agent/scripts -p 'test_*.py' -v
"""

import contextlib
import copy
import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import inventory_work_sessions as inv  # noqa: E402

LEAD = "11111111-0000-7000-8000-00000000000a"
CHILD = "22222222-0000-7000-8000-00000000000b"
CAND = "33333333-0000-7000-8000-00000000000c"
LEAD_TS = "2026-11-02T08:00:00.000Z"
CHILD_TS = "2026-11-02T08:00:10.000Z"
LAUNCH_MS = inv.parse_iso_ms(CHILD_TS) - 5000  # child header is 5000 ms after launch
PANE, PANE_NAME = "w1:p2", "child-scout"


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def user_entry(eid, text):
    return {"type": "message", "id": eid, "parentId": None, "timestamp": LEAD_TS,
            "message": {"role": "user", "content": [{"type": "text", "text": text}]}}


def ownership_entry(eid, owner, pane, name):
    return {"type": "custom", "id": eid, "parentId": None, "timestamp": LEAD_TS,
            "customType": inv.OWNERSHIP_TYPE,
            "data": {"sessionId": owner,
                     "records": [{"pane_id": pane, "name": name, "launched_at": LAUNCH_MS, "terminal_id": "t1"}]}}


def header(sid, ts):
    return {"type": "session", "version": 3, "id": sid, "timestamp": ts, "cwd": "/tmp/repo"}


class InventoryFixture(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="inv-test-")
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.sessions_dir = os.path.join(self.tmp, "sessions")
        os.makedirs(self.sessions_dir)
        self.lead_path = self.write_session("lead.jsonl", LEAD, LEAD_TS,
                                            [user_entry("lu1", "lead prompt"),
                                             ownership_entry("own1", LEAD, PANE, PANE_NAME)])
        self.child_path = self.write_session("child.jsonl", CHILD, CHILD_TS,
                                             [user_entry("cu1", "child prompt")])
        self.meta = self.base_meta()

    # -- fixture builders -------------------------------------------------------
    def write_session(self, name, sid, ts, entries, trailing_newline=True):
        """entries: dicts are dumped as JSON; strings are written verbatim (for malformed lines)."""
        lines = [json.dumps(header(sid, ts))]
        lines += [e if isinstance(e, str) else json.dumps(e) for e in entries]
        text = "\n".join(lines) + ("\n" if trailing_newline else "")
        path = os.path.join(self.sessions_dir, name)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        return path

    def verification(self, owned):
        return {"session_file_and_header": "verified", "first_user_message": "verified",
                "owner_record_lists_pane": "verified" if owned else "not_applicable",
                "pane_to_session_link": "inferred" if owned else "not_applicable",
                "role": "inferred"}

    def lead_record(self):
        return {"session_id": LEAD, "path": self.lead_path,
                "header": {"timestamp": LEAD_TS, "cwd": "/tmp/repo"}, "role": "lead",
                "verification": self.verification(owned=False),
                "relationship": {"launched_by": None, "pane_id": None, "pane_name": None,
                                 "launch_evidence": None},
                "first_user_message": {"entry_id": "lu1", "sha256": sha("lead prompt")},
                "evidence": [{"in_session": LEAD, "entry_id": "lu1", "entry_type": "message"}]}

    def child_record(self):
        return {"session_id": CHILD, "path": self.child_path,
                "header": {"timestamp": CHILD_TS, "cwd": "/tmp/repo"}, "role": "scout",
                "verification": self.verification(owned=True),
                "relationship": {"launched_by": LEAD, "pane_id": PANE, "pane_name": PANE_NAME,
                                 "launch_evidence": {"in_session": LEAD, "entry_id": "own1",
                                                     "entry_type": "custom",
                                                     "custom_type": inv.OWNERSHIP_TYPE,
                                                     "launched_at_ms": LAUNCH_MS},
                                 "timing_delta_ms": 5000, "link_basis": "fixture: text match"},
                "first_user_message": {"entry_id": "cu1", "sha256": sha("child prompt")},
                "evidence": [{"in_session": CHILD, "entry_id": "cu1", "entry_type": "message"}]}

    def base_meta(self):
        return {"schema": inv.SCHEMA, "schema_version": "1.0.0",
                "scope": {"sessions_dir": self.sessions_dir, "file_pattern": "*.jsonl"},
                "discovery": {"files_in_scope": 2, "participants_listed": 2},
                "sessions": [self.lead_record(), self.child_record()],
                "launches_without_session_file": [], "candidates_not_listed": []}

    def errors(self, meta=None):
        return inv.validate_metadata(meta if meta is not None else self.meta, self.sessions_dir).errors

    def assert_error_containing(self, errors, fragment):
        self.assertTrue(any(fragment in e for e in errors),
                        "expected an error containing %r; got %r" % (fragment, errors))


class ValidInventory(InventoryFixture):
    def test_valid_inventory_has_no_errors(self):
        self.assertEqual(self.errors(), [])

    def test_provenance_fields_are_explicit(self):
        child = self.meta["sessions"][1]
        self.assertNotIn("confidence", child)
        self.assertEqual(child["verification"]["pane_to_session_link"], "inferred")
        self.assertEqual(child["verification"]["session_file_and_header"], "verified")

    def test_pane_link_cannot_be_claimed_verified(self):
        self.meta["sessions"][1]["verification"]["pane_to_session_link"] = "verified"
        self.assert_error_containing(self.errors(), "pane_to_session_link must be 'inferred'")

    def test_missing_link_basis_is_rejected(self):
        del self.meta["sessions"][1]["relationship"]["link_basis"]
        self.assert_error_containing(self.errors(), "link_basis")

    def test_legacy_confidence_field_is_rejected(self):
        self.meta["sessions"][0]["confidence"] = "verified"
        self.assert_error_containing(self.errors(), "legacy 'confidence' field")

    def test_timing_delta_mismatch_is_rejected(self):
        self.meta["sessions"][1]["relationship"]["timing_delta_ms"] = 1
        self.assert_error_containing(self.errors(), "timing_delta_ms 1 !=")


class MalformedJsonl(InventoryFixture):
    def test_malformed_nonblank_line_is_error_not_skipped(self):
        self.write_session("child.jsonl", CHILD, CHILD_TS,
                           ["{not json", user_entry("cu1", "child prompt")])
        errors = self.errors()
        self.assert_error_containing(errors, "line 2: malformed JSON")

    def test_partial_live_write_reports_transient_caveat(self):
        self.write_session("child.jsonl", CHILD, CHILD_TS,
                           [user_entry("cu1", "child prompt"), '{"type":"mess'], trailing_newline=False)
        errors = self.errors()
        self.assert_error_containing(errors, "malformed JSON")
        self.assert_error_containing(errors, "transient-read caveat")

    def test_duplicate_entry_id_is_error(self):
        self.write_session("child.jsonl", CHILD, CHILD_TS,
                           [user_entry("cu1", "child prompt"), user_entry("cu1", "other")])
        self.assert_error_containing(self.errors(), "duplicate entry id cu1")

    def test_entry_without_id_is_error(self):
        self.write_session("child.jsonl", CHILD, CHILD_TS,
                           [user_entry("cu1", "child prompt"), {"type": "message"}])
        self.assert_error_containing(self.errors(), "not an object with a string id")

    def test_blank_lines_are_ignored(self):
        path = self.write_session("child.jsonl", CHILD, CHILD_TS, [user_entry("cu1", "child prompt")])
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n   \n")
        self.assertEqual(self.errors(), [])


class FirstUserMessage(InventoryFixture):
    def test_wrong_first_user_message_is_rejected_even_with_matching_sha(self):
        # Two user messages; the record points at the SECOND one with the SECOND one's sha.
        self.write_session("child.jsonl", CHILD, CHILD_TS,
                           [user_entry("cu1", "child prompt"), user_entry("cu2", "follow-up")])
        meta = copy.deepcopy(self.meta)
        meta["sessions"][1]["first_user_message"] = {"entry_id": "cu2", "sha256": sha("follow-up")}
        errors = self.errors(meta)
        self.assert_error_containing(errors, "not the first user message in the file (first is cu1)")
        self.assertFalse(any("sha256 mismatch" in e for e in errors), errors)

    def test_first_user_message_sha_mismatch_is_rejected(self):
        meta = copy.deepcopy(self.meta)
        meta["sessions"][1]["first_user_message"]["sha256"] = sha("something else")
        self.assert_error_containing(self.errors(meta), "sha256 mismatch")

    def test_first_user_message_pointing_at_non_user_entry_is_rejected(self):
        meta = copy.deepcopy(self.meta)
        meta["sessions"][1]["first_user_message"]["entry_id"] = "own1"
        self.assert_error_containing(self.errors(meta), "not the first user message")


class EvidenceAndHeaders(InventoryFixture):
    def test_missing_evidence_entry_is_rejected(self):
        meta = copy.deepcopy(self.meta)
        meta["sessions"][1]["evidence"] = [{"in_session": CHILD, "entry_id": "nope", "entry_type": "message"}]
        self.assert_error_containing(self.errors(meta), "evidence entry nope not found")

    def test_evidence_entry_type_mismatch_is_rejected(self):
        meta = copy.deepcopy(self.meta)
        meta["sessions"][0]["evidence"] = [{"in_session": LEAD, "entry_id": "own1", "entry_type": "message"}]
        self.assert_error_containing(self.errors(meta), "has type custom, expected message")

    def test_evidence_for_unlisted_session_is_rejected(self):
        meta = copy.deepcopy(self.meta)
        meta["sessions"][0]["evidence"] = [{"in_session": CAND, "entry_id": "x", "entry_type": "message"}]
        self.assert_error_containing(self.errors(meta), "refers to unlisted session")

    def test_header_id_mismatch_is_rejected(self):
        self.write_session("child.jsonl", "99999999-0000-7000-8000-000000000009", CHILD_TS,
                           [user_entry("cu1", "child prompt")])
        self.assert_error_containing(self.errors(), "header id mismatch")

    def test_missing_source_file_is_rejected(self):
        os.remove(self.child_path)
        self.assert_error_containing(self.errors(), "source file missing")

    def test_launch_pane_not_in_owner_record_is_rejected(self):
        meta = copy.deepcopy(self.meta)
        meta["sessions"][1]["relationship"]["pane_id"] = "w1:p9"
        self.assert_error_containing(self.errors(meta), "does not list pane w1:p9")


class CandidateDetection(InventoryFixture):
    def test_unlisted_file_is_reported_as_candidate_and_unrecorded_warning(self):
        self.write_session("cand.jsonl", CAND, CHILD_TS, [user_entry("xu1", "config")])
        report = inv.validate_metadata(self.meta, self.sessions_dir)
        self.assertEqual(report.errors, [])
        self.assertTrue(any("cand.jsonl" in w for w in report.warnings), report.warnings)
        validator = inv.Validator(self.meta, self.sessions_dir)
        validator.run()
        lines = validator.candidate_lines()
        self.assertTrue(any("CANDIDATE cand.jsonl" in line and CAND in line for line in lines), lines)
        self.assertTrue(any("unclassified" in line for line in lines), lines)

    def test_candidate_with_malformed_line_reports_parse_errors(self):
        self.write_session("cand.jsonl", CAND, CHILD_TS, ["{broken", user_entry("xu1", "config")])
        validator = inv.Validator(self.meta, self.sessions_dir)
        validator.run()
        lines = validator.candidate_lines()
        self.assertTrue(any("parse_errors=1" in line for line in lines), lines)

    def test_recorded_candidate_with_wrong_id_is_rejected(self):
        path = self.write_session("cand.jsonl", CAND, CHILD_TS, [user_entry("xu1", "config")])
        meta = copy.deepcopy(self.meta)
        meta["candidates_not_listed"] = [{"session_id": "44444444-0000-7000-8000-000000000004", "path": path}]
        self.assert_error_containing(self.errors(meta), "header id mismatch")

    def test_candidate_also_listed_as_session_is_rejected(self):
        meta = copy.deepcopy(self.meta)
        meta["candidates_not_listed"] = [{"session_id": CHILD, "path": self.child_path}]
        self.assert_error_containing(self.errors(meta), "also listed as a session")


class CommandLine(InventoryFixture):
    def run_main(self, meta, extra=()):
        meta_path = os.path.join(self.tmp, "metadata.json")
        with open(meta_path, "w", encoding="utf-8") as fh:
            json.dump(meta, fh)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = inv.main([meta_path, "--sessions-dir", self.sessions_dir] + list(extra))
        return code, out.getvalue()

    def test_exit_0_and_passed_on_valid_inventory(self):
        code, out = self.run_main(self.meta)
        self.assertEqual(code, 0)
        self.assertIn("RESULT PASSED: 0 error(s)", out)

    def test_exit_1_on_malformed_jsonl(self):
        self.write_session("child.jsonl", CHILD, CHILD_TS, ["{bad", user_entry("cu1", "child prompt")])
        code, out = self.run_main(self.meta)
        self.assertEqual(code, 1)
        self.assertIn("RESULT FAILED", out)

    def test_exit_2_on_unsupported_schema(self):
        meta = copy.deepcopy(self.meta)
        meta["schema_version"] = "2.0.0"
        code, _ = self.run_main(meta)
        self.assertEqual(code, 2)

    def test_help_exits_zero(self):
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as cm:
            inv.main(["--help"])
        self.assertEqual(cm.exception.code, 0)


if __name__ == "__main__":
    unittest.main()
