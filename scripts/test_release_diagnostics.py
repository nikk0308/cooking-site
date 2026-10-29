import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("diagnostic_privacy", Path(__file__).parent / "ci/check-release-diagnostics.py")
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)


class DiagnosticPrivacyTests(unittest.TestCase):
    def test_anonymous_trace_allowed_and_positive_canary_detected(self):
        with tempfile.TemporaryDirectory(prefix="culinote-privacy-check-") as directory:
            file = Path(directory) / "release-visitor-trace.zip"
            def write(value):
                with zipfile.ZipFile(file, "w") as archive:
                    archive.writestr("trace.network", json.dumps(value))
            write({"snapshot": {"request": {"url": "http://127.0.0.1:3100/api/catalog", "headers": []}}})
            self.assertEqual(privacy.check_tree(directory), 1)
            write({"snapshot": {"request": {"url": "http://127.0.0.1:3100/api/catalog", "headers": [{"name": "Authorization", "value": privacy.CANARY.decode()}]}}})
            with self.assertRaises(ValueError):
                privacy.check_tree(directory)

    def test_login_cookies_inputs_and_private_material_rejected(self):
        fixtures = [
            {"snapshot": {"request": {"url": "http://127.0.0.1:3100/api/admin/login"}}},
            {"snapshot": {"response": {"headers": [{"name": "Set-Cookie", "value": "recipes-admin=synthetic-only"}]}}},
            {"snapshot": {"request": {"headers": [{"name": "Cookie", "value": "recipes-admin=synthetic-only"}]}}},
            {"method": "fill", "params": {"selector": "input[type=password]", "value": "synthetic-only"}},
        ]
        for item in fixtures:
            with self.subTest(item=list(item)):
                with self.assertRaises(ValueError):
                    privacy.check_bytes(json.dumps(item).encode())
        with self.assertRaises(ValueError):
            privacy.check_bytes(b"AGE-SECRET-KEY-SYNTHETIC-CANARY-NOT-A-KEY")

    def test_exact_upload_scope_and_durable_checkpoint(self):
        with tempfile.TemporaryDirectory(prefix="culinote-privacy-check-") as directory:
            root = Path(directory)
            (root / "test-failed.png").write_bytes(privacy.CANARY)
            (root / "release-diagnostics.json").write_text('{"lastCompleted":"05","firstIncomplete":"06.01"}')
            self.assertEqual(privacy.check_tree(root), 1)
            (root / "release-unexpected.txt").write_text("synthetic")
            with self.assertRaises(ValueError):
                privacy.check_tree(root)


if __name__ == "__main__":
    unittest.main()
