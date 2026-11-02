#!/usr/bin/env python3
"""Validate a session-inventory metadata.json against the real Pi session JSONL files.

Standard library only. For every session listed in the metadata it checks that:
  - the file at `path` exists and every nonblank line parses (malformed lines are ERRORS)
  - line 1 is a session header whose id, timestamp and cwd match the record
  - entry ids are unique within the file
  - first_user_message is the FIRST user message in the file and its sha256 matches
  - every evidence entry exists in the named session file with the expected type
  - launched_by is backed by an ownership custom entry that lists the pane and name

Provenance levels (per session `verification` block):
  verified        checked against the JSONL by this validator
  inferred        matched by text or timing; no file records this link
  not_applicable  the field does not apply to this session
A pane-to-session link is never allowed to be 'verified': the ownership record names the
owner and pane, but no file records the child session id for that pane.

With --candidates it also lists in-scope JSONL files that are NOT recorded. Candidates are
reported only; they are not classified as participants, and a passing run does NOT prove
completeness.

Transient-read caveat: a file whose last line lacks a trailing newline may be a partial live
write. That line is reported as an ERROR and the caveat is printed. Re-run once the writer
has flushed before treating the failure as real.

Usage:
  python3 agent/scripts/inventory_work_sessions.py METADATA [--sessions-dir DIR] [--candidates]

Exit codes: 0 = no errors (warnings allowed), 1 = validation errors, 2 = unreadable metadata
or unsupported schema / usage error.
"""

import argparse
import glob
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

SCHEMA = "pi-smart-compact/grounded-agent-work-map/session-inventory"
SUPPORTED_MAJOR = "1"
OWNERSHIP_TYPE = "pi-subagent-herdr-ownership-v1"
VERIFICATION_KEYS = ("session_file_and_header", "first_user_message", "owner_record_lists_pane",
                     "pane_to_session_link", "role")
LEVELS = {"verified", "inferred", "unresolved", "not_applicable"}
CAVEAT = ("transient-read caveat: file has no trailing newline, so the last line may be a partial "
          "live write; re-run after the writer flushes before treating this as a real defect")


def expand(path):
    return os.path.abspath(os.path.expanduser(path))


def user_text(content):
    """Deterministic text of a message content (string or list of blocks)."""
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")


def is_user_message(entry):
    msg = entry.get("message")
    return entry.get("type") == "message" and isinstance(msg, dict) and msg.get("role") == "user"


def parse_iso_ms(value):
    try:
        dt = datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None
    return int(round(dt.timestamp() * 1000))


class SessionFile:
    """One JSONL session file. Every nonblank line is parsed; problems go to `errors`."""

    def __init__(self, path):
        self.path = path
        self.readable = True
        self.header = None
        self.entries = {}      # id -> entry (header excluded)
        self.ordered = []      # entries in file order (header excluded)
        self.errors = []       # human-readable problems, with line numbers
        try:
            with open(path, "rb") as fh:
                data = fh.read()
        except OSError as exc:
            self.readable = False
            self.errors.append("cannot read %s: %s" % (path, exc))
            return

        partial_tail = len(data) > 0 and not data.endswith(b"\n")
        last_nonblank = None
        for lineno, raw in enumerate(data.split(b"\n"), start=1):
            if not raw.strip():
                continue
            last_nonblank = lineno
            try:
                obj = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError) as exc:
                self.errors.append("line %d: malformed JSON (%s)" % (lineno, exc))
                continue
            if lineno == 1:
                if isinstance(obj, dict):
                    self.header = obj
                else:
                    self.errors.append("line 1: header is not a JSON object")
                continue
            if not isinstance(obj, dict) or not isinstance(obj.get("id"), str):
                self.errors.append("line %d: entry is not an object with a string id" % lineno)
                continue
            if obj["id"] in self.entries:
                self.errors.append("line %d: duplicate entry id %s" % (lineno, obj["id"]))
                continue
            self.entries[obj["id"]] = obj
            self.ordered.append(obj)

        if partial_tail and last_nonblank is not None:
            self.errors.append("%s (last nonblank line %d)" % (CAVEAT, last_nonblank))

    def first_user_message(self):
        for entry in self.ordered:
            if is_user_message(entry):
                return entry
        return None


class Report:
    def __init__(self):
        self.errors, self.warnings, self.notes = [], [], []


class Validator:
    def __init__(self, meta, sessions_dir):
        self.meta = meta
        self.sessions_dir = sessions_dir
        self.report = Report()
        self._files = {}
        self.listed = {}  # session_id -> path (first occurrence)

    # -- helpers -----------------------------------------------------------------
    def file(self, path):
        if path not in self._files:
            self._files[path] = SessionFile(path)
        return self._files[path]

    def err(self, msg):
        self.report.errors.append(msg)

    def warn(self, msg):
        self.report.warnings.append(msg)

    def note(self, msg):
        self.report.notes.append(msg)

    # -- main --------------------------------------------------------------------
    def run(self):
        sessions = self.meta.get("sessions", [])
        seen_paths = set()
        for s in sessions:
            sid, path = s.get("session_id"), s.get("path")
            tag = "session %s" % (sid or "<no id>")
            if not sid or not path:
                self.err("%s: missing session_id or path" % tag)
                continue
            if sid in self.listed:
                self.err("%s: duplicate session_id in metadata" % tag)
            if path in seen_paths:
                self.err("%s: duplicate path in metadata (%s)" % (tag, path))
            self.listed.setdefault(sid, path)
            seen_paths.add(path)

        for s in sessions:
            if s.get("session_id") and s.get("path"):
                self.check_session(s)

        for item in self.meta.get("launches_without_session_file", []):
            self.check_orphan_launch(item)

        for c in self.meta.get("candidates_not_listed", []):
            self.check_candidate_record(c, seen_paths)

        disc = self.meta.get("discovery", {})
        if disc.get("participants_listed") != len(sessions):
            self.err("discovery.participants_listed=%s but %d sessions present"
                     % (disc.get("participants_listed"), len(sessions)))
        in_scope = self.in_scope_files()
        if disc.get("files_in_scope") != len(in_scope):
            self.warn("discovery.files_in_scope=%s but %d files match now (scope changed or snapshot stale)"
                      % (disc.get("files_in_scope"), len(in_scope)))
        known = seen_paths | {c.get("path") for c in self.meta.get("candidates_not_listed", [])}
        for f in in_scope:
            if f not in known:
                self.warn("unrecorded in-scope file (not listed nor candidate): %s" % os.path.basename(f))
        return self.report

    def in_scope_files(self):
        pattern = self.meta.get("scope", {}).get("file_pattern", "*.jsonl")
        return sorted(glob.glob(os.path.join(self.sessions_dir, pattern)))

    # -- per-session checks --------------------------------------------------------
    def check_session(self, s):
        sid, path = s["session_id"], s["path"]
        tag = "session %s" % sid
        for key in ("header", "role", "verification", "relationship", "first_user_message", "evidence"):
            if key not in s:
                self.err("%s: missing field %s" % (tag, key))
        if "confidence" in s:
            self.err("%s: legacy 'confidence' field present; use 'verification' provenance levels" % tag)
        ver = s.get("verification", {})
        for key in VERIFICATION_KEYS:
            if ver.get(key) not in LEVELS:
                self.err("%s: verification.%s must be one of %s (got %r)" % (tag, key, sorted(LEVELS), ver.get(key)))

        if not os.path.isfile(path):
            self.err("%s: source file missing: %s" % (tag, path))
            return
        sf = self.file(path)
        for line in sf.errors:
            self.err("%s: %s" % (tag, line))
        if not sf.readable:
            return
        if sf.header is None:
            self.err("%s: first line is not a session header" % tag)
            return

        h = sf.header
        if h.get("type") != "session":
            self.err("%s: header type is %r, expected 'session'" % (tag, h.get("type")))
        if h.get("id") != sid:
            self.err("%s: header id mismatch (header=%s)" % (tag, h.get("id")))
        rec = s.get("header", {})
        if rec.get("timestamp") != h.get("timestamp"):
            self.err("%s: header timestamp mismatch (recorded=%s header=%s)"
                     % (tag, rec.get("timestamp"), h.get("timestamp")))
        if rec.get("cwd") != h.get("cwd"):
            self.err("%s: header cwd mismatch (recorded=%s header=%s)" % (tag, rec.get("cwd"), h.get("cwd")))

        self.check_first_user(tag, s, sf)
        for ev in s.get("evidence", []):
            self.check_evidence(tag, ev)
        self.check_relationship(tag, s, ver, h)

    def check_first_user(self, tag, s, sf):
        fu = s.get("first_user_message", {})
        true_first = sf.first_user_message()
        if true_first is None:
            self.err("%s: file has no user message" % tag)
            return
        rec_id = fu.get("entry_id")
        if rec_id != true_first["id"]:
            self.err("%s: first_user_message %s is not the first user message in the file (first is %s)"
                     % (tag, rec_id, true_first["id"]))
        rec_entry = sf.entries.get(rec_id)
        if rec_entry is None or not is_user_message(rec_entry):
            self.err("%s: first_user_message entry %s not found as a user message" % (tag, rec_id))
            return
        digest = hashlib.sha256(user_text(rec_entry["message"].get("content")).encode("utf-8")).hexdigest()
        if digest != fu.get("sha256"):
            self.err("%s: first_user_message sha256 mismatch" % tag)

    def check_evidence(self, tag, ev):
        in_session = ev.get("in_session")
        path = self.listed.get(in_session)
        if path is None:
            self.err("%s: evidence %s refers to unlisted session %s" % (tag, ev.get("entry_id"), in_session))
            return
        entry = self.file(path).entries.get(ev.get("entry_id"))
        if entry is None:
            self.err("%s: evidence entry %s not found in %s" % (tag, ev.get("entry_id"), in_session))
            return
        if entry.get("type") != ev.get("entry_type"):
            self.err("%s: evidence entry %s has type %s, expected %s"
                     % (tag, ev.get("entry_id"), entry.get("type"), ev.get("entry_type")))
        if "custom_type" in ev and entry.get("customType") != ev["custom_type"]:
            self.err("%s: evidence entry %s customType mismatch" % (tag, ev.get("entry_id")))

    def check_relationship(self, tag, s, ver, header):
        rel = s.get("relationship", {})
        owner = rel.get("launched_by")
        if owner is None:
            if ver.get("pane_to_session_link") == "inferred":
                self.err("%s: pane_to_session_link is 'inferred' but launched_by is null" % tag)
            if rel.get("launch_evidence") is not None:
                self.err("%s: launch_evidence present without launched_by" % tag)
            return

        if ver.get("pane_to_session_link") != "inferred":
            self.err("%s: pane_to_session_link must be 'inferred' (no file records the child session id "
                     "for a pane; got %r)" % (tag, ver.get("pane_to_session_link")))
        if ver.get("owner_record_lists_pane") != "verified":
            self.err("%s: owner_record_lists_pane must be 'verified' when launched_by is set" % tag)
        if not rel.get("link_basis"):
            self.err("%s: link_basis (how the pane-session link was inferred) is required when launched_by is set" % tag)

        le = rel.get("launch_evidence") or {}
        if owner not in self.listed:
            self.err("%s: launched_by %s is not a listed session" % (tag, owner))
        if le.get("in_session") != owner:
            self.err("%s: launch_evidence.in_session %s != launched_by %s" % (tag, le.get("in_session"), owner))
        elif le.get("custom_type") != OWNERSHIP_TYPE:
            self.err("%s: launch_evidence.custom_type is not %s" % (tag, OWNERSHIP_TYPE))
        elif owner in self.listed:
            owner_path = self.listed[owner]
            if not os.path.isfile(owner_path):
                self.err("%s: owner session file for %s not available" % (tag, owner))
            else:
                entry = self.file(owner_path).entries.get(le.get("entry_id"))
                if entry is None or not owns_pane(entry, owner, rel.get("pane_id"), rel.get("pane_name")):
                    self.err("%s: owner entry %s does not list pane %s (%s)"
                             % (tag, le.get("entry_id"), rel.get("pane_id"), rel.get("pane_name")))

        if "timing_delta_ms" in rel:
            launched = le.get("launched_at_ms")
            header_ms = parse_iso_ms(header.get("timestamp"))
            if launched is None or header_ms is None:
                self.err("%s: cannot recompute timing_delta_ms (missing launched_at_ms or header timestamp)" % tag)
            elif rel["timing_delta_ms"] != header_ms - launched:
                self.err("%s: timing_delta_ms %s != header-launch %s"
                         % (tag, rel["timing_delta_ms"], header_ms - launched))

    def check_orphan_launch(self, item):
        owner = item.get("owner_session_id")
        if owner not in self.listed:
            self.err("launch %s: owner %s not listed" % (item.get("pane_id"), owner))
            return
        entry = self.file(self.listed[owner]).entries.get(item.get("ownership_entry_id"))
        if entry is None or not owns_pane(entry, owner, item.get("pane_id"), item.get("pane_name")):
            self.err("launch %s: ownership entry %s does not list this pane"
                     % (item.get("pane_id"), item.get("ownership_entry_id")))
        else:
            self.note("launch %s (%s): ownership record verified; no session file recorded"
                      % (item.get("pane_id"), item.get("pane_name")))

    def check_candidate_record(self, c, listed_paths):
        p = c.get("path")
        if p in listed_paths:
            self.err("candidate %s is also listed as a session" % p)
        if not p or not os.path.isfile(p):
            self.err("candidate source missing: %s" % p)
            return
        sf = self.file(p)
        for line in sf.errors:
            self.err("candidate %s: %s" % (os.path.basename(p), line))
        if (sf.header or {}).get("id") != c.get("session_id"):
            self.err("candidate %s: header id mismatch (recorded=%s header=%s)"
                     % (os.path.basename(p), c.get("session_id"), (sf.header or {}).get("id")))

    # -- candidate discovery (report only) ---------------------------------------------
    def candidate_lines(self):
        known = {s.get("path") for s in self.meta.get("sessions", [])}
        known |= {c.get("path") for c in self.meta.get("candidates_not_listed", [])}
        files = self.in_scope_files()
        unlisted = [f for f in files if f not in known]
        pattern = self.meta.get("scope", {}).get("file_pattern", "*.jsonl")
        lines = ["in-scope files matching %s: %d; recorded (listed or candidate): %d; unrecorded: %d"
                 % (pattern, len(files), len(files) - len(unlisted), len(unlisted))]
        listed_ids = set(self.listed)
        for f in unlisted:
            sf = SessionFile(f)  # fresh read: candidates are not validated as participants
            h = sf.header or {}
            users = sum(1 for e in sf.ordered if is_user_message(e))
            fu = sf.first_user_message()
            fu_sha = (hashlib.sha256(user_text(fu["message"].get("content")).encode("utf-8")).hexdigest()[:16]
                      if fu else "-")
            with open(f, encoding="utf-8", errors="replace") as fh:
                raw = fh.read()
            refs = sorted(sid for sid in listed_ids if sid and sid != h.get("id") and sid in raw)
            lines.append("  CANDIDATE %s  id=%s ts=%s cwd=%s user_msgs=%d first_user_sha=%s "
                         "listed_ids_referenced=%d parse_errors=%d"
                         % (os.path.basename(f), h.get("id"), h.get("timestamp"), h.get("cwd"),
                            users, fu_sha, len(refs), len(sf.errors)))
        lines.append("NOTE: candidates are unclassified. Listing one does not make it a participant; "
                     "passing does not prove completeness.")
        return lines


def owns_pane(entry, owner, pane_id, pane_name):
    if entry.get("type") != "custom" or entry.get("customType") != OWNERSHIP_TYPE:
        return False
    data = entry.get("data", {})
    if not isinstance(data, dict) or data.get("sessionId") != owner:
        return False
    return any(r.get("pane_id") == pane_id and r.get("name") == pane_name for r in data.get("records", []))


def schema_problem(meta):
    version = str(meta.get("schema_version", ""))
    if meta.get("schema") != SCHEMA or version.split(".")[0] != SUPPORTED_MAJOR:
        return "unsupported schema %r version %r" % (meta.get("schema"), version)
    return None


def validate_metadata(meta, sessions_dir):
    """Return a Report. Raises ValueError on unsupported schema."""
    problem = schema_problem(meta)
    if problem:
        raise ValueError(problem)
    return Validator(meta, sessions_dir).run()


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Validate a session-inventory metadata.json against Pi session JSONL headers and entries.",
        epilog="Example: python3 agent/scripts/inventory_work_sessions.py "
               "docs/grounded-agent-work-map/2026-11-02-native-tree-retirement/metadata.json --candidates")
    ap.add_argument("metadata", help="path to metadata.json")
    ap.add_argument("--sessions-dir", help="override scope.sessions_dir from the metadata")
    ap.add_argument("--candidates", action="store_true",
                    help="also list in-scope JSONL files that are not recorded (unclassified, no completeness claim)")
    args = ap.parse_args(argv)

    try:
        with open(expand(args.metadata), encoding="utf-8") as fh:
            meta = json.load(fh)
    except (OSError, ValueError) as exc:
        print("ERROR cannot read metadata: %s" % exc, file=sys.stderr)
        return 2
    problem = schema_problem(meta)
    if problem:
        print("ERROR %s" % problem, file=sys.stderr)
        return 2
    sessions_dir = expand(args.sessions_dir or meta.get("scope", {}).get("sessions_dir", ""))
    if not os.path.isdir(sessions_dir):
        print("ERROR sessions dir not found: %s" % sessions_dir, file=sys.stderr)
        return 2

    validator = Validator(meta, sessions_dir)
    report = validator.run()
    print("CHECKED metadata=%s sessions=%d sessions_dir=%s"
          % (expand(args.metadata), len(meta.get("sessions", [])), sessions_dir))
    for n in report.notes:
        print("NOTE  " + n)
    for w in report.warnings:
        print("WARN  " + w)
    for e in report.errors:
        print("ERROR " + e)
    if args.candidates:
        print("\n".join(validator.candidate_lines()))
    status = "FAILED" if report.errors else "PASSED"
    print("RESULT %s: %d error(s), %d warning(s)" % (status, len(report.errors), len(report.warnings)))
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
