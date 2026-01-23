"""
PR/MR Template Manager
======================

Platform-agnostic PR/MR template discovery, parsing, and population.

Supports:
- GitHub (.github/PULL_REQUEST_TEMPLATE.md)
- GitLab (.gitlab/merge_request_templates/*.md)
- Bitbucket (similar to GitHub)
- Generic markdown templates

Auto-fills sections with data from spec files and git history.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass


class PRTemplateManager:
    """Discovers and populates PR/MR templates across different platforms."""

    # Template locations by platform
    TEMPLATE_PATTERNS = {
        "github": [
            ".github/PULL_REQUEST_TEMPLATE.md",
            ".github/pull_request_template.md",
            ".github/PULL_REQUEST_TEMPLATE/*.md",
            "docs/PULL_REQUEST_TEMPLATE.md",
            "PULL_REQUEST_TEMPLATE.md",
        ],
        "gitlab": [
            ".gitlab/merge_request_templates/*.md",
            ".gitlab/merge_request_templates/Default.md",
        ],
        "bitbucket": [
            ".bitbucket/PULL_REQUEST_TEMPLATE.md",
            "PULL_REQUEST_TEMPLATE.md",
        ],
    }

    def __init__(self, project_dir: Path):
        self.project_dir = project_dir
        self.platform = self._detect_platform()

    def _detect_platform(self) -> str:
        """Detect git platform from remote URL."""
        try:
            result = subprocess.run(
                ["git", "remote", "get-url", "origin"],
                cwd=self.project_dir,
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0:
                remote = result.stdout.strip().lower()
                if "github.com" in remote:
                    return "github"
                elif "gitlab" in remote:
                    return "gitlab"
                elif "bitbucket" in remote:
                    return "bitbucket"
        except Exception:
            pass

        # Fallback: check for platform-specific directories
        if (self.project_dir / ".github").exists():
            return "github"
        elif (self.project_dir / ".gitlab").exists():
            return "gitlab"
        elif (self.project_dir / ".bitbucket").exists():
            return "bitbucket"

        return "unknown"

    def find_template(self) -> Path | None:
        """Find PR/MR template file."""
        patterns = self.TEMPLATE_PATTERNS.get(self.platform, [])

        # Add generic patterns
        patterns.extend(self.TEMPLATE_PATTERNS.get("github", []))

        for pattern in patterns:
            # Handle glob patterns
            if "*" in pattern:
                pattern_path = self.project_dir / pattern.replace("*", "")
                parent = pattern_path.parent
                if parent.exists():
                    # Find first .md file
                    for md_file in parent.glob("*.md"):
                        return md_file
            else:
                template_path = self.project_dir / pattern
                if template_path.exists():
                    return template_path

        return None

    def _extract_spec_data(self, spec_dir: Path) -> dict:
        """Extract data from spec files for template population."""
        data = {
            "description": "",
            "type": "feature",
            "area": "unknown",
            "files_changed": [],
            "breaking": False,
            "issue_number": None,
        }

        # Read spec.md
        spec_md = spec_dir / "spec.md"
        if spec_md.exists():
            try:
                content = spec_md.read_text(encoding="utf-8")
                # Extract overview/description (first paragraph after title)
                lines = content.split("\n")
                desc_lines = []
                found_content = False

                for line in lines:
                    if line.startswith("# "):
                        continue
                    if line.strip() and not line.startswith("#"):
                        found_content = True
                    if found_content:
                        if line.startswith("## ") and desc_lines:
                            break
                        desc_lines.append(line)
                        if len(desc_lines) >= 5:  # First 5 lines of description
                            break

                data["description"] = "\n".join(desc_lines).strip()

                # Detect type from content (as fallback)
                lower_content = content.lower()
                if any(
                    word in lower_content for word in ["fix", "bug", "issue", "error"]
                ):
                    data["type"] = "fix"
                elif any(word in lower_content for word in ["refactor", "clean"]):
                    data["type"] = "refactor"
                elif any(word in lower_content for word in ["docs", "documentation"]):
                    data["type"] = "docs"
                # Don't check for "test" in content - too generic

            except Exception:
                pass

        # Read implementation_plan.json for more details
        # This takes PRIORITY over content-based detection
        plan_file = spec_dir / "implementation_plan.json"
        if plan_file.exists():
            try:
                plan = json.loads(plan_file.read_text(encoding="utf-8"))

                # Get workflow type (overrides content-based detection)
                workflow = plan.get("workflow_type", "feature")
                if workflow in ["bug_fix", "bug"]:
                    data["type"] = "fix"
                elif workflow == "refactor":
                    data["type"] = "refactor"
                elif workflow == "feature":
                    data["type"] = "feature"
                elif workflow == "test":
                    data["type"] = "test"

                # Detect area from phases
                phases = plan.get("phases", [])
                areas = set()
                for phase in phases:
                    phase_name = phase.get("name", "").lower()
                    if "frontend" in phase_name or "ui" in phase_name:
                        areas.add("Frontend")
                    if "backend" in phase_name or "api" in phase_name:
                        areas.add("Backend")
                    if "database" in phase_name or "db" in phase_name:
                        areas.add("Backend")

                if len(areas) > 1:
                    data["area"] = "Fullstack"
                elif areas:
                    data["area"] = list(areas)[0]

                # Check for GitHub issue
                metadata = plan.get("metadata", {})
                if metadata.get("githubIssueNumber"):
                    data["issue_number"] = metadata["githubIssueNumber"]

            except Exception:
                pass

        # Read requirements.json for issue reference
        req_file = spec_dir / "requirements.json"
        if req_file.exists():
            try:
                req = json.loads(req_file.read_text(encoding="utf-8"))
                if req.get("github_issue") and not data["issue_number"]:
                    data["issue_number"] = req["github_issue"]
            except Exception:
                pass

        return data

    def populate_template(self, template_path: Path, spec_dir: Path) -> str:
        """Populate template with spec data."""
        try:
            template = template_path.read_text(encoding="utf-8")
        except Exception:
            return "Auto-generated PR from Auto-Claude build."

        # Extract spec data
        data = self._extract_spec_data(spec_dir)

        # Replace common placeholders
        populated = template

        # Fill in description section (flexible matching)
        # Matches:
        # - ## Description\n<!-- ... -->\n
        # - # Description\n
        # - Description\n (with various indentation)
        if data["description"]:
            # Pattern 1: Markdown headers - replace content between header and next section
            # Fixed lookahead: stop at next header (## ), not at newline+header (\n## )
            desc_pattern1 = r"(#{1,3}\s*Description\s*\n)(?:<!--.*?-->\s*\n)?(.*?)(?=#{1,3}\s|\Z)"
            if re.search(desc_pattern1, populated, re.DOTALL | re.IGNORECASE):
                populated = re.sub(
                    desc_pattern1,
                    rf"\1\n{data['description']}\n\n",
                    populated,
                    flags=re.DOTALL | re.IGNORECASE,
                )

            # Pattern 2: "What was done:" style - replace just the value
            desc_pattern2 = r"(What was done:\s*)([^\n]*)"
            if re.search(desc_pattern2, populated, re.IGNORECASE):
                populated = re.sub(
                    desc_pattern2,
                    rf"\1{data['description']}",
                    populated,
                    flags=re.IGNORECASE,
                )

        # Fill in Related Issue section (flexible matching)
        # Matches:
        # - Closes #
        # - Fixes #
        # - Related Issues
        # - Link to any related issue
        if data["issue_number"]:
            # Pattern 1: "Closes #" or "Fixes #" on its own line
            if re.search(r"(Closes|Fixes) #(\s*)$", populated, re.MULTILINE | re.IGNORECASE):
                populated = re.sub(
                    r"(Closes|Fixes) #(\s*)$",
                    rf"\1 #{data['issue_number']}\2",
                    populated,
                    flags=re.MULTILINE | re.IGNORECASE,
                )

            # Pattern 2: "Related Issues" header with placeholder text
            # Fixed lookahead: stop at next header (## ), not at newline+header (\n## )
            related_pattern = r"(#{1,3}\s*Related Issues?\s*\n)(?:<!--.*?-->\s*\n)?(.*?)(?=#{1,3}\s|\Z)"
            if re.search(related_pattern, populated, re.DOTALL | re.IGNORECASE):
                populated = re.sub(
                    related_pattern,
                    rf"\1\nCloses #{data['issue_number']}\n\n",
                    populated,
                    flags=re.DOTALL | re.IGNORECASE,
                )

            # Pattern 3: "Link to any related issue" placeholder text
            populated = re.sub(
                r"Link to any related issue.*?(?=\n\n|\Z)",
                rf"Closes #{data['issue_number']}",
                populated,
                flags=re.DOTALL | re.IGNORECASE,
            )

        # Check type of change checkboxes (flexible matching)
        # Matches both emoji-style and plain text checkboxes
        type_patterns = {
            "fix": [r"bug\s*fix", r"bugfix", r"fix"],
            "feature": [r"new\s*feature", r"feature", r"enhancement"],
            "docs": [r"documentation", r"docs"],
            "refactor": [r"refactor(?:ing)?"],
            "test": [r"test(?:ing)?"],
        }

        detected_type = data.get("type", "feature")
        patterns = type_patterns.get(detected_type, type_patterns["feature"])

        # Try to match and replace checkboxes
        for pattern in patterns:
            # Match checkbox with pattern (case-insensitive)
            # Captures the full checkbox line and replaces [ ] with [x]
            checkbox_pattern = rf"(- \[) \] ([^\n]*{pattern}[^\n]*)"
            if re.search(checkbox_pattern, populated, re.IGNORECASE):
                populated = re.sub(
                    checkbox_pattern,
                    r"\1x] \2",
                    populated,
                    flags=re.IGNORECASE,
                    count=1,  # Only mark first match
                )
                break  # Stop after first successful match

        # Check area checkboxes (flexible matching)
        if data["area"] in ["Frontend", "Backend", "Fullstack"]:
            area_pattern = rf"(- \[) \] ([^\n]*{data['area']}[^\n]*)"
            populated = re.sub(
                area_pattern,
                r"\1x] \2",
                populated,
                flags=re.IGNORECASE,
                count=1,
            )

        return populated

    def generate_pr_body(self, spec_name: str, spec_dir: Path) -> str:
        """
        Generate PR body - use template if available, otherwise create simple summary.

        Args:
            spec_name: Spec identifier (e.g., "001-add-feature")
            spec_dir: Path to spec directory

        Returns:
            PR body text (populated template or simple summary)
        """
        # Try to find and populate template
        template_path = self.find_template()
        if template_path:
            return self.populate_template(template_path, spec_dir)

        # Fallback: generate simple summary
        data = self._extract_spec_data(spec_dir)

        if data["description"]:
            body = f"{data['description']}\n\n"
        else:
            body = f"Auto-generated PR for {spec_name}\n\n"

        if data["issue_number"]:
            body += f"Closes #{data['issue_number']}\n"

        return body.strip()

    def generate_pr_title(self, spec_name: str, spec_dir: Path) -> str:
        """
        Generate PR title from spec data.

        Args:
            spec_name: Spec identifier (e.g., "001-add-feature")
            spec_dir: Path to spec directory

        Returns:
            PR title (without "auto-claude:" prefix)
        """
        data = self._extract_spec_data(spec_dir)

        # Try to extract title from spec.md
        spec_md = spec_dir / "spec.md"
        if spec_md.exists():
            try:
                content = spec_md.read_text(encoding="utf-8")
                # Get first H1 heading
                for line in content.split("\n"):
                    if line.startswith("# "):
                        title = line[2:].strip()
                        # Add conventional commit prefix
                        type_prefix = "feat"
                        if data["type"] == "fix":
                            type_prefix = "fix"
                        elif data["type"] == "refactor":
                            type_prefix = "refactor"
                        elif data["type"] == "docs":
                            type_prefix = "docs"
                        elif data["type"] == "test":
                            type_prefix = "test"

                        return f"{type_prefix}: {title}"
            except Exception:
                pass

        # Fallback: convert spec name to readable title
        # "001-add-feature" -> "feat: Add feature"
        parts = spec_name.split("-", 1)
        if len(parts) == 2:
            readable = parts[1].replace("-", " ").replace("_", " ").title()
            type_prefix = "feat" if data["type"] == "feature" else data["type"]
            return f"{type_prefix}: {readable}"

        return f"feat: {spec_name}"
