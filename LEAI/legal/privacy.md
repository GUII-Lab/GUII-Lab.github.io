# LEAI Privacy Policy

*Last updated: April 2026*

Your privacy matters. This page explains, in plain language, what LEAI collects, what it does not collect, who can see it, and what happens to it.

**The short version:** LEAI is anonymous by default. If your instructor enables one of the optional modes (pseudonymous, identified, or Canvas completion credit), the guarantee changes — and we say so directly in this document and in the chat interface itself. We do not sell, advertise, or build a profile of you.

## 1. Anonymous by default — but read on

When your instructor creates a survey, they pick an *anonymity mode*. This is the single most important thing for understanding what LEAI collects from you. The chat page shows the active mode in a badge near the top of the screen — look for it before you start typing.

**Anonymous mode (default).** No name, email, student ID, institutional login, or profile information is asked for or stored. Your conversation is tagged with a randomly generated session code (for example, *id_k3m9x2ab*) so the system can group your messages within one conversation. The code is not linked to you as a person. Your instructor cannot tell which submission came from which student. This is the default mode and the one we recommend instructors keep.

**Pseudonymous / identified mode.** Before the chat begins you are asked to enter an identifier — a real name, student ID, nickname, or whatever the instructor specifies. Whatever you type is stored as part of your session record and is visible to your instructor and any teaching assistants they share access with. Choose carefully: if you type your real name or your university ID, the conversation is no longer anonymous to your instructor. If your instructor allows nicknames, you may use one.

**Canvas completion credit.** If your instructor enables completion credit, a short code is shown to you at the end of your session. You may choose to enter that code into Canvas (or another LMS) to receive credit for participating. **If you do this, your Canvas account becomes linked to your specific session in your instructor's records.** That is the trade-off for receiving credit; you can decline to enter the code if you prefer to remain unlinked.

## 2. What we store

For each message you send or receive in LEAI, the backend stores:

- The text of the message

- Whether the message came from you or from the AI

- A timestamp

- The session code, and — in pseudonymous or identified mode — the identifier you entered

- The survey identifier (which course and which prompt)

- The name of the AI model used to generate the reply

- Your per-session research-consent choice (see Section 6)

That is the full record. We do **not** store device fingerprints, advertising identifiers, or analytics cookies tied to your identity.

## 3. IP addresses and access logs

LEAI's application code does not log or store your IP address as part of any feedback record. However, all web traffic to the LEAI backend reaches it over the public internet, so the underlying cloud platform (currently Heroku, on Amazon Web Services in the United States) and our application server may briefly retain network-level access logs that include IP addresses for operational purposes such as detecting abuse and routing traffic. These short-lived logs are not joined to feedback content and are not used for any analysis of feedback.

## 4. Why we collect it

The whole point of LEAI is to streamline feedback to your instructor *while the course is still running*. End-of-quarter surveys help future students; they do nothing for you. LEAI exists to change that: your instructor reads the aggregated feedback mid-course and uses it to improve your experience in the remaining weeks of the class. That is the only operational use of your data. We are not selling it, not advertising to you, and not building a profile of you.

## 5. Who can see your data

- **Your course instructor** and any teaching assistants the instructor grants access to (by sharing the course's access password) can read the feedback submitted to that course's surveys, in whatever mode the instructor chose. Anyone the instructor shares the course password with can read everything submitted to that course; the instructor is responsible for controlling that scope.

- **The GUII Lab research team** maintains the system and has access to the underlying database as needed to operate the service (fixing bugs, performing backups, and migrating data).

- **The AI provider** described in Section 7 receives the text of your conversation and the system prompt your instructor wrote. It does not receive your name, your session code, or your identifier.

- **No other third parties.** We do not share, sell, or disclose your feedback to advertisers, data brokers, or any party outside the operational chain described above.

## 6. Optional research use

We are actively improving LEAI so that future students at your institution (and others) get a better version of it. **If you check the optional research-consent box on the welcome screen,** you give the GUII Lab permission to analyze the text of your messages in that session for research about how students use AI feedback tools. This consent is recorded server-side as a per-message flag, so any later research analysis is restricted to messages where the flag is true. Published results would only ever report aggregated or de-identified findings.

**If you do not check that box,** your messages are still readable by your instructor for course improvement (that is the operational purpose of the tool), but they will not be used in any GUII Lab research analysis.

This consent is **per session**. Each time you start a new feedback session, the box appears again and you can choose freshly.

## 7. AI processing

Your messages are sent to a third-party large language model provider (currently OpenAI) to generate the conversational prompts you see. The provider processes the text to return a response. We do not send the provider your name, your institutional ID, your session code, or any other identifier — only the conversation text and the system prompt your instructor wrote. Review the provider's own data-handling policies if you want details on how it processes API traffic. We may switch providers in the future; if we do, we will update this section.

## 8. Data retention

LEAI is a research prototype and does not yet enforce an automated retention schedule. Feedback data is retained on the GUII Lab's backend for the duration of the course and for as long as the lab continues to operate the service. We are working toward a documented retention and deletion schedule and will publish it here once it is in place. In the meantime, instructors and students may request deletion of specific data as described in Section 9.

## 9. Your rights

In **anonymous** mode there is no identity attached to your submissions, so there is no way for us to look up “your” data and remove it individually. The most reliable way to keep something out of the dataset is to not submit it: you can close the tab at any time and any unsent draft is discarded.

In **pseudonymous, identified, or Canvas-credit** modes the situation is different — your submissions can be located. If you want a specific session removed in those modes, contact your instructor or write to the GUII Lab. We will honor reasonable removal requests subject to verification that the request comes from the person who made the submission.

## 10. Security

Data is transmitted over HTTPS and stored in a managed cloud database operated by the GUII Lab on commercial cloud infrastructure (currently Heroku Postgres on Amazon Web Services, US region). LEAI is a research prototype and its security controls are evolving. Course access uses a shared password which is hashed before being stored. We do not currently require multi-factor authentication. Treat LEAI as you would an early-stage academic tool: do not submit anything you would not be willing for your instructor or the GUII Lab to read.

## 11. FERPA and educational records

LEAI is a research and feedback tool operated by the GUII Lab at UC Santa Cruz. It is not part of UCSC's official student record system. Submissions made through LEAI are not part of your education record under the Family Educational Rights and Privacy Act (FERPA), and they are not shared with the UCSC registrar. If your instructor uses LEAI to award participation credit through Canvas, only the completion code (and your decision to enter it) is shared with the LMS — not the contents of your conversation.

## 12. Changes to this policy

We may update this policy as the tool evolves. Material changes — anything that affects what is collected, who can see it, or how it is used — will trigger a fresh consent prompt the next time you open a feedback session, so you can review and re-confirm. The version date at the top of this page is the version you are agreeing to today.

## 13. Contact

Questions about this privacy policy, or concerns about how LEAI handles your data, can be directed to the GUII Lab at UC Santa Cruz.
