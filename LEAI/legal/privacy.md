# LEAI Privacy Policy

*Last updated: April 2026*

Your privacy matters. This page explains, in plain language, what LEAI collects, what it does not collect, who can see it, and what happens to it.

**The short version:** LEAI is anonymous. We do not collect your name, email, student ID, or any other identifying information; we do not sell or share your feedback; and we do not build a profile of you. The rest of this document explains the details.

## 1. Anonymous by design

When you use the LEAI Feedback Collector, no name, email, student ID, institutional login, or profile information is asked for or stored. Your conversation is tagged with a randomly generated session code (for example, *id_k3m9x2ab*) so the system can group your messages within one conversation. The code is not linked to you as a person, and when you close the tab the link between you and that code is gone.

Your instructor cannot tell which submission came from which student. That is the point — it lets you be honest without worrying about how it might look. The chat page shows an **ANONYMOUS** badge near the top of the screen as a visual reminder of this guarantee.

## 2. What we store

For each message you send or receive in LEAI, the backend stores:

- The text of the message

- Whether the message came from you or from the AI

- A timestamp

- The randomly generated session code described above

- The survey identifier (which course and which prompt)

- The name of the AI model used to generate the reply

- Your per-session research-consent choice (see Section 6)

That is the full record. We do **not** store device fingerprints, advertising identifiers, or analytics cookies tied to your identity.

## 3. IP addresses and access logs

LEAI's application code does not log or store your IP address as part of any feedback record. However, all web traffic to the LEAI backend reaches it over the public internet, so the underlying cloud platform (currently Heroku, on Amazon Web Services in the United States) and our application server may briefly retain network-level access logs that include IP addresses for operational purposes such as detecting abuse and routing traffic. These short-lived logs are not joined to feedback content and are not used for any analysis of feedback.

## 4. Why we collect it

The whole point of LEAI is to streamline feedback to your instructor *while the course is still running*. End-of-quarter surveys help future students; they do nothing for you. LEAI exists to change that: your instructor reads the aggregated feedback mid-course and uses it to improve your experience in the remaining weeks of the class. That is the only operational use of your data. We are not selling it, not advertising to you, and not building a profile of you.

## 5. Who can see your data

- **Your course instructor** and any teaching assistants the instructor grants access to (by sharing the course's access password) can read the anonymous feedback submitted to that course's surveys. Anyone the instructor shares the course password with can read everything submitted to that course; the instructor is responsible for controlling that scope.

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

Because LEAI does not collect any identity from you, there is no way for us to look up “your” data and remove it individually — there is simply no identifier to look up. The most reliable way to keep something out of the dataset is to not submit it: you can close the tab at any time and any unsent draft is discarded.

## 10. Security

Data is transmitted over HTTPS and stored in a managed cloud database operated by the GUII Lab on commercial cloud infrastructure (currently Heroku Postgres on Amazon Web Services, US region). LEAI is a research prototype and its security controls are evolving. Course access uses a shared password which is hashed before being stored. We do not currently require multi-factor authentication. Treat LEAI as you would an early-stage academic tool: do not submit anything you would not be willing for your instructor or the GUII Lab to read.

## 11. FERPA and educational records

LEAI is a research and feedback tool operated by the GUII Lab at UC Santa Cruz. It is not part of UCSC's official student record system. Submissions made through LEAI are not part of your education record under the Family Educational Rights and Privacy Act (FERPA), and they are not shared with the UCSC registrar.

## 12. Changes to this policy

We may update this policy as the tool evolves. Material changes — anything that affects what is collected, who can see it, or how it is used — will trigger a fresh consent prompt the next time you open a feedback session, so you can review and re-confirm. The version date at the top of this page is the version you are agreeing to today.

## 13. Contact

Questions about this privacy policy, or concerns about how LEAI handles your data, can be directed to the GUII Lab at UC Santa Cruz.
