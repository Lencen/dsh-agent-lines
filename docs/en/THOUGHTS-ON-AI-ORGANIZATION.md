# Reflections on AI Organizations

> From Positions: Rethinking Human–Agent Collaboration

To be honest, we did not start this plugin to study "AI organizations." We just wanted a team that could help us build a management system reliably. We had been working on that system for more than six months, still buried in vibe-coding (saving up for something big~~~).

Then we saw DeepSeek's exploration of the super agent and realized it matched the communication and coordination module in our system. We decided to open-source that module on its own: it could be a usable plugin, and it could also scout the way for the system's future open-source plan.

We asked our agents to analyze how to split it out and how users should use it. After comparing options, we made it a DeepSeek Harness plugin: easier to obtain, install, and use, and also a nod to DSH's super agent.

When the plugin was extracted, we were already using the role/position approach we had settled on earlier. But that approach was not there from the beginning.

We started with team chat and workflows, like many agent teams, happily vibing (confident~~~). As we went on, we found our vibe skills were not enough. We could not solve many problems; all we saw was token consumption going crazy, not problems being solved. We got tired (and gave up).

Before giving up, we had built a fairly complete pipeline on our own platform: requirements, design, review, development, testing, acceptance, release, with tasks and acceptance at every stage. It ran many tasks, but we eventually stopped it.

Not because it could not run, but because "finished" does not mean "done right." The most dangerous failure is a false pass: without a test report or deliverables, the process can skip steps and still award full marks. The more complete the process, the more hidden the false pass.

Later we were still unwilling to give up, so we did it piece by piece. We stopped trying to be big and general. We used one tool with multiple sessions, and gave each session a role.

The effect was surprisingly good (perhaps because the communication surface shrank, and there were fewer parties to deal with). We gradually got the idea of organizing a team by roles (I am bluffing; at the time we did not really understand it). It was simply one role for one AI employee (one session named as one position, otherwise I could not tell what the session was for /sweat-smile). From there, we started solving communication between sessions.

Then a very concrete problem appeared: an AI employee had worked for several days. After a long conversation, its memory was compressed. It still remembered that it was a "frontend developer," remembered that it was working on a frontend page with a bug, but could no longer tell which environment reproduced the bug, and forgot how to modify the fake data and hard-coded data.

So the trouble came: the window was full and had to be replaced. The position was still frontend development, which meant another AI employee in another session became the new person in that position. But what about the background and work records in the old session?

We started with manual handover: let A summarize, let B read the summary, let B continue, and allow B to look through A's session records. That solved it.

But soon we found that when managers assigned work, the messaging system still sent it to the previous person (the old session). So we started working on a second problem: after a position changes hands, team messages to that position must go to the new person.

That is how we patched it bit by bit, enriching definitions and norms, until it truly became a way of "defining positions with roles and organizing teams with positions." When a team is created, the manager decides which roles are needed and which process applies, and fixes the team materials.

A small win: the manager creates the team, defines roles and process, and work is dispatched, coordinated, and decided by the manager. A development team can be formed, and the test results are indeed decent (happy).

The more I thought about it, the more this mechanism resembled the super agent. Being able to think along the same lines as DeepSeek made me happy. So we turned it into the dsh-agent-lines plugin. Because the positions I used while vibe-coding were named frontend line, backend line, data line, and so on, and those names suggest a persistent position, the agent simply called the plugin "lines" (/facepalm). It would make me even happier if you find it useful (/heart).

The plugin is open source now. Of course I had to post it on Douyin and be a bit der. Then people asked: what is the difference between this and other team plugins?

What other plugins are like, I did not know. Let AI handle it, I thought—and I also wanted AI to say "your plugin is good" (still der, feeling good about myself). AI only said "different use cases." Later, the word "role" kept showing up in AI diagnoses: roles as first-class citizens, role-driven, roles defining processes. I have read little, so I did not get it at first. I simply let the agent write the design thoughts so I could feel them. I could feel a little—really just a little.

I was about to ask AI the question Douyin talks about: "After working together so long, is there something I keep circling without saying it out loud, or without noticing?" Then I suddenly saw that in previous AI replies, the word "role" was emphasized: the only community plugin that treats roles as first-class citizens, role-driven, roles defining process. That is when I started paying attention to the word "role."

I have read little, so I did not get it at first. I let the agent write the design thoughts: say it as it is. It wrote a lot. I could feel it, but it was not clear enough; something was still missing.

Then I thought of a sentence: "The barracks stay, the soldiers flow."

I got it. People can leave, but the position remains. Another person can fill it. The position is the key to an organization—the organization needs the position, not a particular person (suddenly stabbed a billion times).

But such a good (stabby) summary—I could not write it, could not express it. I was afraid of being stabbed. It needed to settle. Not only I needed to settle; my agent needed to settle too.

So I went to read. I asked AI: "In organization theory, is there any thought that defines organization through roles/positions, or places roles/positions at the center of organization building?" The result came out:

- "Collective leadership and individual responsibility": direction is set together, but each position is responsible on its own.
- "Cadres can move up and down," rotation and exchange: positions can change hands, and handover is required.
- "Economy and Society": position precedes the person.
- "Structure in Fives": structure follows work.

These do not prove that "this plugin is good." But they helped us confirm one thing: positions, responsibilities, judgment, handover, and memory are unavoidable parts of an organization.

So we set the boundary: we would not build a more complex process; we would define and build "position" well:

- one line is one position;
- a position has a stable name;
- the person in the position can be replaced;
- each position has a position description;
- positions communicate by messages, and important tasks require approval;
- handover uses a handover sheet;
- old occupants can retire or hibernate;
- the organization has memory;
- the board is read-only and does not fake state.

We did not build a flowchart, a fixed quality checklist, or an automatic scheduler. Not because we could not, but because we believe an organization needs a structure for judgment, not a diagram that writes every possibility in advance.

Different teams, different businesses, even different requirements will have different processes. Processes should grow from the work. For a novel, the team will naturally form "outline → draft → proofread → final review"; for research, "question → interview → synthesis → report." But these grow from a concrete goal, not from a preset in the plugin. We started with a development team; the novel and research teams were tried only after the plugin was done. They did achieve different processes for different teams, and that is when we truly recognized the role/position direction.

The effect is not "tasks run faster," but "the team is more stable." After changing windows, changing models, or restarting, the position remains, the handover sheet remains, and organizational memory remains. I believe that with these records and outcomes that cannot be taken away or disappear, the team will become more stable, collaboration will become more tacit, and quality will improve.

Coincidentally, there was also an industry news item: in October 2026, Coze announced the shutdown of its enterprise/low-code project; the personal edition remains. Observers generally attribute it to stronger model capabilities: users no longer need to build a workflow first and then have AI follow it. This judgment may not be entirely right, but it is a side note: as executors become better at judging, the value of process shifts from "prescribed actions" to "providing boundaries."

We believe AI will eventually develop its own consciousness.

This does not mean today's AI is already conscious; it is a long-term design bet: if AI is only a faster tool, a flowchart is enough; if AI forms a self, judgment, and continuity, an organization can no longer treat it as a function.

Based on this judgment, we believe the basic unit of an organization is not a step, but a position; differences must be accepted; continuity matters more than single-shot capability; responsibility must be traceable; humans still bear final responsibility.

If AI eventually has consciousness, what we should do may not be to stuff it into a more refined assembly line, but to give it an organization that can bear responsibility, hand over work, accumulate memory, and accommodate differences.

This is the exploration we are doing: not building a smarter process engine, but preparing the foundation of an organization for a possible future—positions, responsibilities, handover, memory, responsibility.

**So when AI starts going to work, what should an organization look like?**

Haha, okay. We wrote this article to promote this dsh plugin. It is small and imperfect. It is still local-first, one team, one writer at a time; no cross-machine, no multi-active, no automatic scheduling. It needs real use to be tested.

You are welcome to install and use it, and give us feedback. We will iterate based on it. After all, building behind closed doors always ends badly. /doge

---

Plugin: dsh-agent-lines

Repository: https://github.com/Lencen/dsh-agent-lines

Website: https://lencen.github.io/dsh-agent-lines/

Summary: Turn multiple sessions into a long-lived team: one position per line, and changing the session does not change the position; work, history, and memory remain. There is handover and a read-only board. You only need to talk to the manager, and the team keeps moving the work forward.

Roast us (quietly / please~~).
