import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class MainRouteTest(unittest.TestCase):
    """기존 계약 테스트. allowlist를 '/'로 열어 경로 정책과 무관하게 검증한다."""

    def setUp(self):
        self.client = TestClient(app)
        env_patch = patch.dict(
            os.environ,
            {"ADVANCED_PYEXAMINE_ALLOWED_ROOTS": "/", "ADVANCED_PYEXAMINE_SHARED_SECRET": ""},
        )
        env_patch.start()
        self.addCleanup(env_patch.stop)

    def test_health_returns_ok(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ok"], True)

    def test_analyze_returns_404_for_missing_project_path(self):
        with patch("app.main.analyze_project", side_effect=FileNotFoundError("missing project")):
            response = self.client.post("/analyze", json={"projectPath": "/missing"})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "missing project")

    def test_analyze_returns_400_for_value_error(self):
        with patch("app.main.analyze_project", side_effect=ValueError("invalid detector")):
            response = self.client.post("/analyze", json={"projectPath": "fixtures/sample_project"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "invalid detector")

    def test_analyze_returns_500_for_unexpected_error(self):
        with patch("app.main.analyze_project", side_effect=RuntimeError("import failed")):
            response = self.client.post("/analyze", json={"projectPath": "fixtures/sample_project"})

        self.assertEqual(response.status_code, 500)
        self.assertIn("Failed to analyze project: import failed", response.json()["detail"])

    def test_analyze_rejects_invalid_limit_per_group(self):
        response = self.client.post(
            "/analyze",
            json={"projectPath": "fixtures/sample_project", "limitPerGroup": 0},
        )

        self.assertEqual(response.status_code, 422)


class PathAllowlistTest(unittest.TestCase):
    """projectPath 인가(allowlist) 검사."""

    def setUp(self):
        self.client = TestClient(app)
        self.allowed_root = tempfile.mkdtemp(prefix="allowed-root-")
        env_patch = patch.dict(
            os.environ,
            {
                "ADVANCED_PYEXAMINE_ALLOWED_ROOTS": self.allowed_root,
                "ADVANCED_PYEXAMINE_SHARED_SECRET": "",
            },
        )
        env_patch.start()
        self.addCleanup(env_patch.stop)

    def test_analyze_rejects_path_outside_allowed_roots(self):
        with patch("app.main.analyze_project") as analyze_mock:
            response = self.client.post("/analyze", json={"projectPath": "/etc"})

        self.assertEqual(response.status_code, 403)
        self.assertIn("outside the allowed analysis roots", response.json()["detail"])
        analyze_mock.assert_not_called()

    def test_analyze_rejects_dotdot_traversal(self):
        escaped = f"{self.allowed_root}/../{os.path.basename(tempfile.gettempdir())}"
        with patch("app.main.analyze_project") as analyze_mock:
            response = self.client.post("/analyze", json={"projectPath": escaped})

        self.assertEqual(response.status_code, 403)
        analyze_mock.assert_not_called()

    def test_analyze_rejects_prefix_confusion(self):
        with patch("app.main.analyze_project") as analyze_mock:
            response = self.client.post(
                "/analyze", json={"projectPath": f"{self.allowed_root}-evil"}
            )

        self.assertEqual(response.status_code, 403)
        analyze_mock.assert_not_called()

    def test_analyze_allows_path_under_allowed_root(self):
        target = os.path.join(self.allowed_root, "project")
        os.makedirs(target, exist_ok=True)

        with patch("app.main.analyze_project", return_value={}) as analyze_mock:
            response = self.client.post("/analyze", json={"projectPath": target})

        self.assertEqual(response.status_code, 200)
        analyze_mock.assert_called_once()
        # 핸들러에는 realpath로 정규화된 경로가 전달된다
        self.assertEqual(analyze_mock.call_args.args[0], os.path.realpath(target))

    def test_analyze_returns_403_when_no_roots_configured(self):
        with patch.dict(
            os.environ,
            {"ADVANCED_PYEXAMINE_ALLOWED_ROOTS": "", "ADVANCED_PYEXAMINE_SOURCE_DIR": ""},
        ):
            with patch("app.main.analyze_project") as analyze_mock:
                response = self.client.post("/analyze", json={"projectPath": "/tmp"})

        self.assertEqual(response.status_code, 403)
        self.assertIn("No allowed analysis roots configured", response.json()["detail"])
        analyze_mock.assert_not_called()


class SharedSecretAuthTest(unittest.TestCase):
    """공유 시크릿(X-Internal-Token) 인증 검사."""

    SECRET = "test-shared-secret"

    def setUp(self):
        self.client = TestClient(app)
        env_patch = patch.dict(
            os.environ,
            {
                "ADVANCED_PYEXAMINE_ALLOWED_ROOTS": "/",
                "ADVANCED_PYEXAMINE_SHARED_SECRET": self.SECRET,
            },
        )
        env_patch.start()
        self.addCleanup(env_patch.stop)

    def test_analyze_rejects_missing_token(self):
        with patch("app.main.analyze_project") as analyze_mock:
            response = self.client.post("/analyze", json={"projectPath": "/tmp"})

        self.assertEqual(response.status_code, 401)
        analyze_mock.assert_not_called()

    def test_analyze_rejects_wrong_token(self):
        with patch("app.main.analyze_project") as analyze_mock:
            response = self.client.post(
                "/analyze",
                json={"projectPath": "/tmp"},
                headers={"X-Internal-Token": "wrong"},
            )

        self.assertEqual(response.status_code, 401)
        analyze_mock.assert_not_called()

    def test_analyze_accepts_valid_token(self):
        with patch("app.main.analyze_project", return_value={}):
            response = self.client.post(
                "/analyze",
                json={"projectPath": "/tmp"},
                headers={"X-Internal-Token": self.SECRET},
            )

        self.assertEqual(response.status_code, 200)

    def test_health_stays_open_without_token(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
