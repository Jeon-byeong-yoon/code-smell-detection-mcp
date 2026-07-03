import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class MainRouteTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

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


if __name__ == "__main__":
    unittest.main()
