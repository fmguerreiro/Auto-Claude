# PR Template Support

Auto-Claude automatically discovers and populates PR/MR templates when creating pull requests.

## Supported Platforms

| Platform | Template Location | Detection Method |
|----------|-------------------|------------------|
| **GitHub** | `.github/PULL_REQUEST_TEMPLATE.md` | Git remote URL or `.github/` directory |
| **GitLab** | `.gitlab/merge_request_templates/*.md` | Git remote URL or `.gitlab/` directory |
| **Bitbucket** | `.bitbucket/PULL_REQUEST_TEMPLATE.md` | Git remote URL or `.bitbucket/` directory |

## How It Works

### 1. Platform Detection

Auto-Claude detects your platform by:
1. Checking git remote URL (`github.com`, `gitlab.com`, etc.)
2. Falling back to checking for platform-specific directories

### 2. Template Discovery

Searches for templates in platform-specific locations:
- **GitHub**: `.github/PULL_REQUEST_TEMPLATE.md` or `.github/PULL_REQUEST_TEMPLATE/*.md`
- **GitLab**: `.gitlab/merge_request_templates/*.md` or `Default.md`
- **Bitbucket**: `.bitbucket/PULL_REQUEST_TEMPLATE.md`

### 3. Data Extraction

Extracts data from spec files:
- **Description**: From `spec.md` (first paragraph after title)
- **Type**: Auto-detected from content (bug fix, feature, refactor, docs, test)
- **Area**: Detected from implementation phases (Frontend, Backend, Fullstack)
- **Issue Number**: From `implementation_plan.json` or `requirements.json`

### 4. Template Population

Automatically fills in template sections:
- **Description**: Spec overview
- **Related Issue**: `Closes #<number>`
- **Type checkboxes**: Marks the detected type (✨ Feature, 🐛 Bug fix, etc.)
- **Area checkboxes**: Marks Frontend, Backend, or Fullstack

## Example

### Your Template (`.github/PULL_REQUEST_TEMPLATE.md`)

```markdown
## Description

<!-- What does this PR do? -->

## Related Issue

Closes #

## Type of Change

- [ ] 🐛 Bug fix
- [ ] ✨ New feature
- [ ] 📚 Documentation

## Area

- [ ] Frontend
- [ ] Backend
- [ ] Fullstack
```

### Your Spec (`spec.md`)

```markdown
# Add User Authentication

This feature adds OAuth authentication with Google and GitHub providers.
Includes secure token storage and refresh logic.
```

### Auto-Populated PR Body

```markdown
## Description

This feature adds OAuth authentication with Google and GitHub providers.
Includes secure token storage and refresh logic.

## Related Issue

Closes #42

## Type of Change

- [ ] 🐛 Bug fix
- [x] ✨ New feature
- [ ] 📚 Documentation

## Area

- [ ] Frontend
- [ ] Backend
- [x] Fullstack
```

## PR Title Generation

Auto-Claude generates conventional commit titles:

| Spec Title | Generated PR Title |
|------------|-------------------|
| "Add User Authentication" | `feat: Add User Authentication` |
| "Fix login error" | `fix: Fix login error` |
| "Refactor auth module" | `refactor: Refactor auth module` |

The type prefix is auto-detected from:
1. Spec content keywords (fix, bug, refactor, etc.)
2. `workflow_type` in `implementation_plan.json`

## Fallback Behavior

If no template is found, Auto-Claude generates a simple PR body:
- Description from `spec.md`
- Issue reference if available
- Clean, minimal format

## Customization

### Custom Template Sections

Auto-Claude uses pattern matching to fill common sections:
- `## Description` - Filled with spec overview
- `Closes #` or `Fixes #` - Filled with issue number
- Type checkboxes - Marks detected type
- Area checkboxes - Marks detected area

Your template can include any additional sections, and they'll be preserved.

### Multiple Templates

If you have multiple PR templates (e.g., `feature.md`, `bugfix.md`), place them in:
- **GitHub**: `.github/PULL_REQUEST_TEMPLATE/` directory
- **GitLab**: `.gitlab/merge_request_templates/` directory

Auto-Claude will use the first one found (typically `Default.md` or alphabetically first).

## Testing

Run the PR template tests:

```bash
pytest tests/test_pr_template_manager.py -v
```

Tests cover:
- Platform detection
- Template discovery
- Data extraction
- Template population
- Fallback behavior

## Implementation Details

**Core Module**: `apps/backend/core/pr_template_manager.py`

Key classes:
- `PRTemplateManager`: Main class for template discovery and population

Integration points:
- `WorktreeManager.create_pull_request()`: Uses template manager for PR body
- `WorktreeManager._extract_spec_summary()`: Delegates to template manager

## No AI Attribution

PR titles and bodies use conventional commits format without "auto-claude:" prefix:
- ✅ `feat: Add user authentication`
- ❌ `auto-claude: 001-add-auth - Add user authentication`

This follows standard GitHub/GitLab conventions and respects user preferences for clean commit history.
