"""
Tests for Configurable Branch Prefix
=====================================

Tests that the BRANCH_PREFIX environment variable correctly controls
branch naming in the WorktreeManager.
"""

import os
import tempfile
from pathlib import Path
from unittest import mock

import pytest

from apps.backend.core.worktree import WorktreeManager


@pytest.fixture
def temp_git_repo():
    """Create a temporary git repository."""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_dir = Path(tmpdir)

        # Initialize git repo
        os.system(f"cd {repo_dir} && git init && git config user.name 'Test' && git config user.email 'test@example.com'")

        # Create initial commit
        readme = repo_dir / "README.md"
        readme.write_text("# Test Repo", encoding="utf-8")
        os.system(f"cd {repo_dir} && git add README.md && git commit -m 'Initial commit'")

        yield repo_dir


def test_default_branch_prefix(temp_git_repo):
    """Test default branch prefix is 'auto-claude'."""
    manager = WorktreeManager(temp_git_repo)

    branch_name = manager.get_branch_name("001-test-feature")
    assert branch_name == "auto-claude/001-test-feature"


def test_custom_branch_prefix(temp_git_repo):
    """Test custom branch prefix from environment variable."""
    with mock.patch.dict(os.environ, {"BRANCH_PREFIX": "feature"}):
        manager = WorktreeManager(temp_git_repo)

        branch_name = manager.get_branch_name("001-test-feature")
        assert branch_name == "feature/001-test-feature"


def test_empty_branch_prefix(temp_git_repo):
    """Test empty branch prefix (no namespace)."""
    with mock.patch.dict(os.environ, {"BRANCH_PREFIX": ""}):
        manager = WorktreeManager(temp_git_repo)

        branch_name = manager.get_branch_name("001-test-feature")
        assert branch_name == "001-test-feature"


def test_branch_prefix_with_numbers(temp_git_repo):
    """Test branch prefix with numbers."""
    with mock.patch.dict(os.environ, {"BRANCH_PREFIX": "task"}):
        manager = WorktreeManager(temp_git_repo)

        branch_name = manager.get_branch_name("115-add-skip-link")
        assert branch_name == "task/115-add-skip-link"


def test_namespace_conflict_detection_default_prefix(temp_git_repo):
    """Test namespace conflict detection with default prefix."""
    # Create a conflicting branch named 'auto-claude'
    os.system(f"cd {temp_git_repo} && git checkout -b auto-claude")
    os.system(f"cd {temp_git_repo} && git checkout main")

    manager = WorktreeManager(temp_git_repo)
    conflict = manager._check_branch_namespace_conflict()

    assert conflict == "auto-claude"


def test_namespace_conflict_detection_custom_prefix(temp_git_repo):
    """Test namespace conflict detection with custom prefix."""
    # Create a conflicting branch named 'feature'
    os.system(f"cd {temp_git_repo} && git checkout -b feature")
    os.system(f"cd {temp_git_repo} && git checkout main")

    with mock.patch.dict(os.environ, {"BRANCH_PREFIX": "feature"}):
        manager = WorktreeManager(temp_git_repo)
        conflict = manager._check_branch_namespace_conflict()

        assert conflict == "feature"


def test_no_namespace_conflict_with_empty_prefix(temp_git_repo):
    """Test no namespace conflict check when prefix is empty."""
    # Create a branch (doesn't matter what name)
    os.system(f"cd {temp_git_repo} && git checkout -b some-branch")
    os.system(f"cd {temp_git_repo} && git checkout main")

    with mock.patch.dict(os.environ, {"BRANCH_PREFIX": ""}):
        manager = WorktreeManager(temp_git_repo)
        conflict = manager._check_branch_namespace_conflict()

        # No conflict because we're not using a namespace
        assert conflict is None


def test_branch_prefix_persists_across_instances(temp_git_repo):
    """Test that branch prefix is read consistently."""
    with mock.patch.dict(os.environ, {"BRANCH_PREFIX": "spec"}):
        manager1 = WorktreeManager(temp_git_repo)
        manager2 = WorktreeManager(temp_git_repo)

        assert manager1.get_branch_name("001-test") == "spec/001-test"
        assert manager2.get_branch_name("001-test") == "spec/001-test"


def test_branch_prefix_special_characters(temp_git_repo):
    """Test branch prefix with hyphens and underscores."""
    with mock.patch.dict(os.environ, {"BRANCH_PREFIX": "auto-claude_v2"}):
        manager = WorktreeManager(temp_git_repo)

        branch_name = manager.get_branch_name("001-test")
        assert branch_name == "auto-claude_v2/001-test"


def test_branch_prefix_in_manager_attributes(temp_git_repo):
    """Test that branch_prefix is stored as instance attribute."""
    with mock.patch.dict(os.environ, {"BRANCH_PREFIX": "feature"}):
        manager = WorktreeManager(temp_git_repo)

        assert hasattr(manager, "branch_prefix")
        assert manager.branch_prefix == "feature"


def test_branch_prefix_default_without_env_var(temp_git_repo):
    """Test default when BRANCH_PREFIX is not set."""
    # Ensure BRANCH_PREFIX is not in environment
    env = os.environ.copy()
    if "BRANCH_PREFIX" in env:
        del env["BRANCH_PREFIX"]

    with mock.patch.dict(os.environ, env, clear=True):
        manager = WorktreeManager(temp_git_repo)

        assert manager.branch_prefix == "auto-claude"
        assert manager.get_branch_name("001-test") == "auto-claude/001-test"
