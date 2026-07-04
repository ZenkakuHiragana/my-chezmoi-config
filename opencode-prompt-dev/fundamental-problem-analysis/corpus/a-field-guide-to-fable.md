# A Field Guide to Fable: Finding Your Unknowns

Working with Claude Fable 5 keeps re-teaching me an old lesson: the map is not the territory.
The map, a representation of the work to be done, is my prompts and skills and context, it’s what I give Claude. The territory is where the work needs to happen, the codebase, the real world, its actual constraints.

![Gap between the map and the territory, that's your unknowns](a-field-guide-to-fable-fig1.jpg)

The difference between the map and the territory is what I call unknowns. When Claude runs into an unknown, it needs to make a decision based on its best guess of what I want. The more work being done, the more unknowns Claude might run into

Fable is the first model where I find the quality of the work is bottlenecked by my ability to clarify its unknowns.

Importantly, just planning ahead isn’t always enough. You can find unknowns deep in implementation, or your unknowns may point you to the fact that you should actually be solving the problem in a different way altogether.

I’ve found that working with Fable is an iterative process of discovering my unknowns before, during, and after implementation.

I've made some

[example artifacts for finding unknowns here,](https://thariqs.github.io/html-effectiveness/unknowns/)

but be sure to come back to build the intuition for when to use them.

## Knowing your unknowns

What are your unknowns? When I come to Claude with a problem I tend to break it down in 4 ways:

- Known Knowns: This is essentially what is in my prompt. What do I tell the agent that I want?
- Known Unknowns: What haven't I figured out yet, but I’m aware that I haven’t?
- Unknown Knowns: What's so obvious I’d never write it down, but would recognize it if I saw it?
- Unknown Unknowns: What haven't I considered at all? What knowledge am I not aware of? Do I know how good something can be?

![The Four Unknowns: 1. Known knowns) what's in your prompt, what you tell the agent you want; 2. Known unknowns) questions you know to ask, what you haven't figured out yet -- and know it; 3. Unknown knowns) "I'll know it when I see it", too obvious to write down, but you'd recognize it; 4. Unknown unknowns) what you never considered, the pothole you didn't know the road could have.](a-field-guide-to-fable-fig2.jpg)

The best agentic coders are good have relatively few unknowns. Watching someone like [Boris](https://www.linkedin.com/in/bcherny) or [Jarred](https://www.linkedin.com/in/jarred-sumner-a8772425) prompt, it is obvious to me that they know what they want in-detail. They are deeply in-sync with both the codebase and the model behaviors.

But they also assume unknowns. In many ways, reducing and planning for your unknowns is the **skill** of agentic coding. But luckily, this is a skill you can improve at, by working with Claude.

## Help Claude help you

![Metaphor of the tip of the iceberg; before a small tip of the iceberg could be seen, meaning the agent only knows little things. After finding your unknowns, the tip will become bigger.](a-field-guide-to-fable-fig3.jpg)

Instructing Claude is a delicate balance. If you are too specific, Claude will follow your instructions even when a pivot may be more appropriate. If you are too vague, Claude will often make choices and assumptions based on industry best practices that may not be a fit for your task.

When you don’t account for your unknowns you fail both ways. You don't know when the path will be filled with obstacles and you don’t know when the path will be clear, but you still want Claude to veer.

Claude can help you discover your unknowns faster. It can search through your codebase and the internet extremely quickly and it knows much more about the average topic than you. It can also iterate from failure faster.

The most important part of this process is to give Claude context about your starting point. For example, tell it where you are in your thought process; disclose your experience with the problem and codebase; and let it work with you like a thought partner.

I've previously written about using HTML with Claude, in almost all of these cases, a HTML artifact is the best way to visualize and represent it.

In this article I detail some of the patterns I use to uncover these unknowns. I don't use every technique each time, but it's a useful collection of techniques to have.

![Before implementation: blind spot pass, brainstorms & brototypes, interviews, references, implementation plan; During implementation: implementation notes e.g. log deviations, keep going; After implementation: pitches & explainers, quizzes -- merge only when you pass; what you learn becomes the map for next time.](a-field-guide-to-fable-fig4.jpg)

## Pre-implementation

### Blind Spot Pass

When starting work, one of the most useful things you can do is understand your blindspots. For example, if you’re writing a feature in a new part of the codebase or using Claude to help you with unfamiliar work like iterating on a design, you’re likely to have a lot of unknown unknowns.

You may not know what questions to ask, what good looks like, what historical work has been done or what potholes to avoid.

To do this, you can ask Claude to help you find your unknown unknowns and explain them to you. I like to use the literal words “blindspot pass” and “unknown unknowns”. Giving it context on who you are and what you know is usually important for

Example Prompts:

- “I'm working on adding a new auth provider but I know nothing about the auth modules in this codebase. Can you do a blindspot pass to help me figure out my relevant unknown unknowns and help me prompt you better.”
- “I don’t know what color grading is but I need to grade this video. Can you teach me to understand my unknown unknowns about color grading, so that I can prompt better?”

### Brainstorms and prototypes

When I’m working in an area with a lot of unknown knowns, involving criteria I only know to define when I see it, I like to ask Claude to brainstorm and prototype with me.

It’s extremely valuable to identify and verbalize unknown knowns early during prototyping, because finding them out during implementation can be (relatively) expensive. Small changes in a feature or spec can cause drastically different implementations in code and it can be more difficult for your agent to revert previous changes.

For example, you may just want to see how a button added to a frame looks without having to wire up a backend route or maintaining additional state in the frontend.

Visual design is something that for me is difficult to articulate, but I know what I want when I see it. In these cases, I’ll ask for several design approaches to an artifact.

I also start almost every coding session with an exploration or brainstorming phase. This helps me start with intent to define the project’s scope. Claude often finds high-value approaches I would have missed and sometimes misses the forest through the trees. Brainstorming prevents me from setting too narrow or too wide a scope.

Example prompts:

- "I want a dashboard for this data but I have no visual taste and don't know what's possible. Make me an HTML page with 4 wildly different design directions so I can react to them.”
- “Before wiring anything up, make a single HTML file mocking the new editor toolbar with fake data. I want to react to the layout before you touch the treal app."
- "Here's my rough problem: users churn after onboarding. Search the codebase and brainstorm 10 places we could intervene, from cheapest to most ambitious. I'll tell you which ones resonate."

### Interviews

Once I’ve done sufficient brainstorming, I likely still have unknowns.

In this case, I ask Claude to interview me about any unknowns or ambiguities. When asking Claude to interview you, try and give it context about your problem to guide its questions. Here are some examples.

Example prompts:

- "Interview me one question at a time about anything ambiguous, prioritize questions where my answer would change the architecture."

### References

Sometimes you can’t describe what you want in detail. For example, you might not have the language or it might be so complicated that it would take you quite a while.

In this case, the best answer is a reference. While you can include diagrams, documentation or pictures, the absolute best reference is source code.

If you have a library that implements something in a certain way or a design component you really like, just point Fable at the folder and tell it what to look for, even if it’s in a different language.

This is also the way Claude Design works. You don't have to hand it a file (although you can do that too). You can point it at a module on a website you like, and it reads the underlying code, not just the screenshot. This provides much richer detail around the markup, structure, and how the component is actually built.

Example prompts:

- This Rust crate in vendor/rate-limiter implements the exact backoff behavior I want. Read it and reimplement the same semantics in our TypeScript API client.

### Implementation Plans

When I think I’m ready to implement, I tend to ask Claude to put together an implementation plan for me to review that focuses on the parts that might be most likely to change, for example to review data models, type interfaces or UX flows. This allows Claude to surface things I might actually need to alter.

Example Prompts:

- Write an implementation plan in HTML, but lead with the decisions I'm most likely to tweak with: data model changes, new type interfaces, and anything user-facing. Bury the mechanical refactoring at the bottom, I trust you on that part."

## During implementation

### Implementation notes

Once I am satisfied with my plan, I make a new session and pass any artifacts to the prompt. For example, I might pass in a spec file and a prototype and ask an agent to implement it.

But the truth is that no matter how much planning you do, there are always unknown unknowns lurking. The agent may find during its work that it needs to take a different tack due to an edge case it found in the code.

I ask Claude Code to keep a temporary ‘implementation-notes.md’ (or .html) file where it keeps track of decisions it makes so we can learn from our next attempt.

Example prompts:

- "Keep an implementation-notes.md file. If you hit an edge case that forces you to deviate from the plan, pick the conservative option, log it under 'Deviations', and keep going."

## Post implementation

### Pitches and explainers

![A flowchart that explains: three individual items (prototype, spec, and notes) are merged into one doc leading with the demo, then people (users or actors? the figure itself doesn't explain who, there're just human icons) buy-in. Reviewers start with the same unknowns you did -- answer them up front](a-field-guide-to-fable-fig5.jpg)

One of the most important parts of shipping something is getting buy-in and approvals.  Building pitch and explainer artifacts in the final document helps:

- Accelerate understanding when reviewers start with the same unknowns you did
- Accelerate approvals when experts want to see you accounted for the unknowns and common failure points they would have anticipated

Example prompts:

- "Package the prototype, the spec, and the implementation notes into a single doc I can drop in Slack to get buy-in. Lead with the demo GIF."

## Quizzes

After a long working session, Claude might have accomplished a lot more than I realized. Reading the code diffs can only give me a light understanding of what happened, since much of the behavior will depend on existing code paths.

Asking Claude to quiz me about the change after giving me a bunch of context helps me understand what happens. I only merge after I pass the quiz perfectly.

Example prompts:

- “I want to make sure I understand everything that's happened in this change. Give me a HTML report on the changes for me to read and understand with context, intuition, what was done, etc. and a quiz at the bottom on the changes that I must pass.”

## How this comes together: launching Fable

The [launch video for Fable](https://x.com/ClaudeDevs/status/2064399512664526853) was edited entirely by Claude Code. This was a new domain for me and I’m by no means an expert.

> Claude Fable 5 changed how we work on the Claude Code team day to day. We used to verify that Claude did the work right. Now we verify that it's doing the right work.
Here’s the 3 biggest changes:
> 1. Treat Claude like a real thought partner (not just a coder). Don’t jump straight to implementation.
     • Give it your half-baked idea early.
     • Ask it to interview you about the spec before writing code.
     • Ask it to brainstorm directions and even make quick HTML mockups.
     • Give it context, not just rules. Example: Instead of “keep it simple,” say: “This is an experiment — we might delete it in a month, so don’t build anything painful to throw away.”
> 2. Use the new /goal + Workflows (this is the magic). These are the two brand-new Claude Code commands they’re using daily:
     • /goal → Tells Claude “keep working until this is fully done.” (Not /goals — it’s singular /goal)
     • Workflows → Makes Claude parallelize tasks and verify its own work (no more babysitting every step). (Not /workflows — just say “use a workflow” or “Workflows” in your prompt.) Copy-paste example prompt: “Set a goal to implement the spec fully, then use a workflow to verify each part of the plan, and prepare a report on what was implemented and if anything differed.”
> 3. Be way more ambitious. Fable 5 is so good that the team is now asking it to do things they previously assumed LLMs couldn’t handle (they literally edited this entire video with it). If you used to think “LLMs can’t do X,” try X anyway.

Bottom line: Stop micromanaging small chunks and double-checking output. Start giving high-level direction, goals, and verification tools — then let Fable run.

The era of “verify the work” → “verify the right work” is here.

So I started with what I did know. I knew that Claude could use code to edit videos and transcribe them, but I wasn’t sure if it was accurate enough. I then asked Claude to explain to me how transcription like Whisper worked, and whether I would be able to accurately cut out things like ums or large pauses using ffmpeg.

I wanted Claude to create a UI that was timed with the words I was saying, but wasn’t sure if it would be able to so I asked Claude to create a prototype video using Remotion and a transcription to see if it would work.

Finally, the video itself looked a bit muted, which I knew was the result of color grading but I didn’t really know what color grading was. My first pass attempt was to try and get Claude to do a few variations to pick, but I realized that I didn’t know what “good” looked like when it came to color grading. So instead, I asked Claude to teach me about color grading to discover my unknowns.

You can watch a more **in-depth explanation on that [here](https://x.com/trq212/status/2064826394589442448).**

> Lots of people asked how I used Fable to edit its own launch video so I made a video about that!
> TLDR it wrote a lot of code &  tool calls to use transcription services, ffmpeg, do colorgrading, use the figma mcp, make remotion UI and render it. 
> I didn't touch a video editor.

> A video is attached, here is the summary (by Grok)
>
> ### 全体の流れと主張のポイント
>
> -   主張の核心: 「AI（特にClaude Fable）を思考パートナーとして扱い、明確な目標と検証方法を与え、野心的（ambitious）に使えば、専門的なクリエイティブ作業（ここでは動画編集）を人間がほとんど触れずに完了できる」というデモ。従来の「AIが出したものを人間が検証」から「AIに正しいことをやらせて検証する」フェーズへの移行を示している。
> -   人間の役割: 初期プロンプトで方向性を与える、好みを伝える、デザインチームのフィードバックを橋渡しする程度。細かい作業は全部AI。
>
> ### 詳細ステップ（動画+デッキに基づく）原材料: 17テイク（4シーン）、Sony S-Log3の4K RAW（約25GB）。各シーンに複数テイクあり（Introはリショット含む）。
>
> 1.  Step 01: 転写（Transcription）  
>     一つの大きなプロンプトでスタート。Eleven LabsやWhisper（ローカルM4 Max）で全テイクを単語単位でタイムスタンプ付き転写。Claudeがフォルダを処理してJSON出力。
> 2.  Step 02-03: ベストテイク選択 → EDL作成 → 初回カット
>     -   サブエージェントが各シーンごとにベストテイクを選択（umsが少ない、脚本通り、クリーンな終わり方など）。理由もJSONに記述（selection\_rationale）。
>     -   例: IntroはC003（またはリショット）、Thought PartnerはC010など。
>     -   出力: final-edit.json（シーンごとのクリップ、in/outポイント、理由）。
>     -   ffmpegでJSONを実行して初回動画生成（約2:50に圧縮）。Claudeが自らのカットを再転写して「umsゼロ」を検証。
> 3.  Step 04: カラーグレーディング  
>     S-Log3（フラットなLOG映像）を手書きの.cube LUT（7種類）でグレーディング。Claudeに「mutedすぎるから例を作って」とプロンプト → 選択。最終はneutral\_cool\_desat系。プリセットなしでゼロから記述。
> 4.  Step 05: グラフィックス/アニメーション（Remotion）
>     -   デザイナーの静的PNG（11フレーム: カード+オーバーレイ）を入力。
>     -   ClaudeがこれをReact/JSX（Remotion）コンポーネントに変換。すべてのテキスト・色・タイミングをパラメータ化。
>     -   グローバルタイミングファイル（anim.tsx）で「snappierに」など一括調整可能。
>     -   転写の単語タイムスタンプをgrepして、オーバーレイを発言のビートに同期（例: 「right」という単語のフレームにグラフィック着地）。
>     -   結果: 手作業なしで滑らかなアニメーション。
> 5.  Step 06-08: デザインチーム連携（Figma MCP）
>     -   RemotionコンポーネントをFigmaファイルにエクスポート（MCP使用）。デザイナーがスライダーで調整可能。
>     -   フィードバックをプロンプト化してClaudeに戻し、コードを更新 → 再レンダリング。
>     -   Before/Afterの比較デモあり（カードデザインの微調整）。
> 6.  Step 09: 最終レンダリング  
>     4K 24fps、4334フレーム。Claudeがstill-by-stillで自ら検証してからフルレンダー。朝6:24完了、653MB。
>
> ### その他のポイント（動画で強調）
>
> -   コスト/時間: 詳細は動画内で触れていないが、デッキに「一晩で〜10回再レンダー」「4日間（6/6-9）」などの数字あり。トークン量は視聴者質問でよく聞かれている。
> -   限界の言及: 色グレーディングは「OKだけどプロの目で見ると完璧じゃない」（コメントで指摘あり）。ドメイン知識が必要な部分はまだ人間の監督が重要。
> -   メタ: この解説動画自体も（一部）Claude生成のデッキを使っている。ツールがツールについて語る自己言及的な内容。

## Matching the Map and Territory

The better models get, the more you can achieve with the right approach. When a long-horizon task comes back wrong, it's likely you need to spend more time defining your unknowns or creating an implementation plan that allows for Claude to improvise through them.

Every explainer, brainstorm, interview, prototype, and reference is a cheap way to find out what you didn't know before it gets expensive to fix.

So start your next project by asking Claude to help you find your unknowns.
