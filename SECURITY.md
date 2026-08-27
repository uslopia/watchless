# Security Policy

## Supported versions

Watchless is pre-1.0. Only the latest release gets fixes; there is no backport
branch.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub:
[Security → Report a vulnerability](https://github.com/uslopia/watchless/security/advisories/new).

Include the Chrome version, the OS, and the smallest reproduction you have. You
should get a first reply within 7 days, and a fix or a decision within 30. You
will be credited in the advisory unless you ask otherwise.

## Threat model

Watchless runs entirely on the machine: the summary comes from Gemini Nano
through Chrome's Prompt API, and the only network traffic is the subtitle fetch
on `youtube.com`, the page you are already on. There is no server, no API key,
no telemetry, no account.

What is therefore in scope:

- Anything that makes the extension send data off the machine.
- Cross-site scripting through video metadata, transcripts, or model output
  rendered into the panel, the popup, or the summary page.
- Reading or corrupting another origin's data through the content script.
- Permission or manifest scope that is wider than the feature needs.

What is out of scope:

- Model output being wrong, biased, or unflattering. The summary and the checks
  come from a small local model; the README says so, and the rationale is shown
  next to every check for that reason.
- Anything requiring an already-compromised Chrome profile or physical access
  to an unlocked machine.
- YouTube's own behavior, and Chrome's Nano download and eviction rules.
