# Documents

Everything we publish about the product lives in this folder, so the repository root stays for code and configuration.

| Document | Read it to learn | Audience |
|---|---|---|
| [PRD.md](PRD.md) | The problem, the users, the requirements for the core flow, safety rules, targets, and what is not verified | Everyone, start here |
| [api/](api/README.md) | The backend: a guide with a worked example, the generated reference for every endpoint (also as OpenAPI), how the backend is built and run, and how voice works | Developers, testers, anyone calling the API |
| [SPECS.md](SPECS.md) | How the prototype is built: architecture, the dose state machine, word rules, timings, data model, tests, security | Developers, reviewers |
| [fsd/](fsd/README.md) | The functional specification: every feature in detail, with acceptance criteria, split into prototype, finale and later; includes the security between the UI and the backend | Developers, testers, reviewers |

Order of reading: PRD (what and why), then SPECS (how the prototype is built), then the FSD (what every feature must do, including what is not built yet).

Rules for this folder:
1. A document states what is built and what is not. Plans are labelled as plans.
2. Numbers in a document are constants or tests in this repository, or carry a source.
3. Internal notes, keys and personal data never go here. This folder is public.
