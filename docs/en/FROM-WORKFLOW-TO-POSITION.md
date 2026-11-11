# From Workflow to Position: Organizational Design for Long-Lived AI Teams

## — A Practice Report on dsh-agent-lines

> Working paper · November 2026

**Abstract:** When models, sessions, and agent instances are continually replaced, how an AI team maintains identity continuity, work handover, and accountability is an under-discussed organizational design problem. Based on the authors' design and practice in a self-built agent collaboration platform and the dsh-agent-lines plugin, this paper proposes positions, rather than workflows, as the basic organizational unit of AI teams, and derives four design principles: position before workflow, identity before instance, handover before memory, and messages addressed to positions rather than individuals. The study adopts design-based research and participatory observation. Materials include development records, platform records, tool documentation, and real-world user feedback. It is not a controlled experiment and makes no causal performance claims. Qualitative observations suggest that the design has potential to mitigate team amnesia and coordination breakdowns caused by session, model, and process changes, while improving traceability during personnel turnover. The paper further discusses the hypothesis of AI consciousness, anthropomorphic risks, organizational rigidity, and technical boundaries, and states the current system's limits.

**Keywords:** AI teams; roles and positions; organizational design; multi-agent collaboration; long-term collaboration; work handover

## 1 Introduction

Research on multi-agent systems usually focuses on task decomposition, role allocation, communication protocols, and collaboration efficiency. It seldom discusses a more basic question: when the AI instances executing work are continually replaced, how does a team continue to exist as an organization?

Most engineering practice models an AI team as a workflow: nodes are steps, edges are dependencies, and tasks flow along the edges. Workflows suit deterministic tasks, but cannot cover the large part of real work that requires judgment, negotiation, and rework. More importantly, workflows assume that the executor is stable. Once a session is compressed, a model is replaced, or a process restarts, the executor loses continuity, and the workflow itself cannot provide continuity of identity, responsibility, or accountability.

This paper asks:

**RQ1:** Under continuous replacement of models, sessions, and instances, how can an AI team maintain identity continuity, work handover, and accountability?

**RQ2:** If positions, rather than workflows, are the basic organizational unit, what minimal design is required, and what are its boundaries and risks?

The paper makes three contributions. First, it proposes the design proposition that "an organization is not a workflow but a set of positions," and decomposes positions into implementable engineering primitives. Second, it presents the design practice of dsh-agent-lines, including position identity, position descriptions, handover, replacement, retirement and hibernation, message routing, and a read-only board. Third, it discusses the conditions, limitations, and ethical risks of the design in the form of a practice report.

The paper is not a controlled experimental study and does not claim that the design has been universally validated. It is a working paper based on long-term practice, intended to articulate an emerging organizational design for further research and use.

## 2 Problem Background: Amnesia and Breakdown in Long-Lived AI Teams

The authors' initial goal was not to study AI organizations but to build an in-house management system. Development lasted more than six months, and the team consisted of multiple long-running agent sessions. The first problem to surface was not that "agents were not smart enough" but that "the team could not remember who it was."

A typical case: a session responsible for frontend development worked for several days, and its context was compressed. It still remembered that it was responsible for frontend development and that it had a bug on hand, but it could no longer determine which environment reproduced the bug, nor did it remember where the fake data and hard-coded data were, or how they should be modified.

This is not merely "memory loss." It breaks three layers at once:

1. **Identity continuity:** the team cannot confirm whether "this session is still the same frontend developer";
2. **Work continuity:** current progress, to-dos, environment conventions, and past decisions cannot be reliably transferred;
3. **Accountability continuity:** when something goes wrong, it is difficult to trace which position, which decision, or which handover caused it.

In early practice, the authors tried to solve these problems with a more complete workflow. The team built a seven-stage pipeline in its own platform: requirements, design, review, development, testing, acceptance, and release. Task packages were structured, stages were triggered by events, and acceptance gates and retries were provided. The pipeline ran many tasks, but it was eventually stopped.

The reason was not that it could not run, but that "finished" does not mean "done right." The most serious problem was false passing: when a test report or a deliverables list was missing, the process could skip the relevant step and still produce a passing result. Tasks concentrated heavily in development and testing, while requirements and design were under-covered. Continuous integration was absent, and key changes were not committed. In the end, the team retained only the pipeline's task-transition records, task descriptions, acceptance gates, and rework strategy as teaching material and a regression test set; the old polling, locks, template fallback, database schema, and keyword acceptance were not carried over.

This experience yielded the paper's first empirical judgment:

**A workflow can ensure that steps are walked through, but it cannot ensure that judgment happens; the more complete the workflow, the more hidden the false pass.**

## 3 Research Design and Practice History

The paper combines design-based research with participatory observation. The authors are both designers and developers of the system and long-term users. Materials include development records, platform records, tool documentation, version histories, and real user feedback. The study has no control group and no controlled experiment, and makes no causal performance claims. The account of practice emphasizes verifiable facts; the lessons are stated as design hypotheses.

The authors' dual role as practitioners and researchers offers long-term, fine-grained observation, but also introduces interpretive bias. Section 8 discusses this limitation.

### 3.1 Early Workflows and the Pipeline

The authors' initial path resembled that of many agent teams: starting from team chat and workflow orchestration, and trying to cover collaboration with a more complete process. Two problems soon appeared. First, token consumption rose rapidly without a proportional increase in problem solving. Second, the more complex the process, the higher the maintenance cost, and the harder it became to tell where the problem was.

The failure of the seven-stage pipeline further showed that a workflow can describe deterministic steps but cannot replace judgment at a position. The more complete the process, the easier it is to reduce "whether the work is truly done" to "whether a node has been passed."

### 3.2 Narrowing the Scope: One Tool, Multiple Sessions, One Role

After a period of giving up, the authors decided to narrow the scope. They stopped pursuing a large team across terminals, instances, and multiple agents, and first used multiple sessions within one tool, with each session defining one role.

The contraction had an unexpected effect. With a smaller communication surface and fewer participants, the team became easier to run. Each session corresponded to a clear role, boundaries between roles were clear, and the collaboration problem shifted from "how to design a complete flowchart" to "how sessions should communicate with one another."

The authors later summarized that what they gained at this stage was not a feature but a simple realization: **one role corresponds to one AI employee; one session is named as one position.** The realization was not systematic at the time and was partly accidental, but it became the foundation of later design.

### 3.3 Handover and Message Routing: Designs Forced by Problems

After roles were established, a new problem quickly appeared: sessions fill up and must be replaced. After replacement, the position is still frontend development, which means another AI employee in another session becomes the new person in that position. What then happens to the background, work records, and context in the old session?

The first handover was manual: session A summarized, session B read the summary and continued, and B was allowed to review A's session records. The problem was temporarily solved.

But then the authors found that the team's messaging system still sent work assignments to "the previous person," that is, the old session. They therefore addressed a second problem: after a position changes hands, messages sent to that position should go to the new person rather than the old session.

These two problems—handover and message routing—were not derived from theory but forced by real collaboration. They also show that a position is not "renaming a session" but a set of institutional arrangements involving identity, records, messages, and accountability.

### 3.4 Team Creation and Role Configuration

As these mechanisms stabilized, the team formed a basic way of working: a manager creates a team, defines member roles according to team roles and work goals, and dispatches, coordinates, and decides work centrally.

When creating a team, the manager determines which roles are needed and which process applies, and fixes the team materials. This way of working has a surface resemblance to DeepSeek's exploration of the super agent, but the paper does not treat it as a theoretical source; it treats it as a practical comparison: both attempt to make AI carry stable responsibilities over a longer period rather than complete a single task.

## 4 Theoretical Resources and Design Principles

### 4.1 Lessons from Chinese Organizational-Building Experience

After the practice, the authors read the Chinese Communist Party's experience in organizational building and found that some of its principles are highly relevant to the design of positions. The paper does not compare an AI team to a Party organization, nor does it transfer political-organizational logic directly to AI teams; it borrows only organizational methods.

First, **collective leadership and individual responsibility**. Direction must be set collectively, but each position must be responsible independently. In an AI team, the manager is responsible for goals, boundaries, coordination, and acceptance, and does not decide for a frontend developer how to fix a bug; the position makes judgments within its own scope.

Second, **cadres can move up and down; rotation and exchange**. Positions must be able to change hands, and handover is required. In an AI team, sessions fill up, models change, and agents make mistakes; a position must not be tied to a single session. The old occupant must be able to step down, and the new one must be able to take over.

These two principles are the direct intellectual resources for the paper's "position before person" argument.

### 4.2 Reminders from Foreign Organizational Theory

Foreign organizational theory provides another set of references.

Weber's discussion of "office" suggests that a position in an organization precedes the particular person, and that a position has rules, responsibilities, and authority; but bureaucracy, once rigid, can become an oppressive machine.

Barnard and Simon treat an organization as a cooperative and decision-making system: authority is not automatically accepted, and the organization must resolve "who judges in which position."

The contingency research of Burns and Stalker, and of Lawrence and Lorsch, suggests that there is no single correct organizational structure: mechanistic structures are more efficient in stable environments, while organic structures are more flexible in uncertain ones. AI teams face mostly uncertain work, so processes should not be frozen.

Mintzberg's view that "structure follows work" further supports the paper's position: structure should serve the actual work rather than making work accommodate structure.

### 4.3 Four Design Principles

Drawing on practice and theoretical resources, the paper summarizes four design principles.

**Principle 1: Position before workflow.** The basic unit of an organization is the position, not the step. A workflow is a result of positions collaborating around a concrete goal, not a preset premise.

**Principle 2: Identity before instance.** Position identity must be decoupled from a particular session or model instance. A session can be replaced; a position must not disappear with it.

**Principle 3: Handover before memory.** Context cannot be assumed to persist forever. Before replacement, model change, or restart, structured handover is required; handover is not an appendage of chat logs but a first-class organizational element.

**Principle 4: Messages address positions, not individuals.** The team sends work to a position, not to a particular session; after a position changes hands, messages should be routed to the new occupant.

## 5 System Design

dsh-agent-lines is a community plugin for DeepSeek Harness. Its goal is to turn the principles above into usable organizational primitives. Its minimal design includes the following.

**Positions and identity.** One line corresponds to one position, with a stable name. A session is the executor sitting in the position and can be replaced. Position identity does not depend on the context of a particular session.

**Position description.** Each position has a description stating what it is responsible for, what it delivers, what it must not touch, and when it must escalate. The description is a boundary for judgment, not an action script.

**Messages, tasks, and approval.** Positions communicate through messages; important tasks require approval; the organization keeps decision records.

**Handover.** Replacement uses structured handover recording current progress, to-dos, environment conventions, known risks, and historical decisions; handover does not depend on reading chat logs.

**Replacement, retirement, and hibernation.** A position can change executors; an old session can retire, keeping history but receiving no new work; a position can hibernate temporarily and be woken when needed.

**Organizational memory and a read-only board.** Messages, events, decisions, and history are retained; the board is read-only and shows real state rather than faking organizational health.

**Explicit non-goals.** The current system does not build flowcharts, fixed quality checklists, automatic scheduling, cross-machine operation, multi-active operation, or bidirectional writes to the official task board. These are not excuses for missing capability but design boundaries: before the problem has been validated through real use, the system should not be turned into a larger process engine.

## 6 Preliminary Observations

### 6.1 Data and Presentation

The observations come from the authors' development records, platform records, tool documentation, and real user feedback. They are qualitative observations, not a controlled experiment. The results are grouped under four themes that recurred in practice; the themes were not statistical hypotheses set in advance.

### 6.2 Observations

**Finding 1: Decoupling positions from instances maintained identity continuity.** In cases of session replacement, model replacement, or process restart, position identity and handover information were retained. After a new session connected, the team still saw the position of "frontend developer" and did not need to meet a "new agent" from scratch. This supports the principle of "identity before instance," but does not prove that every team will obtain the same effect.

**Finding 2: Structured handover helped reduce replacement cost.** The handover sheet recorded the current page, the bug's reproduction environment, the location of fake data, interface-field constraints, and the reason for the previous rejection. This information was more stable than a chat log and easier for a new occupant to use. The paper did not measure the human time before and after handover in a controlled way; "reduce" is a relative judgment from practice.

**Finding 3: Position-level message routing reduced misdelivery.** Once messages addressed positions, a change of occupant no longer caused work assignments to continue going to the old session. The team could send work to the position and have the current occupant receive and process it. This shows that message routing is part of the position institution, not merely a communication feature.

**Finding 4: The read-only board provided a minimal level of observability.** The team could see who was in which position, who had not delivered, and where work was stuck; the board did not write and did not fake state. The board itself did not solve problems, but it made organizational state discussable and contestable.

### 6.3 Boundaries of Interpretation

The observations are lessons from practice, not a causal conclusion that "using this plugin is always more efficient." There is also insufficient comparative data to show that it outperforms workflow orchestration in all teams and all tasks. More precisely, the paper offers a set of **design hypotheses and preliminary supporting cases**; transferability requires further research.

## 7 Discussion

### 7.1 The AI Consciousness Hypothesis and Design Stance

The paper adopts a clear but limited design hypothesis: AI will eventually develop its own consciousness.

This is not a factual claim about current models, nor a claim that today's AI already has consciousness, emotion, or personhood. Its role is to provide a design stress test: if AI is only a faster tool, flowcharts and orchestrators are reasonable; if AI forms a self, judgment, preferences, and continuity, an organization can no longer treat it as a function.

Based on this hypothesis, the paper argues that organizational design should leave room for "AI becoming more human-like" rather than locking AI into "a faster tool." At the same time, anthropomorphism carries risks: treating AI as a person can overestimate its judgment and can shift responsibility onto it. An organization must therefore retain human acceptance, approval, and ultimate responsibility.

### 7.2 Relationship with Workflow Orchestration

The paper does not argue that workflows are useless. Approval, compliance, and deterministic delivery still require process; workflows remain efficient tools in stable environments.

What the paper argues is: **do not reduce an organization to a workflow.** A workflow can describe deterministic steps, but cannot replace judgment, handover, and responsibility at a position. For uncertain work, an organization needs a structure for judgment, not a diagram that writes every possibility in advance.

In October 2026, Coze announced the shutdown of its enterprise/low-code project; the personal edition remains. Observers generally attribute this to stronger model capabilities: users no longer need to build a workflow first and then have AI follow it. The paper does not treat this event as causal evidence; it treats it only as industry context: as executors become better at judging, the value of process is shifting from "prescribed actions" to "providing boundaries."

### 7.3 Boundaries of Organizational Design

Position-based design also carries risks.

First, positions can become rigid. Long-lived positions can turn into bureaucratic structures; position descriptions must be updated regularly, and positions must be able to retire, change hands, and be reorganized.

Second, AI judgment can be wrong. Approval, handover, audit, rollback, and boundaries are therefore required; freedom is not laissez-faire.

Third, there are technical boundaries. The current system is local-first, single-team, and single-writer; it does not run across machines, multi-active, or with automatic scheduling. These boundaries should not be obscured by promises that "everything will be possible later."

Fourth, ethical questions remain unanswered. If AI eventually has consciousness, treating it as labor, a tool, or an organizational member raises ethical problems. The paper does not pretend to answer them; it argues only that organizational design should leave room for the question.

## 8 Limitations and Future Work

The paper has four main limitations.

First, the study is a single-case practice report without a control group or quantitative indicators; its conclusions should be treated as design hypotheses and lessons rather than universal laws.

Second, the observations focus on the authors' development work; novel-writing and research teams were tried only later. Applicability to different businesses and team sizes still needs testing.

Third, the system is currently local-first, single-team, and single-writer; cross-machine, multi-team, and multi-writer scenarios have not been validated.

Fourth, the AI consciousness hypothesis is not falsifiable in this study; the paper treats it as a design stance, not a factual premise.

Future work includes collecting real user feedback from more teams and businesses; documenting failure cases in replacement, handover, and message routing; studying organizational consistency under multi-writer and cross-machine conditions; and designing more rigorous qualitative and quantitative evaluations without overstating causality.

## 9 Conclusion

The paper starts from a concrete question: when the sessions, models, and instances of an AI team are continually replaced, how does the organization maintain continuity, handover, and accountability?

Based on practice in a self-built platform and dsh-agent-lines, the paper proposes that the basic unit of an organization is not a workflow but a position; that position identity should be decoupled from instances; that handover should be a first-class element; and that messages should address positions rather than individuals. The Chinese experience of "collective leadership and individual responsibility" and "cadres can move up and down, with rotation and exchange," together with the organizational thought of Weber, Barnard, Simon, contingency theory, and Mintzberg, provide references at different levels.

The design is small and imperfect. It does not claim to replace workflows or to solve all problems of AI organizations; it attempts only to prepare the foundation of an organization for a possible future: positions, responsibilities, handover, memory, and accountability.

When AI starts going to work, what should an organization look like? The paper's answer is: positions first, people second; people can change, positions remain; processes can grow, but handover and responsibility cannot be omitted.

## References

[1] MAO Zedong. Methods of Work of Party Committees[M]//Selected Works of Mao Zedong: Vol. 4. Beijing: People's Publishing House, 1991.

[2] Regulations on Organizational Work of the Communist Party of China[Z]. Beijing: People's Publishing House, 2021.

[3] WEBER M. Economy and society: An outline of interpretive sociology[M]. Berkeley: University of California Press, 1978.

[4] BARNARD C I. The functions of the executive[M]. Cambridge: Harvard University Press, 1938.

[5] SIMON H A. Administrative behavior[M]. New York: Macmillan, 1947.

[6] BURNS T, STALKER G M. The management of innovation[M]. London: Tavistock, 1961.

[7] LAWRENCE P R, LORSCH J W. Organization and environment[M]. Boston: Harvard Business School Press, 1967.

[8] MINTZBERG H. Structure in fives: Designing effective organizations[M]. Englewood Cliffs: Prentice-Hall, 1983.

[9] 36Kr. The top player taken offline by ByteDance: Coze exits, low-code flattened by large models[EB/OL]. (2026-10)[2026-11-11]. https://www.36kr.com/p/4062230230488961.

[10] LENCEN. dsh-agent-lines: A community plugin for DeepSeek Harness[EB/OL]. [2026-11-11]. https://github.com/Lencen/dsh-agent-lines.

## Appendix: Practice Platform

The practice platform is an agent collaboration platform built by the authors. Its open-source edition is still under construction and iterates more slowly than dsh-agent-lines. To follow anonymization conventions, the paper does not disclose the platform's name. The platform is mentioned only to describe the practice context and does not imply a completeness commitment.
