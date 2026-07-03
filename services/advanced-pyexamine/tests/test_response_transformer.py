import unittest

from app.response_transformer import build_response, summarize


SMELL_GROUPS = {
    "long_method": [
        {"name": "long_method", "severity": "high"},
        {"name": "long_method", "severity": "medium"},
    ],
    "data_clumps": [
        {"name": "data_clumps", "severity": "medium"},
    ],
}


class ResponseTransformerTest(unittest.TestCase):
    def test_summarize_counts_by_name_and_severity(self):
        summary = summarize(SMELL_GROUPS)

        self.assertEqual(summary["total"], 3)
        self.assertEqual(summary["byName"]["long_method"], 2)
        self.assertEqual(summary["byName"]["data_clumps"], 1)
        self.assertEqual(summary["bySeverity"]["high"], 1)
        self.assertEqual(summary["bySeverity"]["medium"], 2)

    def test_summary_only_omits_smell_groups(self):
        response = build_response(
            project_path="fixtures/sample_project",
            smell_groups=SMELL_GROUPS,
            summary_only=True,
        )

        self.assertNotIn("smellGroups", response)
        self.assertEqual(response["summary"]["total"], 3)
        self.assertEqual(response["response"]["returnedTotal"], 0)
        self.assertTrue(response["response"]["truncated"])

    def test_limit_per_group_limits_details_only(self):
        response = build_response(
            project_path="fixtures/sample_project",
            smell_groups=SMELL_GROUPS,
            limit_per_group=1,
        )

        self.assertEqual(response["summary"]["total"], 3)
        self.assertEqual(len(response["smellGroups"]["long_method"]), 1)
        self.assertEqual(len(response["smellGroups"]["data_clumps"]), 1)
        self.assertEqual(response["response"]["returnedTotal"], 2)
        self.assertEqual(response["response"]["limitPerGroup"], 1)
        self.assertTrue(response["response"]["truncated"])


if __name__ == "__main__":
    unittest.main()
