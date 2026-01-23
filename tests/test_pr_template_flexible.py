"""
Tests for Flexible PR Template Population
==========================================

Tests that the template manager can handle various template formats,
not just the specific Auto-Claude template format.
"""

import json
import tempfile
from pathlib import Path

import pytest

from apps.backend.core.pr_template_manager import PRTemplateManager


@pytest.fixture
def temp_project():
    """Create temporary project directory."""
    with tempfile.TemporaryDirectory() as tmpdir:
        project_dir = Path(tmpdir)
        yield project_dir


@pytest.fixture
def spec_data(temp_project):
    """Create spec directory with test data."""
    spec_path = temp_project / ".auto-claude" / "specs" / "001-test"
    spec_path.mkdir(parents=True)

    # spec.md
    spec_md = spec_path / "spec.md"
    spec_md.write_text(
        """# Test Feature

This is a test feature that demonstrates template population.
It includes multiple lines of description.

## Details

More information here.
""",
        encoding="utf-8",
    )

    # implementation_plan.json
    plan = {
        "workflow_type": "feature",
        "phases": [{"name": "backend", "subtasks": []}],
        "metadata": {"githubIssueNumber": 42},
    }

    plan_file = spec_path / "implementation_plan.json"
    plan_file.write_text(json.dumps(plan, indent=2), encoding="utf-8")

    return spec_path


def test_simple_template_format(temp_project, spec_data):
    """Test with simple template format (like user's example)."""
    github_dir = temp_project / ".github"
    github_dir.mkdir()

    # Simpler template format
    template = """Description

  What was done: A short explanation of the modifications made in this PR.
  Why it was done: The reasoning behind the changes.

Checklist

  - [ ] Tests have been added/updated.
  - [ ] Documentation has been updated.

Related Issues

Link to any related issue tickets.

Additional Notes

Any other information that may be helpful.
"""

    template_path = github_dir / "PULL_REQUEST_TEMPLATE.md"
    template_path.write_text(template, encoding="utf-8")

    manager = PRTemplateManager(temp_project)
    populated = manager.populate_template(template_path, spec_data)

    # Check that description was filled in "What was done:"
    assert "test feature" in populated.lower()
    # Check that issue reference was added
    assert "#42" in populated


def test_markdown_header_variations(temp_project, spec_data):
    """Test templates with different header formats."""
    github_dir = temp_project / ".github"
    github_dir.mkdir()

    # Template with single # headers
    template = """# Description

Put your description here.

# Related Issue

Closes #

# Type

- [ ] Bug fix
- [ ] Feature
"""

    template_path = github_dir / "PULL_REQUEST_TEMPLATE.md"
    template_path.write_text(template, encoding="utf-8")

    manager = PRTemplateManager(temp_project)
    populated = manager.populate_template(template_path, spec_data)

    # Check description filled
    assert "test feature" in populated.lower()
    # Check issue filled
    assert "Closes #42" in populated
    # Check feature checkbox marked
    assert "- [x] Feature" in populated


def test_case_insensitive_matching(temp_project, spec_data):
    """Test that matching is case-insensitive."""
    github_dir = temp_project / ".github"
    github_dir.mkdir()

    template = """## DESCRIPTION

Your description goes here.

## RELATED ISSUES

Fixes #

## TYPE OF CHANGE

- [ ] feature
- [ ] bug fix
"""

    template_path = github_dir / "PULL_REQUEST_TEMPLATE.md"
    template_path.write_text(template, encoding="utf-8")

    manager = PRTemplateManager(temp_project)
    populated = manager.populate_template(template_path, spec_data)

    # Check case-insensitive matching worked
    assert "test feature" in populated.lower()
    assert "#42" in populated
    assert "- [x] feature" in populated or "- [x] Feature" in populated


def test_plain_text_checkboxes(temp_project, spec_data):
    """Test templates without emoji checkboxes."""
    github_dir = temp_project / ".github"
    github_dir.mkdir()

    template = """## Type

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
- [ ] Refactor
"""

    template_path = github_dir / "PULL_REQUEST_TEMPLATE.md"
    template_path.write_text(template, encoding="utf-8")

    manager = PRTemplateManager(temp_project)
    populated = manager.populate_template(template_path, spec_data)

    # Should mark "New feature"
    assert "- [x] New feature" in populated


def test_bug_fix_template(temp_project):
    """Test template population for bug fix."""
    spec_path = temp_project / ".auto-claude" / "specs" / "002-fix"
    spec_path.mkdir(parents=True)

    spec_md = spec_path / "spec.md"
    spec_md.write_text(
        """# Fix Authentication Bug

This fixes a critical authentication bug that caused login failures.
""",
        encoding="utf-8",
    )

    plan = {
        "workflow_type": "bug_fix",
        "phases": [],
        "metadata": {"githubIssueNumber": 123},
    }

    plan_file = spec_path / "implementation_plan.json"
    plan_file.write_text(json.dumps(plan, indent=2), encoding="utf-8")

    github_dir = temp_project / ".github"
    github_dir.mkdir()

    template = """## Type

- [ ] Bug fix
- [ ] Feature

## Related Issue

Fixes #
"""

    template_path = github_dir / "PULL_REQUEST_TEMPLATE.md"
    template_path.write_text(template, encoding="utf-8")

    manager = PRTemplateManager(temp_project)
    populated = manager.populate_template(template_path, spec_path)

    # Should mark bug fix
    assert "- [x] Bug fix" in populated
    # Should fill issue (accepts either "Fixes" or "Closes")
    assert ("Fixes #123" in populated or "Closes #123" in populated)


def test_multiple_description_formats(temp_project, spec_data):
    """Test that multiple description format patterns work."""
    github_dir = temp_project / ".github"
    github_dir.mkdir()

    # Template with both commented and plain description
    template = """## Description

<!-- What does this PR do? -->

## What Changed

Details here.
"""

    template_path = github_dir / "PULL_REQUEST_TEMPLATE.md"
    template_path.write_text(template, encoding="utf-8")

    manager = PRTemplateManager(temp_project)
    populated = manager.populate_template(template_path, spec_data)

    # Description should be filled somewhere
    assert "test feature" in populated.lower()


def test_related_issues_section(temp_project, spec_data):
    """Test 'Related Issues' section (plural)."""
    github_dir = temp_project / ".github"
    github_dir.mkdir()

    template = """## Related Issues

Link any related issues here.
"""

    template_path = github_dir / "PULL_REQUEST_TEMPLATE.md"
    template_path.write_text(template, encoding="utf-8")

    manager = PRTemplateManager(temp_project)
    populated = manager.populate_template(template_path, spec_data)

    # Should add "Closes #42"
    assert "Closes #42" in populated or "#42" in populated
