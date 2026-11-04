# Contributing

English | [中文](CONTRIBUTING.md)

Thanks for contributing. This is a DSH community plugin, not an official DeepSeek product.

## What to contribute

- New transports (SQLite is current; HTTP is a future direction).
- New tools/CLI capabilities that preserve the 0.3 single-writer and manager model.
- Docs, examples, integration reports.
- Reproducible bugs and minimal fixes.
- Tests and protocol consistency.

## Development

- Node.js ^22.19.0 or >=24.
- DSH >=0.2.1-rc.5 <0.3.0.
- Local filesystem only (SQLite refuses NFS/CIFS/SMB/FUSE).

    git clone https://github.com/Lencen/dsh-agent-lines.git
    cd dsh-agent-lines
    npm install
    npm test

## Before a PR

    npm test
    npm pack --dry-run

Rules:

- Tests pass.
- The package has no test fixtures, temporary DBs, local paths, or credentials.
- Document compatibility when changing public APIs.
- Do not commit node_modules, *.tgz, .env, or lines.db.
- Do not post real Session content, tokens, or customer data in logs/issues.

## PR rules

1. One concern per PR.
2. Include the reproduction/verification command and result.
3. Protocol/state changes update docs/PROTOCOL.en.md and docs/ARCHITECTURE.en.md.
4. Install/upgrade changes update docs/DEPLOY.en.md.
5. Add tests for new behavior; explain any untested fix.
6. Follow CODE_OF_CONDUCT.md.

## Security

Do not open a public issue for vulnerabilities. See SECURITY.md.

## License

Contributions are Apache-2.0 (inbound = outbound).
