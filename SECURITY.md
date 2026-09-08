from pathlib import Path

security_md = """# Security Policy

Security is taken seriously in Tetra Launcher. If you discover a vulnerability, please report it responsibly so it can be investigated and fixed before details are made public.

## Supported Versions

Security fixes are focused on the latest official release of Tetra Launcher.

| Version / Channel | Supported |
| --- | --- |
| Latest stable release | ✅ |
| `main` branch | ✅ Reports accepted; development code may be unstable |
| Older releases | ❌ |
| Unofficial forks, repackaged builds, or third-party distributions | ❌ |

Users should update to the latest official release before reporting an issue that may already have been fixed.

## Reporting a Vulnerability

**Do not open a public GitHub issue, discussion, pull request, or other public report containing vulnerability details or proof-of-concept code.**

The preferred reporting method is **GitHub Private Vulnerability Reporting**:

[Report a vulnerability privately](https://github.com/HellboundGlory/dayz-launcher/security/advisories/new)

If private vulnerability reporting is unavailable, open a normal GitHub issue **without including any sensitive technical details** and request a private contact method.

Please include as much of the following as possible:

- A clear description of the vulnerability and its potential impact.
- The affected Tetra Launcher version, release, or commit.
- Your operating system and relevant environment details.
- Steps required to reproduce the issue.
- A minimal proof of concept, if appropriate.
- Relevant logs, screenshots, crash output, or network traces with sensitive information removed.
- Whether exploitation requires user interaction.
- Whether the issue can be triggered remotely or by attacker-controlled data.
- Any known mitigations or suggested fixes.
- Whether you have already disclosed the issue anywhere else.

For launcher-specific issues, it is especially useful to mention whether the vulnerability involves:

- DayZ server data or server responses.
- Steam or Steam Workshop metadata.
- Mod installation, verification, paths, or launch arguments.
- `dzsa://` or other protocol/deep-link handling.
- Tauri commands, IPC, capabilities, shell access, or process execution.
- The React/WebView frontend.
- Update metadata, update packages, signatures, or the update process.
- Local configuration, cache, favourites, recently played data, or other stored data.
- Discord Rich Presence or external application integration.

## What Is Considered a Security Vulnerability?

Examples of issues that are generally considered in scope include:

- Remote code execution.
- Command, argument, or shell injection.
- Arbitrary file read, write, deletion, or path traversal.
- Privilege escalation.
- Unsafe Tauri IPC or command exposure that allows frontend content to perform unintended privileged actions.
- Cross-site scripting or markup/script injection that can cross the WebView-to-native trust boundary.
- Malicious server or Workshop data causing unintended code execution or privileged native actions.
- Protocol-handler or deep-link injection.
- Unsafe construction of Steam, DayZ, or other process launch arguments.
- Update mechanism vulnerabilities, including signature-verification bypasses, malicious update substitution, or unsafe downgrade behavior.
- Server-side request forgery or unintended access to local/internal resources caused by attacker-controlled input.
- Exposure of sensitive local files, credentials, tokens, or private user data.
- Security-sensitive race conditions or temporary-file vulnerabilities.
- Dependency vulnerabilities that are reachable and demonstrably exploitable through Tetra Launcher.
- Bypasses of security controls intended to separate untrusted remote content from native application capabilities.

This list is not exhaustive. If an issue has a realistic security impact, it is worth reporting privately.

## Out of Scope

The following are generally not considered vulnerabilities in Tetra Launcher unless the launcher introduces or materially worsens the security impact:

- Vulnerabilities solely in DayZ, Steam, Steam Workshop, Discord, the operating system, system WebView, or another third-party service.
- Bugs affecting unsupported or significantly outdated Tetra Launcher releases when the issue is fixed in the current release.
- Vulnerabilities that exist only in unofficial forks, repackaged binaries, or modified builds.
- Social engineering, phishing, or impersonation attacks that do not exploit the launcher.
- Reports based only on automated scanner output without a demonstrated security impact.
- Dependency CVEs without evidence that the vulnerable code path is reachable or exploitable in Tetra Launcher.
- Self-XSS or similar issues that require the victim to deliberately execute attacker-provided code through developer tools.
- Cosmetic UI issues or ordinary application bugs with no meaningful confidentiality, integrity, or security impact.
- Publicly available DayZ server information being displayed as designed.
- Denial-of-service reports that require unrealistic amounts of traffic or local resource exhaustion and do not cross a meaningful security boundary.
- Physical access attacks against a machine that is already fully compromised.
- Issues that require an attacker to already have equivalent or greater privileges than the vulnerability would provide.

If you are unsure whether something is in scope, report it privately.

## Handling of Security Reports

The maintainer will aim to:

1. Acknowledge a valid security report within **72 hours**.
2. Perform an initial assessment and severity evaluation as soon as reasonably possible.
3. Keep the reporter informed when there are meaningful updates.
4. Develop and test a fix appropriate to the severity and complexity of the vulnerability.
5. Coordinate public disclosure after a fix or mitigation is available where practical.

Response and remediation times may vary depending on severity, complexity, maintainer availability, and whether third-party components are involved.

Please allow a reasonable amount of time for investigation and remediation before publicly disclosing a vulnerability.

## Coordinated Disclosure

Please keep vulnerability details confidential until the issue has been resolved or a disclosure timeline has been agreed upon.

Once a fix is available, the project may publish a GitHub Security Advisory, release notes, or other notice describing the issue and affected versions.

Researchers who report vulnerabilities responsibly may be credited in the advisory or release notes if they wish to be identified.

## Safe Harbor

Security research conducted in good faith is welcome.

The project considers research to be in good faith when you:

- Avoid accessing, modifying, deleting, or retaining other people's data.
- Test against systems, accounts, servers, and data you own or have explicit permission to use.
- Avoid disrupting services or degrading availability for other users.
- Use the minimum level of access necessary to demonstrate the vulnerability.
- Stop testing and report the issue if you encounter sensitive user data or gain unintended access beyond what is necessary to demonstrate the problem.
- Do not use a vulnerability for personal gain, extortion, persistence, or lateral movement.
- Give the project a reasonable opportunity to investigate and remediate the issue before public disclosure.
- Comply with applicable laws.

Good-faith security research that follows this policy will not be treated as malicious activity by the project.

## Security Recommendations for Users

To reduce risk:

- Download Tetra Launcher only from the official website or the project's official GitHub releases.
- Keep Tetra Launcher updated to the latest stable release.
- Avoid third-party repackaged or modified binaries unless you trust and have verified their source.
- Treat unexpected protocol links, server links, mod links, and externally supplied configuration as potentially untrusted.
- Report suspicious launcher behaviour through the security reporting process above.

Official project:

- Website: https://tetralauncher.com
- Repository: https://github.com/HellboundGlory/dayz-launcher

## Non-Security Bugs

Crashes, incorrect server information, mod-management problems, UI bugs, compatibility issues, and other defects without a security impact should be reported through the normal GitHub issue tracker.

Thank you for helping keep Tetra Launcher and its users safe.
"""
