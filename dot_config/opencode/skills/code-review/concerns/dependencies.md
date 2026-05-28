# Dependency Review

Use this concern when the change adds, removes, upgrades, vendors, or newly relies on a dependency.

## Triggers

- new package, crate, library, plugin, tool, binary, or service
- dependency version changes or feature flags
- vendored source or generated code
- duplicated functionality that may already exist in the project or standard library
- license, platform, supply-chain, or maintenance implications
- lockfile, checksums, vendored code, build-time tools, generated artifacts, or package-manager features changed
- dependency source, provenance, release signing, or maintainer activity is unclear

## Questions

- Is the dependency necessary, or is existing project functionality sufficient?
- Is the dependency maintained and compatible with project policy?
- Does it affect binary size, startup time, build time, target platforms, or licenses?
- Are transitive dependencies or optional features understood?
- Is the dependency used in a narrow, replaceable way?
- Is the dependency pinned or locked reproducibly, including build and CI tools when relevant?
- Are known vulnerabilities, licenses, transitive dependencies, abandoned packages, and update cadence checked?
- Is an SBOM, vulnerability alert, or dependency update workflow expected for this project?
- Is the vulnerability actually reachable or relevant, or only present in an unused transitive path?

## Prefer

- existing project helpers or standard library when adequate
- small and well-maintained dependencies for real needs
- documenting rationale when the dependency carries cost or policy risk
- least-privilege package-manager and CI permissions for dependency retrieval and release

## Avoid overcorrection

Do not reject every dependency by default. Judge cost against the concrete problem and project norms.
