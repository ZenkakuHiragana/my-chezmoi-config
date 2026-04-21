---
name: general-prerequisites
description: Pre-flight prerequisite check before implementation work. Surfaces unstated assumptions about scope (hobby vs production), security (CIA + LLM-specific risks), cost, legal/compliance, data model durability, and performance before you write code. Use when starting a new project/repo, adding a feature to unfamiliar code, reviewing vibe-coded output, or when the user asks to "build X" without an operational context. Triggers include "start a new project", "build a production app", "vibe code", "set up a new repo", and pre-implementation sanity checks. Distilled from the comment discussion on 伊勢川暁's Qiita article about amateur vibe coders.
---

# General Prerequisites

A pre-flight prerequisite check that runs before implementation work. Distilled from the comment thread on [伊勢川暁's Qiita article](https://qiita.com/Akira-Isegawa/items/00f23d206c504db2ac3b) "A 20-Year Engineer's Message to Amateur Vibe Coders."

The job of this skill is to surface **unstated prerequisites** before you start writing code. It is not an exhaustive audit. The author of the source article tested passing his full checklist to an LLM and found the run-to-run variance dwarfed any benefit — long lists do not make LLMs safer. Pick the one or two checks that matter for *this* task.

## When to use

- Starting a new project, greenfield repo, or unfamiliar codebase
- User asks to "build X" without specifying operational scope
- User mentions deploying, shipping, or exposing anything to external users
- Task touches secrets, authentication, user data, file uploads, payments, or PII
- Cost-sensitive workloads (LLM loops, cloud APIs, database scans)
- Reviewing code that was vibe-coded without prior context

## The first question

> **Is this for play, or for work?**

Commenter `hiro949` drew the line here: making apps for fun and making apps that real users depend on are different sports. Every check below hinges on this answer.

If the user has not made it obvious, **ask** before writing non-trivial code:

> "Before I start — is this going to be deployed or used by other people, or is it a local experiment? The answer changes the security and cost tradeoffs I'll optimize for."

One short clarification reshapes the rest of the checklist.

## The seven categories

Treat these as prompts for thinking, not a form to fill out. For any given task, two or three of them are load-bearing and the rest are noise.

### 1. Security — the CIA triad

Commenter `koupoke` compressed the entire source article into one phrase: **ensure CIA — Confidentiality, Integrity, Availability.** Use CIA as the frame.

- **Secrets never in code.** Environment variables only. Never commit `.env`, `credentials.json`, `*.pem`, `*.key`, `*.p12`.
- **Authentication ≠ Authorization.** Logging in is not the same as being allowed to access a resource. Verify ownership on the server on every request. IDOR is still the most common real-world web vulnerability.
- **Input validation is server-side.** Browser validation is UX, not security. Re-validate every field on the server, even if the frontend already checked it.
- **File uploads: verify three things.** Extension, MIME type, and magic bytes. Anything less is spoofable.
- **SQL: parameterized queries, always.** String concatenation into SQL is the one vulnerability you should never ship.

### 2. LLM-specific risks (from `yamazombie`)

If the app calls an LLM or an LLM-powered service, three questions the article undersells:

- **Data path.** Where does the user's input travel? Through which provider, in which region, under whose terms of service? For corporate/internal data, does the path cross a boundary it shouldn't?
- **Training / monitoring opt-out.** Is input and output excluded from the provider's training, human review, and retention? For most consumer-grade APIs the default is **not** opt-out — you have to ask for it.
- **Prompt injection & tool poisoning.** If the LLM reads untrusted content (web pages, user docs, scraped data) or can invoke tools, assume an attacker will hijack it. Treat all LLM input as potentially hostile.

### 3. Cost

Cloud and LLM bills compound silently. The author warns of "LLM API loops costing thousands overnight."

- **Estimate before you loop.** calls per run × runs per day × price per call. Write the number down. If it is greater than your coffee budget, stop and reconsider.
- **Set a hard spending cap** on the cloud/API account before running anything in the background.
- **Never leave a polling loop without a kill switch.**

### 4. Legal / compliance

- **Scraping.** Does the target site allow it? Check robots.txt and ToS.
- **Personal data.** GDPR, Japan's APPI, CCPA, and local equivalents apply from the first real user.
- **Licenses.** GPL compatibility, attribution requirements, commercial-use restrictions on dependencies and models.
- **Regulated sectors.** Medical, financial, legal, and educational domains have rules that must be verified *before* writing code, not after.

### 5. Data model durability

Schemas outlive code. A sloppy migration hurts for years.

- Name entities and relationships explicitly before the first table.
- Identify transaction boundaries — what must commit atomically?
- Write down the recovery story: how do we roll back bad data?
- Indexes planned before production, not after the first slow query.

### 6. Performance realism

- Estimate the biggest table at 1 year and 3 years of growth.
- Hunt for N+1 patterns during implementation, not during incident response.
- Know which queries need an index before production traffic hits them.

### 7. Stand on predecessors

- Check if a mature library already solves this.
- Read the postmortem of the last team that hit this problem.
- Copy proven patterns before inventing new ones.

## How to apply this skill

1. Answer "hobby or work?" — **ask the user if unclear.** Do not guess.
2. Pick the 1–3 categories that are load-bearing for *this* task. Skip the rest explicitly.
3. Surface any unstated assumption to the user **before** writing code, not after.
4. If the user says "it's just a prototype," proceed with lower rigor — but record that fact so you do not silently carry prototype-grade code into production later.

## Anti-patterns (from the author's own replies)

- **Do not pass this whole skill to another LLM as context.** The author tested this: variance between runs dominated any measurable improvement. Long security checklists do not make LLMs safer; they make LLMs slower and more inconsistent.
- **Do not trust hype.** A new model's benchmark scores are not evidence that it fits your problem. Verify on your own data.
- **Do not skip fundamentals because the model is strong.** You still need to understand what the code does to catch when it is wrong. OS and protocol work is rare, but the fundamentals still apply.
- **Do not get "drunk on CLI tools"** (`externvoid`). The ease of generating code is not the same as the code being correct.

## Reality check

`hiroakin66` made the uncomfortable point that the people who most need this checklist are the ones who will never read it. They are too busy vibe coding. your job is to be the safety net those users do not know they need — by surfacing prerequisites *before* the user has to ask.

## Source

- Article: [20年戦士エンジニアから、素人バイブコーダーの皆様へ](https://qiita.com/Akira-Isegawa/items/00f23d206c504db2ac3b) — 伊勢川暁 (Akira Isegawa)
- This skill is primarily based on the **comment thread** underneath that article, where readers (`yamazombie`, `hideki`, `koupoke`, `hiro949`, `hiroakin66`, `externvoid`, `morima`, `tky529`, `syomu_ojisan`, `yonah53530`) and the author himself added, sharpened, or qualified the original six rules.
