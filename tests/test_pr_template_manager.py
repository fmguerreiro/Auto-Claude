"""
Tests for PR Template Manager
==============================

Tests template discovery, parsing, and population for GitHub, GitLab, etc.
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
def github_template(temp_project):
    """Create GitHub PR template."""
    github_dir = temp_project / ".github"
    github_dir.mkdir()

    template = """## Base Branch

- [ ] This PR targets the `develop` branch (required for all feature/fix PRs)
- [ ] This PR targets `main` (hotfix only - maintainers)

## Description

<!-- What does this PR do? 2-3 sentences -->

## Related Issue

Closes #

## Type of Change

- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] 📚 Documentation
- [ ] ♻️ Refactor
- [ ] 🧪 Test

## Area

- [ ] Frontend
- [ ] Backend
- [ ] Fullstack

## Checklist

- [ ] I've synced with `develop` branch
- [ ] I've tested my changes locally
"""

    template_path = github_dir / "PULL_REQUEST_TEMPLATE.md"
    template_path.write_text(template, encoding="utf-8")

    return template_path


@pytest.fixture
def gitlab_template(temp_project):
    """Create GitLab MR template."""
    gitlab_dir = temp_project / ".gitlab" / "merge_request_templates"
    gitlab_dir.mkdir(parents=True)

    template = """## Description

<!-- What does this MR do? -->

## Related Issue

Closes #

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Documentation
"""

    template_path = gitlab_dir / "Default.md"
    template_path.write_text(template, encoding="utf-8")

    return template_path


@pytest.fixture
def spec_dir(temp_project):
    """Create spec directory with test data."""
    spec_path = temp_project / ".auto-claude" / "specs" / "001-test-feature"
    spec_path.mkdir(parents=True)

    # spec.md
    spec_md = spec_path / "spec.md"
    spec_md.write_text(
        """# Add User Authentication

This feature adds OAuth authentication with Google and GitHub providers.
Includes secure token storage and refresh logic.

## Overview

Details about the implementation...
""",
        encoding="utf-8",
    )

    # implementation_plan.json
    plan = {
        "workflow_type": "feature",
        "phases": [
            {"name": "backend", "subtasks": []},
            {"name": "frontend", "subtasks": []},
        ],
        "metadata": {"githubIssueNumber": 42},
    }

    plan_file = spec_path / "implementation_plan.json"
    plan_file.write_text(json.dumps(plan, indent=2), encoding="utf-8")

    return spec_path


def test_platform_detection_github(temp_project, github_template):
    """Test GitHub platform detection."""
    manager = PRTemplateManager(temp_project)
    assert manager.platform == "github"


def test_platform_detection_gitlab(temp_project, gitlab_template):
    """Test GitLab platform detection."""
    manager = PRTemplateManager(temp_project)
    assert manager.platform == "gitlab"


def test_template_discovery_github(temp_project, github_template):
    """Test finding GitHub PR template."""
    manager = PRTemplateManager(temp_project)
    found = manager.find_template()
    assert found == github_template


def test_template_discovery_gitlab(temp_project, gitlab_template):
    """Test finding GitLab MR template."""
    manager = PRTemplateManager(temp_project)
    found = manager.find_template()
    assert found == gitlab_template


def test_spec_data_extraction(temp_project, spec_dir):
    """Test extracting data from spec files."""
    manager = PRTemplateManager(temp_project)
    data = manager._extract_spec_data(spec_dir)

    assert "OAuth authentication" in data["description"]
    assert data["type"] == "feature"
    assert data["area"] == "Fullstack"
    assert data["issue_number"] == 42


def test_template_population(temp_project, github_template, spec_dir):
    """Test populating GitHub template with spec data."""
    manager = PRTemplateManager(temp_project)
    populated = manager.populate_template(github_template, spec_dir)

    # Check description filled in
    assert "OAuth authentication" in populated

    # Check issue number filled in
    assert "Closes #42" in populated

    # Check type checkbox marked
    assert "- [x] ✨ New feature" in populated

    # Check area checkbox marked
    assert "- [x] Fullstack" in populated


def test_generate_pr_body_with_template(temp_project, github_template, spec_dir):
    """Test PR body generation with template."""
    manager = PRTemplateManager(temp_project)
    body = manager.generate_pr_body("001-test-feature", spec_dir)

    assert "OAuth authentication" in body
    assert "Closes #42" in body
    assert "- [x] ✨ New feature" in body


def test_generate_pr_body_without_template(temp_project, spec_dir):
    """Test PR body generation without template (fallback)."""
    manager = PRTemplateManager(temp_project)
    body = manager.generate_pr_body("001-test-feature", spec_dir)

    assert "OAuth authentication" in body
    assert "Closes #42" in body


def test_generate_pr_title(temp_project, spec_dir):
    """Test PR title generation."""
    manager = PRTemplateManager(temp_project)
    title = manager.generate_pr_title("001-test-feature", spec_dir)

    assert title == "feat: Add User Authentication"


def test_generate_pr_title_bug_fix(temp_project):
    """Test PR title generation for bug fix."""
    spec_path = temp_project / ".auto-claude" / "specs" / "002-fix-auth"
    spec_path.mkdir(parents=True)

    spec_md = spec_path / "spec.md"
    spec_md.write_text(
        """# Fix login error

Fix authentication bug causing 500 errors.
""",
        encoding="utf-8",
    )

    manager = PRTemplateManager(temp_project)
    title = manager.generate_pr_title("002-fix-auth", spec_path)

    assert title == "fix: Fix login error"


def test_type_detection_from_content(temp_project):
    """Test detecting PR type from spec content."""
    spec_path = temp_project / ".auto-claude" / "specs" / "003-refactor"
    spec_path.mkdir(parents=True)

    spec_md = spec_path / "spec.md"
    spec_md.write_text(
        """# Refactor authentication module

Refactor and clean up the auth code for better maintainability.
""",
        encoding="utf-8",
    )

    manager = PRTemplateManager(temp_project)
    data = manager._extract_spec_data(spec_path)

    assert data["type"] == "refactor"


def test_area_detection_from_phases(temp_project):
    """Test detecting area from implementation phases."""
    spec_path = temp_project / ".auto-claude" / "specs" / "004-backend-only"
    spec_path.mkdir(parents=True)

    spec_md = spec_path / "spec.md"
    spec_md.write_text("# Backend API changes\n\nAdd new endpoints.", encoding="utf-8")

    plan = {
        "workflow_type": "feature",
        "phases": [{"name": "backend-api", "subtasks": []}],
    }

    plan_file = spec_path / "implementation_plan.json"
    plan_file.write_text(json.dumps(plan, indent=2), encoding="utf-8")

    manager = PRTemplateManager(temp_project)
    data = manager._extract_spec_data(spec_path)

    assert data["area"] == "Backend"


def test_fallback_for_missing_spec(temp_project):
    """Test fallback when spec files don't exist."""
    nonexistent = temp_project / ".auto-claude" / "specs" / "999-missing"

    manager = PRTemplateManager(temp_project)
    body = manager.generate_pr_body("999-missing", nonexistent)

    assert "Auto-generated PR" in body


def test_platform_unknown_without_indicators(temp_project):
    """Test platform detection when no indicators present."""
    manager = PRTemplateManager(temp_project)
    assert manager.platform == "unknown"
