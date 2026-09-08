# Contributing to Tetra Launcher

Thanks for your interest in contributing to **Tetra Launcher**.

Tetra Launcher is a DayZ server browser and Steam Workshop mod manager for Windows and Linux. Contributions of all sizes are welcome — bug fixes, new features, performance improvements, UI work, documentation, testing, and code cleanup all help improve the project.

Before contributing, please read this guide along with:

* [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
* [`SECURITY.md`](SECURITY.md)
* [`LICENSE`](LICENSE)

## Ways to Contribute

You can help Tetra Launcher by:

* Fixing bugs.
* Improving Windows or Linux compatibility.
* Improving the server browser.
* Improving server filtering, favourites, or recently played behaviour.
* Improving Steam Workshop integration.
* Improving mod detection, verification, installation, or repair.
* Improving DayZ launch behaviour.
* Improving the UI or accessibility.
* Improving performance or startup time.
* Improving error handling and diagnostics.
* Adding or improving tests.
* Improving documentation.
* Reporting reproducible bugs.
* Suggesting well-defined features.
* Reviewing or testing pull requests.

You do not need to be an expert in Rust, React, Tauri, DayZ, or Steam to contribute.

## Before Starting

For small bug fixes or documentation changes, feel free to open a pull request directly.

For significant features, architectural changes, major UI redesigns, new integrations, or changes that substantially affect existing behaviour, consider opening an issue first.

This gives maintainers and contributors a chance to discuss the approach before a large amount of work is done.

Before starting:

1. Check existing issues and pull requests for similar work.
2. Make sure the change fits the purpose of Tetra Launcher.
3. Keep the scope focused where practical.
4. Avoid combining unrelated changes into the same pull request.

## Development Requirements

Tetra Launcher uses:

* **Rust**
* **Tauri v2**
* **React**
* **TypeScript**
* **Vite**
* **Node.js**

A stable Rust toolchain and a supported Node.js installation are required.

You will also need the platform dependencies required by Tauri for your operating system.

## Getting the Source

Fork the repository and clone your fork:

```bash
git clone https://github.com/YOUR_USERNAME/dayz-launcher.git
cd dayz-launcher
```

Add the upstream repository if you want to keep your fork synchronized:

```bash
git remote add upstream https://github.com/HellboundGlory/dayz-launcher.git
```

Install the frontend dependencies:

```bash
npm ci
```

## Running the Launcher During Development

Start the Tauri development environment with:

```bash
npx tauri dev
```

This runs the frontend development server together with the native Tauri application.

## Building

To produce a development build:

```bash
npm ci
npx tauri build --debug
```

**Do not use plain `cargo build` to build the launcher application.**

The application expects the frontend to be bundled through Tauri. A plain `cargo build` can resolve the development server URL instead of the bundled frontend and produce an application that attempts to connect to localhost when launched.

Use:

```bash
npx tauri build --debug
```

instead.

## Project Structure

Tetra Launcher is a Tauri application with a React frontend and a Rust backend divided into focused workspace crates.

The Rust side contains components responsible for areas such as:

* Core application behaviour.
* Networking.
* Server registry and discovery.
* Steam and Steam Workshop integration.
* DayZ launch behaviour.
* Discord Rich Presence.

The frontend is built using React, TypeScript, and Vite.

When making changes, try to keep functionality in the layer or crate that logically owns it rather than introducing unnecessary dependencies between components.

## Required Checks

Before submitting a pull request, run the same primary checks used by CI.

### Rust formatting

```bash
cargo fmt --all --check
```

To automatically format Rust code:

```bash
cargo fmt --all
```

### Rust linting

```bash
cargo clippy --workspace --all-targets -- -D warnings
```

Clippy warnings should be resolved rather than suppressed unless there is a clear reason for the suppression.

### Rust tests

```bash
cargo test --workspace
```

### TypeScript

```bash
npx tsc --noEmit
```

Where relevant, also run the frontend tests and linting:

```bash
npm test
npm run lint
```

Ideally, a pull request should not introduce new compiler warnings, lint warnings, failing tests, or TypeScript errors.

## Rust Contributions

When changing Rust code:

* Run `cargo fmt`.
* Keep Clippy clean.
* Prefer clear, idiomatic Rust over unnecessarily clever implementations.
* Handle recoverable failures with appropriate error handling instead of panicking.
* Avoid unnecessary `unwrap()` and `expect()` calls in runtime paths.
* Keep modules and crates focused on their intended responsibilities.
* Avoid unnecessary cloning or allocation in performance-sensitive paths.
* Add or update tests when behaviour can reasonably be tested.
* Document behaviour that would otherwise be surprising to future contributors.

Errors that can occur through normal user activity, network failures, malformed remote data, Steam state, missing files, or unsupported environments should generally be handled gracefully rather than crashing the launcher.

## Frontend Contributions

When changing the React/TypeScript frontend:

* Keep TypeScript type-safe.
* Avoid `any` unless there is a strong reason for it.
* Reuse existing components and patterns where appropriate.
* Keep UI state separate from native/backend logic where practical.
* Avoid duplicating backend business logic in the frontend.
* Preserve accessibility when adding interactive elements.
* Ensure layouts work at the window sizes supported by the launcher.
* Keep loading, empty, offline, and error states in mind.
* Avoid unnecessary dependencies for functionality that can reasonably use the existing stack.

Changes should fit the existing visual direction of Tetra Launcher unless the pull request is intentionally proposing a broader redesign.

## Tauri and Native Security

Tetra Launcher operates across a trust boundary between WebView content and native operating-system functionality.

Changes involving any of the following deserve extra care:

* Tauri commands.
* IPC.
* Tauri capabilities and permissions.
* Shell execution.
* Process launching.
* File-system access.
* Protocol/deep-link handling.
* Steam launch arguments.
* DayZ launch arguments.
* Update handling.
* External URLs.
* Remote server data.
* Steam Workshop metadata.

Treat externally supplied data as untrusted.

Do not build shell commands by concatenating untrusted strings.

Prefer structured process arguments and validated data wherever possible.

Do not expose additional native Tauri capabilities to the frontend unless they are genuinely required.

Security-sensitive changes may receive additional review before merging.

See [`SECURITY.md`](SECURITY.md) for vulnerability reporting.

## Windows and Linux Compatibility

Tetra Launcher supports both **Windows and Linux**.

Contributors should avoid unintentionally breaking one platform while working on the other.

Platform-specific behaviour should be isolated where practical.

For Rust code, use appropriate conditional compilation such as:

```rust
#[cfg(windows)]
```

or:

```rust
#[cfg(target_os = "linux")]
```

when functionality genuinely differs by operating system.

Where a Windows-specific feature has a Linux equivalent, preserve both implementations where practical.

Examples of platform-sensitive areas include:

* Steam installation discovery.
* File paths.
* Process launching.
* Protocol handlers.
* Application installation paths.
* Shell behaviour.
* WebView differences.
* Update/install behaviour.

If you can only test your contribution on one platform, that is fine — mention it clearly in the pull request.

## Remote Data

Tetra Launcher consumes information from sources outside the application's control, including DayZ servers and Steam/Workshop services.

Never assume remote data is safe or correctly formatted.

Code handling external information should account for:

* Missing fields.
* Invalid values.
* Unexpected encoding.
* Extremely long values.
* Invalid URLs.
* Invalid IDs.
* Network failures.
* Timeouts.
* Partial responses.
* Stale responses.
* Maliciously constructed input.

A malformed server response should not be able to crash the launcher or gain access to native application capabilities.

## Dependencies

New dependencies should have a clear benefit.

Before adding one, consider:

* Whether the functionality can reasonably be implemented with existing dependencies.
* Maintenance activity.
* Security history.
* Package size.
* Transitive dependencies.
* Platform compatibility.
* Licensing.
* Whether it significantly increases build time or application size.

Avoid adding a large dependency for a very small amount of functionality.

Do not submit dependency updates solely for the sake of changing version numbers unless there is a reason for the update, such as a security fix, compatibility improvement, bug fix, or useful upstream change.

## Tests

Bug fixes should include a regression test where practical.

New functionality should include tests for important logic where reasonably possible.

Good tests should focus on observable behaviour rather than internal implementation details.

Areas particularly valuable to test include:

* Parsing.
* Server data normalization.
* Filtering.
* Mod-state calculations.
* Workshop metadata handling.
* Path handling.
* Launch argument construction.
* Platform-specific behaviour.
* Error conditions.

Not every UI adjustment requires an automated test, but behaviour-critical logic should be tested where feasible.

## Reporting Bugs

Before opening a bug report:

1. Make sure you are using a current version of Tetra Launcher.
2. Search existing issues for the same problem.
3. Try to determine whether the problem belongs to Tetra Launcher rather than DayZ, Steam, a Workshop mod, or a particular server.

A useful bug report should include:

* Tetra Launcher version.
* Operating system and version.
* What you expected to happen.
* What actually happened.
* Steps to reproduce the issue.
* Relevant logs or error messages.
* Screenshots when useful.
* Whether the issue happens consistently.
* Any unusual Steam, DayZ, Proton, Wine, filesystem, or networking configuration that may be relevant.

Remove private or sensitive information from logs before posting them.

## Feature Requests

Feature requests are welcome.

A useful feature request explains:

* The problem being solved.
* Why the problem matters.
* How the proposed feature would improve the launcher.
* Possible alternatives.
* Whether the feature affects Windows, Linux, or both.

Try to describe the **problem first** rather than only prescribing an implementation.

There may be a better technical solution than the first proposed design.

## Pull Requests

Keep pull requests focused and reasonably easy to review.

A good pull request should explain:

* **What** changed.
* **Why** it changed.
* **How** the change works.
* How it was tested.
* Which operating systems were tested.
* Any known limitations.
* Screenshots or video for meaningful UI changes.

Where applicable, reference the related issue:

```text
Fixes #123
```

or:

```text
Closes #123
```

### Keep Pull Requests Focused

Avoid combining things such as:

* A feature implementation.
* An unrelated refactor.
* Dependency updates.
* Formatting of unrelated files.
* A large UI redesign.

into one pull request unless they genuinely need to be changed together.

Smaller focused pull requests are easier to review, test, and merge.

## Generated and Unrelated Changes

Before committing, check:

```bash
git status
git diff
```

Make sure you have not accidentally included:

* Build artifacts.
* Local configuration.
* IDE files.
* Logs.
* Temporary files.
* Credentials.
* API keys.
* Tokens.
* Machine-specific paths.
* Unrelated formatting changes.

Do not commit secrets.

If a credential or secret is accidentally committed, consider it compromised and rotate it immediately — simply deleting it in a later commit is not sufficient.

## Commit Messages

There is no requirement for perfectly formatted commit history, but commit messages should make the purpose of a change understandable.

Good examples:

```text
Fix Workshop mod detection on Linux
```

```text
Handle malformed server query responses
```

```text
Improve favourites filtering performance
```

```text
Add loading state to mod verification
```

Avoid meaningless commit messages such as:

```text
stuff
```

```text
changes
```

```text
fix
```

```text
asdf
```

Maintainers may squash commits when merging a pull request.

## Breaking Changes

Changes that alter stored configuration, public behaviour, protocol handling, update behaviour, application data, or other compatibility-sensitive functionality should be clearly identified in the pull request.

Where possible:

* Preserve existing user data.
* Migrate old configuration automatically.
* Maintain backward compatibility.
* Avoid silently resetting settings or favourites.
* Explain unavoidable breaking changes.

Users should not unexpectedly lose their local launcher data because of an application update.

## Documentation

If a change alters user-facing behaviour, installation instructions, development workflow, configuration, or architecture, update the relevant documentation in the same pull request.

Documentation-only pull requests are welcome.

## Security Vulnerabilities

**Do not report security vulnerabilities through a public GitHub issue.**

Follow the private reporting process described in:

[`SECURITY.md`](SECURITY.md)

This includes vulnerabilities involving:

* Command injection.
* Arbitrary file access.
* Tauri IPC or capability bypasses.
* Protocol handlers.
* Malicious server data.
* Workshop metadata.
* Process launch arguments.
* Update verification.
* Remote code execution.
* Sensitive information exposure.

## Code of Conduct

All contributors and participants are expected to follow:

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

Technical disagreements are welcome.

Personal attacks, harassment, and hostile behaviour are not.

## Licensing

Tetra Launcher is distributed under the terms described in [`LICENSE`](LICENSE).

By submitting a contribution, you agree that your contribution may be distributed as part of Tetra Launcher under the project's existing license.

Make sure you have the right to contribute any code, assets, documentation, or other material included in your submission.

Do not copy code or assets from projects with incompatible licensing.

## Maintainer Review

Submitting a pull request does not guarantee that it will be merged.

Maintainers may request changes or decline a contribution because of:

* Architecture.
* Maintainability.
* Security.
* Scope.
* Performance.
* UX.
* Platform compatibility.
* Project direction.
* Licensing.
* Duplication of existing functionality.

A declined pull request is not a judgement of the contributor.

Where practical, maintainers will explain significant concerns so the contribution can be improved or the reasoning remains useful to future contributors.

## Thank You

Tetra Launcher benefits from every useful bug report, tested fix, documentation improvement, feature idea, and code contribution.

Thank you for helping improve Tetra Launcher for the DayZ community.
